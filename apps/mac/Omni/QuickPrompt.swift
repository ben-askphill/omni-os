import AppKit
import Carbon.HIToolbox
import OmniKit
import SwiftUI

/// A system-wide shortcut through Carbon's `RegisterEventHotKey`, which needs no Accessibility permission.
/// The app has one, so the C callback finds it in `current`.
@MainActor
final class GlobalHotKey {
  private static weak var current: GlobalHotKey?
  private static var handler: EventHandlerRef?
  private var ref: EventHotKeyRef?
  private let action: @MainActor () -> Void

  init(action: @escaping @MainActor () -> Void) {
    self.action = action
    Self.current = self
  }

  /// False when another app holds the same keys.
  @discardableResult
  func register(_ shortcut: QuickPromptShortcut) -> Bool {
    unregister()
    Self.installHandler()
    // "OMNI".
    let id = EventHotKeyID(signature: OSType(0x4F4D_4E49), id: 1)
    return RegisterEventHotKey(shortcut.keyCode, shortcut.carbonModifiers, id, GetApplicationEventTarget(), 0, &ref) == noErr
  }

  func unregister() {
    if let ref { UnregisterEventHotKey(ref) }
    ref = nil
  }

  private static func installHandler() {
    guard handler == nil else { return }
    var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    // Carbon calls it on the main thread.
    InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
      MainActor.assumeIsolated { GlobalHotKey.current?.action() }
      return noErr
    }, 1, &spec, nil, &handler)
  }
}

/// A floating panel that takes typing without bringing Omni forward, like Spotlight: the app you were in stays
/// active and Omni's own windows stay where they are.
final class QuickPromptPanel: NSPanel {
  static let identifier = NSUserInterfaceItemIdentifier("quick-prompt")

  init(content: NSViewController) {
    super.init(
      contentRect: NSRect(x: 0, y: 0, width: 640, height: 140),
      styleMask: [.nonactivatingPanel, .borderless, .fullSizeContentView], backing: .buffered, defer: false
    )
    identifier = Self.identifier
    isFloatingPanel = true
    level = .floating
    collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
    hidesOnDeactivate = false
    isReleasedWhenClosed = false
    isMovableByWindowBackground = true
    backgroundColor = .clear
    isOpaque = false
    hasShadow = true
    contentViewController = content
  }

  /// The content grows with the prompt. Keep the top edge where it is, so the field grows downward.
  override func setContentSize(_ size: NSSize) {
    let top = frame.maxY
    super.setContentSize(size)
    setFrameTopLeftPoint(NSPoint(x: frame.minX, y: top))
  }

  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}

/// Opens the Quick Prompt on its shortcut from any app, starts Wispr Flow in it, and starts a Conductor thread
/// with what was said or typed. Omni does not come forward unless asked to open the thread.
@MainActor @Observable
final class QuickPromptController {
  /// Reopens the main window when the thread is opened with every window closed. Set by `MainWindow`.
  static var openMain: (() -> Void)?

  let settings: QuickPromptSettings
  let prompt = QuickPromptModel()
  /// False when another app holds the shortcut, for Settings to say so.
  private(set) var registered = true
  /// Bumped on every open, so the field takes focus again.
  private(set) var focusRequest = 0

  @ObservationIgnored private let model: AppModel
  @ObservationIgnored private var hotKey: GlobalHotKey?
  @ObservationIgnored private var panel: QuickPromptPanel?
  @ObservationIgnored private var closing: Task<Void, Never>?

  init(model: AppModel, settings: QuickPromptSettings = QuickPromptSettings()) {
    self.model = model
    self.settings = settings
  }

  var isOpen: Bool { panel?.isVisible == true }

  func start() {
    hotKey = GlobalHotKey { [weak self] in self?.toggle() }
    apply()
    settings.follow { [weak self] in self?.apply() }
  }

  private func apply() {
    guard let hotKey else { return }
    if settings.enabled {
      registered = hotKey.register(settings.shortcut)
    } else {
      hotKey.unregister()
      registered = true
    }
  }

  /// The shortcut: opens the panel; while Flow listens, stops it so its words land; otherwise closes.
  func toggle() {
    guard isOpen else { return show(dictate: settings.dictate) }
    if prompt.listening { setListening(false) } else { hide() }
  }

  func show(dictate: Bool, text: String? = nil) {
    closing?.cancel()
    prompt.reset()
    if let text { prompt.text = text }
    let panel = panel ?? makePanel()
    self.panel = panel
    place(panel)
    panel.makeKeyAndOrderFront(nil)
    focusRequest += 1
    // One runloop turn, so the field is first responder before Flow reads the focus.
    if dictate, WisprFlow.isInstalled { DispatchQueue.main.async { self.setListening(true) } }
  }

  func hide() {
    closing?.cancel()
    if prompt.listening { setListening(false) }
    panel?.orderOut(nil)
  }

  func setListening(_ on: Bool) {
    guard prompt.listening != on else { return }
    prompt.listening = on
    WisprFlow.setListening(on)
  }

  /// Return sends, and Cmd-Return sends and opens the thread. While Flow listens, it stops Flow first and sends
  /// once its words have landed.
  func submit(open: Bool) async {
    if prompt.listening {
      setListening(false)
      guard await prompt.awaitDictation() else { return }
    }
    guard let thread = await prompt.send(model.client) else { return }
    if open { return openThread(thread.id) }
    closing = Task {
      try? await Task.sleep(for: .seconds(1.4))
      if !Task.isCancelled { hide() }
    }
  }

  func openThread(_ id: String) {
    hide()
    model.route = .thread(id: id)
    if !NSApp.windows.contains(where: { $0.identifier?.rawValue.hasPrefix("main") == true && $0.isVisible }) {
      Self.openMain?()
    }
    NSApp.activate()
  }

  private func makePanel() -> QuickPromptPanel {
    let host = NSHostingController(rootView: QuickPromptView(controller: self, model: model))
    host.sizingOptions = [.preferredContentSize]
    return QuickPromptPanel(content: host)
  }

  /// Centered on the screen under the pointer, a little above the middle.
  private func place(_ panel: QuickPromptPanel) {
    let mouse = NSEvent.mouseLocation
    guard let screen = NSScreen.screens.first(where: { $0.frame.contains(mouse) }) ?? NSScreen.main else { return }
    let area = screen.visibleFrame
    let size = panel.frame.size
    panel.setFrameTopLeftPoint(NSPoint(x: area.midX - size.width / 2, y: area.maxY - area.height * 0.22))
  }
}

/// The panel: where the prompt goes, the field, and a line that says what is happening.
struct QuickPromptView: View {
  let controller: QuickPromptController
  let model: AppModel
  @FocusState private var focused: Bool

  private var prompt: QuickPromptModel { controller.prompt }

  var body: some View {
    @Bindable var prompt = controller.prompt
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 10) {
        target
        Spacer(minLength: 0)
        if WisprFlow.isInstalled {
          Button {
            focused = true
            controller.setListening(!prompt.listening)
          } label: {
            Image(systemName: prompt.listening ? "mic.fill" : "mic")
              .foregroundStyle(prompt.listening ? Tok.needs : Tok.fg3)
              .symbolEffect(.pulse, isActive: prompt.listening)
          }
          .buttonStyle(.icon(size: 28, active: prompt.listening))
          .help(prompt.listening ? "Stop Wispr Flow" : "Dictate with Wispr Flow")
        }
      }
      TextField("Ask the Conductor anything", text: $prompt.text, axis: .vertical)
        .textFieldStyle(.plain)
        .font(.system(size: 19))
        .foregroundStyle(Tok.fg)
        .lineLimit(1...10)
        .focused($focused)
        .onSubmit { Task { await controller.submit(open: false) } }
        .onKeyPress(.return, phases: .down) { press in
          guard press.modifiers.contains(.command) else { return .ignored }
          Task { await controller.submit(open: true) }
          return .handled
        }
      footer
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 14)
    .frame(width: 640, alignment: .leading)
    .background(Tok.bg, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Tok.lineStrong, lineWidth: 1))
    .tint(Tok.fg)
    .onExitCommand { controller.hide() }
    .onChange(of: controller.focusRequest, initial: true) { focused = true }
  }

  /// The Conductor by default; a menu to send this one prompt to a channel instead.
  private var target: some View {
    let channels = model.store.channels.filter { !$0.archived && $0.id != QuickPromptModel.conductor }
    let current = model.store.channel(prompt.channel)
    let conductor = prompt.channel == QuickPromptModel.conductor
    return Menu {
      Button("Conductor") { prompt.channel = QuickPromptModel.conductor }
      if !channels.isEmpty {
        Divider()
        ForEach(channels) { c in
          Button("#\(c.name)") { prompt.channel = c.id }
        }
      }
    } label: {
      HStack(spacing: 8) {
        ChannelAvatar(name: current?.name ?? prompt.channel, conductor: conductor, size: 22, icon: current?.icon)
        Text(conductor ? "Conductor" : "#\(current?.name ?? prompt.channel)")
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(Tok.fg)
        Image(systemName: "chevron.down")
          .font(.system(size: 9, weight: .semibold))
          .foregroundStyle(Tok.fg3)
      }
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .menuIndicator(.hidden)
    .fixedSize()
  }

  @ViewBuilder private var footer: some View {
    HStack(spacing: 8) {
      switch prompt.phase {
      case .editing where prompt.listening:
        Image(systemName: "waveform").foregroundStyle(Tok.needs)
        Text("Listening. Speak, then press Return to send.")
      case .editing:
        Text("Return to send, ⌘Return to send and open, Esc to close")
      case .finishing:
        ProgressView().controlSize(.small)
        Text("Waiting for Wispr Flow…")
      case .sending:
        ProgressView().controlSize(.small)
        Text("Sending…")
      case .sent(let thread):
        Image(systemName: "checkmark.circle.fill").foregroundStyle(Tok.fg)
        Text("Started \(thread.title.isEmpty ? "a thread" : "“\(thread.title)”")")
          .lineLimit(1)
        Button("Open") { controller.openThread(thread.id) }
          .buttonStyle(.link)
      case .failed(let message):
        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Tok.warn)
        Text(message).lineLimit(2)
      }
      Spacer(minLength: 0)
    }
    .font(.system(size: 12))
    .foregroundStyle(Tok.fg3)
  }
}
