import AppKit
import OmniKit
import SwiftTerm
import SwiftUI

/// The inspector's Terminal tab, like `TerminalView.tsx`: the thread's shell, in its working directory.
/// The shell lives on the server, so switching tabs, threads or clients reattaches to the same one and
/// replays its recent output.
struct TerminalTab: View {
  let client: OmniClient
  let thread: String
  let cwd: String?
  @State private var session: TerminalSession?

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 8) {
        OmniIcon(name: "terminal", size: 13).foregroundStyle(Tok.fg3)
        Text(cwd.map { Format.shortPath($0) } ?? "")
          .font(.system(size: 11.5, design: .monospaced))
          .foregroundStyle(Tok.fg3)
          .lineLimit(1)
          .truncationMode(.head)
          .help(cwd ?? "")
        Spacer(minLength: 4)
        if let session {
          if session.exited {
            Button("Restart", systemImage: "arrow.clockwise") { session.restart() }
              .buttonStyle(.pill)
              .controlSize(.small)
          } else {
            Button("Close the shell", systemImage: "trash") { session.hangUp() }
              .labelStyle(.iconOnly)
              .buttonStyle(.icon(size: 26))
              .help("Close the shell")
              .disabled(!session.attached)
          }
        }
      }
      .padding(.horizontal, 14)
      .frame(height: 32)
      if let error = session?.error {
        Text(error)
          .font(.system(size: 12))
          .foregroundStyle(Tok.fg2)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 14)
          .padding(.bottom, 6)
      }
      Group {
        if let session {
          ShellView(session: session)
        } else {
          Color.clear
        }
      }
      .padding(8)
      .background(TerminalSession.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      .padding(.horizontal, 10)
      .padding(.bottom, 10)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .task(id: thread) {
      let s = TerminalSession(client: client, thread: thread)
      session = s
      s.start()
      // Holds the stream until the tab goes away or the thread changes.
      await withTaskCancellationHandler {
        await s.run()
      } onCancel: {
        Task { @MainActor in s.stop() }
      }
    }
  }
}

/// One attached terminal: the SwiftTerm view, its stream and its keystrokes.
@MainActor @Observable
final class TerminalSession {
  static let background = Color(hex: 0x141518)

  let client: OmniClient
  let thread: String
  private(set) var exited = false
  private(set) var attached = false
  private(set) var error: String?

  @ObservationIgnored let view: SwiftTerm.TerminalView
  @ObservationIgnored private var stream: SSEClient<TerminalMessage>?
  @ObservationIgnored private var input: TerminalInputQueue?
  @ObservationIgnored private var bridge: Bridge?
  @ObservationIgnored private var resizeTask: Task<Void, Never>?
  @ObservationIgnored private var wake: (() -> Void)?
  @ObservationIgnored private var stopped = false

  init(client: OmniClient, thread: String) {
    self.client = client
    self.thread = thread
    view = SwiftTerm.TerminalView(frame: CGRect(x: 0, y: 0, width: 400, height: 300))
    view.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
    view.nativeBackgroundColor = NSColor(TerminalSession.background)
    view.nativeForegroundColor = NSColor(red: 0xec / 255, green: 0xea / 255, blue: 0xe5 / 255, alpha: 1)
    view.caretColor = NSColor(red: 0xec / 255, green: 0xea / 255, blue: 0xe5 / 255, alpha: 1)
    view.optionAsMetaKey = true
    view.installColors(Self.paletteHex.map { Self.color($0) })
    let bridge = Bridge()
    self.bridge = bridge
    view.terminalDelegate = bridge
    bridge.session = self
  }

  /// The Web UI's ANSI palette (`TerminalView.tsx`), for a dark background in both appearances.
  private nonisolated static let paletteHex: [Int] = [
    0x2a2c31, 0xff7b72, 0x7ee787, 0xe3b341, 0x79c0ff, 0xd2a8ff, 0x76e3ea, 0xd0cfca,
    0x6f6e69, 0xffa198, 0xaff5b4, 0xf2cc60, 0xa5d6ff, 0xe2c5ff, 0xb3f0ff, 0xffffff,
  ]

  /// SwiftTerm's channels are 16 bit.
  private nonisolated static func color(_ hex: Int) -> SwiftTerm.Color {
    let r = UInt16((hex >> 16) & 0xff) * 257
    let g = UInt16((hex >> 8) & 0xff) * 257
    let b = UInt16(hex & 0xff) * 257
    return SwiftTerm.Color(red: r, green: g, blue: b)
  }

  private var size: (cols: Int, rows: Int) {
    let t = view.getTerminal()
    return (t.cols, t.rows)
  }

  func start() {
    let client = client
    let thread = thread
    input = TerminalInputQueue(client: client, thread: thread) { [weak self] error in
      // 409: the shell exited, and the stream says so.
      if case .http(status: 409, _) = error as? OmniAPIError { return }
      Task { @MainActor in self?.error = String(describing: error) }
    }
    connect()
  }

  private func connect() {
    stream?.close()
    // Read on the main actor when each connection starts, so the shell opens at the view's size.
    let box = SizeBox(size)
    sizeBox = box
    let s = client.terminalEvents(thread, size: { box.value })
    stream = s
    s.start()
    let events = s.events
    Task { [weak self] in
      for await event in events {
        guard let self else { return }
        self.handle(event)
      }
    }
  }

  @ObservationIgnored private var sizeBox: SizeBox?

  /// Returns once `stop()` is called.
  func run() async {
    guard !stopped else { return }
    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
      wake = { done.resume() }
    }
  }

  func stop() {
    guard !stopped else { return }
    stopped = true
    stream?.close()
    input?.close()
    resizeTask?.cancel()
    wake?()
    wake = nil
  }

  private func handle(_ event: SSEEvent<TerminalMessage>) {
    switch event {
    case .state(.reconnecting):
      error = "Terminal disconnected. Reconnecting."
    case .state:
      break
    case .message(.snapshot(let data, let running, let code)):
      view.getTerminal().resetToInitialState()
      view.feed(text: data)
      if !running { view.feed(text: Self.exitLine(code)) }
      exited = !running
      attached = true
      error = nil
      // The server's size may be another client's; send ours.
      if running { sendResize() }
    case .message(.data(let data)):
      view.feed(text: data)
    case .message(.exit(let code)):
      view.feed(text: Self.exitLine(code))
      exited = true
    }
  }

  private static func exitLine(_ code: Int?) -> String {
    "\r\n\u{1b}[2m[process exited\(code.map { " with code \($0)" } ?? "")]\u{1b}[0m\r\n"
  }

  func restart() {
    let (cols, rows) = size
    Task {
      do {
        _ = try await client.openTerminal(thread, cols: cols, rows: rows)
        exited = false
        connect()
      } catch {
        self.error = String(describing: error)
      }
    }
  }

  func hangUp() {
    Task {
      do {
        _ = try await client.closeTerminal(thread)
      } catch {
        self.error = String(describing: error)
      }
    }
  }

  fileprivate func typed(_ data: String) {
    input?.send(data)
  }

  fileprivate func resized() {
    sizeBox?.value = size
    sendResize()
  }

  private func sendResize() {
    let (cols, rows) = size
    let client = client
    let thread = thread
    resizeTask?.cancel()
    resizeTask = Task {
      try? await Task.sleep(for: .milliseconds(80))
      guard !Task.isCancelled else { return }
      try? await client.resizeTerminal(thread, cols: cols, rows: rows)
    }
  }

  /// The size the next connection opens the shell at, read off the main actor.
  private final class SizeBox: @unchecked Sendable {
    private let lock = NSLock()
    private var _value: (cols: Int, rows: Int)
    init(_ value: (cols: Int, rows: Int)) { _value = value }
    var value: (cols: Int, rows: Int) {
      get { lock.withLock { _value } }
      set { lock.withLock { _value = newValue } }
    }
  }

  /// SwiftTerm's delegate: keystrokes out, size changes. Everything else is left at its default.
  @MainActor private final class Bridge: @MainActor TerminalViewDelegate {
    weak var session: TerminalSession?

    func send(source: SwiftTerm.TerminalView, data: ArraySlice<UInt8>) {
      let text = String(decoding: data, as: UTF8.self)
      session?.typed(text)
    }

    func sizeChanged(source: SwiftTerm.TerminalView, newCols: Int, newRows: Int) {
      session?.resized()
    }

    func setTerminalTitle(source: SwiftTerm.TerminalView, title: String) {}
    func hostCurrentDirectoryUpdate(source: SwiftTerm.TerminalView, directory: String?) {}
    func scrolled(source: SwiftTerm.TerminalView, position: Double) {}
    func rangeChanged(source: SwiftTerm.TerminalView, startY: Int, endY: Int) {}

    /// OSC 52 from the shell (tmux, vim): to the pasteboard.
    func clipboardCopy(source: SwiftTerm.TerminalView, content: Data) {
      guard let text = String(data: content, encoding: .utf8) else { return }
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(text, forType: .string)
    }
  }
}

/// Hosts the session's SwiftTerm view, and gives it focus when it appears. The view sits in a plain
/// container that sizes it to the panel: handed to SwiftUI directly it keeps the frame it was made with.
private struct ShellView: NSViewRepresentable {
  let session: TerminalSession

  func makeNSView(context: Context) -> NSView {
    let container = NSView()
    let view = session.view
    view.removeFromSuperview()
    view.frame = container.bounds
    view.autoresizingMask = [.width, .height]
    container.addSubview(view)
    DispatchQueue.main.async { view.window?.makeFirstResponder(view) }
    return container
  }

  func updateNSView(_ nsView: NSView, context: Context) {}
}
