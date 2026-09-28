#if DEBUG
import AppKit
import OmniKit
import SwiftUI

/// Debug builds only. `-OmniQAScript <json or path> -OmniQAOut <dir>` runs a QA script (see `QAScript`)
/// against the app. Snapshots render the app's own windows to PNG, with no screen recording permission.
/// Each step's result goes to `qa.json` in the out folder as it finishes.
///
/// It refuses to run unless launch arguments set the port to something other than 4747, checked before the
/// app model exists, so a QA run never talks to the live server or saves settings. A port step can't pick
/// 4747 either, and server steps refuse while the port is 4747. A server it starts keeps its data in the out
/// folder and runs the fake CLIs (see `QAServer`).
@MainActor
final class QARunner {
  struct Launch {
    let script: String
    let out: URL

    func supervisorOptions(repo: URL) -> ServerSupervisor.Options {
      .init(
        launcher: ServerLauncher(extraEnvironment: QAServer.environment(out: out, repo: repo)),
        logURL: out.appending(path: "server.log"), recordURL: out.appending(path: "server.json"))
    }
  }

  /// Captured by the main window, since only a view can read it.
  static var openSettings: OpenSettingsAction?
  private static var current: QARunner?

  /// Read from the raw arguments: UserDefaults would parse a JSON value as an old-style property list.
  static func launch(from arguments: [String] = ProcessInfo.processInfo.arguments) -> Launch? {
    func value(_ flag: String) -> String? {
      guard let i = arguments.firstIndex(of: flag), arguments.indices.contains(i + 1) else { return nil }
      return arguments[i + 1]
    }
    guard let script = value("-OmniQAScript") else { return nil }
    guard let out = value("-OmniQAOut") else {
      FileHandle.standardError.write(Data("QA: -OmniQAScript needs -OmniQAOut <dir>\n".utf8))
      exit(2)
    }
    let launch = Launch(script: script, out: URL(filePath: out, directoryHint: .isDirectory))
    do throws(QAScriptError) {
      _ = try QALaunch.serverPort(in: arguments)
    } catch {
      refuse(error.message, out: launch.out)
    }
    return launch
  }

  /// Ends the run before the app model exists, so nothing has talked to a server yet.
  private static func refuse(_ message: String, out: URL) -> Never {
    try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    try? encoder.encode(Report(ok: false, error: message)).write(to: out.appending(path: "qa.json"))
    FileHandle.standardError.write(Data("QA: \(message)\n".utf8))
    exit(2)
  }

  private static var encoder: JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return encoder
  }

  static func start(_ launch: Launch, model: AppModel) {
    let runner = QARunner(model: model, out: launch.out)
    current = runner
    Task { await runner.run(launch.script) }
  }

  private struct StepResult: Encodable {
    let step: Int
    let action: String
    var ok = true
    var ms = 0
    var error: String?
    var files: [String] = []
    /// What a step measured: a thread's open time, frame times for a scroll.
    var note: String?
  }

  private struct Report: Encodable {
    var ok = true
    var error: String?
    var steps: [StepResult] = []
    var facts: Facts?
  }

  private struct Facts: Encodable {
    let serverState: String
    let connection: String
    let sidebarLoaded: Bool
    let channels: [String]
    let route: String
    let windows: [String]
  }

  private let model: AppModel
  private let out: URL
  private var report = Report()
  private var routedAt: ContinuousClock.Instant?

  private init(model: AppModel, out: URL) {
    self.model = model
    self.out = out
  }

  private func run(_ text: String) async {
    do {
      try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    } catch {
      FileHandle.standardError.write(Data("QA: can't make \(out.path): \(error.localizedDescription)\n".utf8))
      exit(2)
    }
    guard model.settings.isVolatile, model.settings.port != ServerSettings.defaultPort else {
      return abort("QA runs need -serverPort set to a port other than \(ServerSettings.defaultPort).")
    }
    let script: QAScript
    do {
      script = try QAScript(json: try scriptData(text))
    } catch let error as QAScriptError {
      return abort(error.message)
    } catch {
      return abort("can't read the script: \(error.localizedDescription)")
    }

    for (i, step) in script.steps.enumerated() {
      var result = StepResult(step: i + 1, action: describe(step))
      let started = ContinuousClock.now
      do throws(QAScriptError) {
        switch step {
        case .route(let route):
          model.route = route
          routedAt = .now
        case .wait(let condition, let timeout):
          try await wait(for: condition, timeout: timeout)
          if case .thread = condition, let routedAt, let shownAt = QAProbe.shownAt, shownAt > routedAt {
            result.note = "open \(Self.ms(shownAt - routedAt)) ms"
          }
        case .appearance(let appearance):
          NSApp.appearance = NSAppearance(named: appearance == .dark ? .darkAqua : .aqua)
          try? await Task.sleep(for: .milliseconds(500))
        case .scroll(let scroll):
          result.note = try await self.scroll(scroll)
        case .sleep(let duration):
          try? await Task.sleep(for: duration)
        case .snapshot(let name):
          result.files = try await snapshot(name)
        case .port(let port):
          guard port != ServerSettings.defaultPort else { throw QAScriptError("port \(port) is the live server") }
          model.settings.port = port
        case .open(.settings):
          guard let openSettings = Self.openSettings else { throw QAScriptError("the main window has not appeared") }
          openSettings()
          try? await Task.sleep(for: .milliseconds(600))
        case .server(let action):
          guard model.settings.port != ServerSettings.defaultPort, model.supervisor.port != ServerSettings.defaultPort else {
            throw QAScriptError("port \(ServerSettings.defaultPort) is the live server")
          }
          switch action {
          case .start: await model.startServer()
          case .stop: await model.stopServer()
          case .check: await model.checkAgain()
          }
        case .expand:
          result.note = "not handled by this build"
        case .inspector(let command):
          guard let inspect = InspectorProbe.command else { throw QAScriptError("no thread is open") }
          inspect(command)
          try? await Task.sleep(for: .milliseconds(400))
        case .webTitle(let title):
          try await InspectorProbe.waitForTitle(title)
        case .quit:
          finish(result, started)
          await end()
        }
      } catch {
        result.ok = false
        result.error = error.message
        if case .snapshot = step { result.files = pending }
      }
      finish(result, started)
      write()
    }
    // Out of steps: quit anyway, so a run never leaves the app open.
    await end()
  }

  /// Quits. A server this run started is stopped first, so a run leaves no server behind.
  private func end() async -> Never {
    if case .running(startedByApp: true, _) = model.supervisor.state {
      await model.stopServer()
    }
    write()
    exit(report.ok ? 0 : 1)
  }

  private func finish(_ result: StepResult, _ started: ContinuousClock.Instant) {
    var result = result
    result.ms = Self.ms(ContinuousClock.now - started)
    if !result.ok { report.ok = false }
    report.steps.append(result)
  }

  private static func ms(_ d: Duration) -> Int {
    Int(d.components.seconds * 1000 + d.components.attoseconds / 1_000_000_000_000_000)
  }

  private func scriptData(_ text: String) throws -> Data {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.hasPrefix("[") || trimmed.hasPrefix("{") { return Data(trimmed.utf8) }
    return try Data(contentsOf: URL(filePath: (trimmed as NSString).expandingTildeInPath))
  }

  private func describe(_ step: QAStep) -> String {
    switch step {
    case .route(let route): "route \(route.hash)"
    case .wait(let condition, let timeout): "wait \(condition) up to \(timeout)"
    case .sleep(let duration): "sleep \(duration)"
    case .snapshot(let name): "snapshot \(name)"
    case .port(let port): "port \(port)"
    case .open(let window): "open \(window.rawValue)"
    case .server(let action): "server \(action.rawValue)"
    case .appearance(let appearance): "appearance \(appearance.rawValue)"
    case .scroll(let scroll): "scroll \(scroll.rawValue)"
    case .expand: "expand"
    case .inspector(let command): "inspector \(command.rawValue)"
    case .webTitle(let title): "webTitle \(title)"
    case .quit: "quit"
    }
  }

  private func wait(for condition: QACondition, timeout: Duration) async throws(QAScriptError) {
    let deadline = ContinuousClock.now + timeout
    while !condition.holds(in: facts) {
      guard ContinuousClock.now < deadline else {
        let f = facts
        throw QAScriptError("timed out; server \(f.serverState), feed \(f.connection), sidebar loaded \(f.sidebarLoaded)")
      }
      try? await Task.sleep(for: .milliseconds(100))
    }
  }

  /// The model's facts and which transcript the thread screen has laid out.
  private var facts: QAFacts {
    var f = model.qaFacts
    f.shownThread = QAProbe.shownThread
    return f
  }

  // MARK: Scrolling

  private func scroll(_ scroll: QAScroll) async throws(QAScriptError) -> String? {
    guard let scroller = QAProbe.scroller else { throw QAScriptError("no thread on screen") }
    switch scroll {
    case .top:
      scroller.toTop()
    case .bottom:
      scroller.toBottom()
    case .through:
      guard let view = Self.windows.first(where: Self.isMain)?.contentView else { throw QAScriptError("no main window") }
      scroller.toBottom()
      try? await Task.sleep(for: .seconds(1))
      let gaps = await FrameClock().run(in: view, frames: 5000, scroller.pageUp)
      return QAFrameStats(gaps: gaps).summary
    }
    try? await Task.sleep(for: .milliseconds(600))
    return nil
  }

  private func abort(_ message: String) {
    report.ok = false
    report.error = message
    write()
    FileHandle.standardError.write(Data("QA: \(message)\n".utf8))
    exit(2)
  }

  private func write() {
    let f = model.qaFacts
    report.facts = Facts(
      serverState: f.serverState, connection: f.connection, sidebarLoaded: f.sidebarLoaded, channels: f.channels.sorted(),
      route: model.route.hash, windows: Self.windows.map { $0.identifier?.rawValue ?? $0.title }
    )
    try? Self.encoder.encode(report).write(to: out.appending(path: "qa.json"))
  }

  // MARK: Snapshots

  private static var windows: [NSWindow] {
    NSApp.windows
      .filter { $0.isVisible && $0.styleMask.contains(.titled) && !($0 is NSPanel) }
      .sorted { $0.windowNumber < $1.windowNumber }
  }

  private static func isSettings(_ window: NSWindow) -> Bool {
    window.identifier?.rawValue.localizedCaseInsensitiveContains("settings") == true
  }

  private static func isMain(_ window: NSWindow) -> Bool {
    window.identifier?.rawValue.hasPrefix("main") == true
  }

  private var pending: [String] = []

  /// Writes `<name>.png` for the main window, `<name>-settings.png` for Settings, `<name>-window<n>.png`
  /// for anything else, and fails when one comes out blank.
  private func snapshot(_ name: String) async throws(QAScriptError) -> [String] {
    // A window can take a moment to come up after launch.
    let deadline = ContinuousClock.now + .seconds(5)
    while Self.windows.isEmpty, ContinuousClock.now < deadline {
      try? await Task.sleep(for: .milliseconds(100))
    }
    try? await Task.sleep(for: .milliseconds(400))
    let windows = Self.windows
    guard !windows.isEmpty else { throw QAScriptError("no window to snapshot") }
    pending = []
    var blank: [String] = []
    var others = 0
    for window in windows {
      let file: String
      if Self.isSettings(window) {
        file = "\(name)-settings.png"
      } else if Self.isMain(window) {
        file = "\(name).png"
      } else {
        others += 1
        file = "\(name)-window\(others).png"
      }
      guard let image = Self.render(window) else { throw QAScriptError("can't render \(file)") }
      if QASnapshot.looksBlank(pixels: Self.pixels(image)) { blank.append(file) }
      guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
        throw QAScriptError("can't encode \(file)")
      }
      do {
        try png.write(to: out.appending(path: file))
      } catch {
        throw QAScriptError("can't write \(file): \(error.localizedDescription)")
      }
      pending.append(file)
    }
    if !blank.isEmpty { throw QAScriptError("blank: \(blank.joined(separator: ", "))") }
    return pending
  }

  /// The window's frame view, title bar and toolbar included, drawn the way AppKit caches a view.
  ///
  /// `cacheDisplay` leaves out the rows of a sidebar list: its scroll view, inside the sidebar's glass,
  /// draws nothing. So each table row's cells are drawn on their own and laid over the capture, with a
  /// plain rounded highlight under a selected row, where the system draws its own.
  private static func render(_ window: NSWindow) -> CGImage? {
    guard let root = window.contentView?.superview ?? window.contentView, let base = cache(root) else { return nil }
    let rows = descendants(of: root).compactMap { $0 as? NSTableRowView }.filter { !$0.isHiddenOrHasHiddenAncestor }
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(
        data: nil, width: base.width, height: base.height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
      )
    else { return base }
    let scale = CGFloat(base.width) / max(root.bounds.width, 1)
    let whole = CGRect(x: 0, y: 0, width: base.width, height: base.height)
    // The glass sidebar and title bar come out see-through. On screen the desktop shows through them.
    var backdrop = NSColor.windowBackgroundColor.cgColor
    window.effectiveAppearance.performAsCurrentDrawingAppearance {
      backdrop = NSColor.windowBackgroundColor.usingColorSpace(.sRGB)?.cgColor ?? backdrop
    }
    context.setFillColor(backdrop)
    context.fill(whole)
    context.draw(base, in: whole)

    // A rect in root coordinates, in the context's pixels, origin bottom left.
    func pixels(_ rect: NSRect) -> CGRect {
      let y = root.isFlipped ? root.bounds.height - rect.maxY : rect.minY
      return CGRect(x: rect.minX * scale, y: y * scale, width: rect.width * scale, height: rect.height * scale)
    }

    for row in rows where row.frame.height > 0 {
      context.saveGState()
      // Only where rows show: not under the title bar or a bar laid over the list's edge.
      if let scroll = row.enclosingScrollView {
        let clip = scroll.contentView
        let insets = scroll.contentInsets
        var visible = clip.convert(clip.bounds, to: root)
        visible.origin.y += root.isFlipped ? insets.top : insets.bottom
        visible.size.height -= insets.top + insets.bottom
        context.clip(to: pixels(visible))
      }
      if row.isSelected {
        let rect = pixels(row.convert(row.bounds, to: root).insetBy(dx: 10, dy: 1))
        let color = window.isKeyWindow ? NSColor.selectedContentBackgroundColor : NSColor.unemphasizedSelectedContentBackgroundColor
        context.setFillColor(color.usingColorSpace(.sRGB)?.cgColor ?? color.cgColor)
        context.addPath(CGPath(roundedRect: rect, cornerWidth: 8 * scale, cornerHeight: 8 * scale, transform: nil))
        context.fillPath()
      }
      // Cells and section headers only. The row's own selection and separator views come out black.
      for cell in row.subviews where !cell.isHidden && cell.frame.height > 0 && Self.isCell(cell) {
        if let image = cache(cell) {
          context.draw(image, in: pixels(cell.convert(cell.bounds, to: root)))
        }
      }
      context.restoreGState()
    }
    return context.makeImage() ?? base
  }

  private static func isCell(_ view: NSView) -> Bool {
    let name = "\(type(of: view))"
    return view is NSTableCellView || name.contains("Cell") || name.contains("Header")
  }

  private static func cache(_ view: NSView) -> CGImage? {
    view.layoutSubtreeIfNeeded()
    guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
    view.cacheDisplay(in: view.bounds, to: rep)
    return rep.cgImage
  }

  private static func descendants(of view: NSView) -> [NSView] {
    view.subviews + view.subviews.flatMap { descendants(of: $0) }
  }

  /// The image at half size as RGBA words, for the blank check.
  private static func pixels(_ image: CGImage) -> [UInt32] {
    let width = max(1, image.width / 2), height = max(1, image.height / 2)
    var buffer = [UInt32](repeating: 0, count: width * height)
    buffer.withUnsafeMutableBytes { raw in
      guard
        let space = CGColorSpace(name: CGColorSpace.sRGB),
        let context = CGContext(
          data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: space,
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )
      else { return }
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    }
    return buffer
  }
}
/// Calls `tick` once a frame from the display link until it returns false, and times the frames.
@MainActor
private final class FrameClock: NSObject {
  private var tick: () -> Bool = { false }
  private var left = 0
  private var last: CFTimeInterval?
  private var gaps: [Double] = []
  private var done: CheckedContinuation<[Double], Never>?

  func run(in view: NSView, frames: Int, _ tick: @escaping () -> Bool) async -> [Double] {
    self.tick = tick
    left = frames
    return await withCheckedContinuation { continuation in
      done = continuation
      view.displayLink(target: self, selector: #selector(frame(_:))).add(to: .main, forMode: .common)
    }
  }

  @objc private func frame(_ link: CADisplayLink) {
    if let last { gaps.append((link.timestamp - last) * 1000) }
    last = link.timestamp
    left -= 1
    guard left <= 0 || !tick() else { return }
    link.invalidate()
    done?.resume(returning: gaps)
    done = nil
  }
}
#endif
