#if DEBUG
import AppKit
import OmniKit
import SwiftUI
import WebKit

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

    /// Off the real monitor's port, so a monitor Ben started by hand is not what the run attaches to.
    static let monitorPort = 4891

    @MainActor func monitor(settings: ServerSettings) -> ActivityMonitor {
      ActivityMonitor(port: Self.monitorPort, config: { settings.config }, options: .init(logURL: out.appending(path: "monitor.log")))
    }
  }

  /// Captured by the main window, since only a view can read it.
  static var openSettings: OpenSettingsAction?
  static var openThreadWindow: ((String) -> Void)?
  static var quickPrompt: QuickPromptController?
  static var current: QARunner?

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
  static func refuse(_ message: String, out: URL) -> Never {
    try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    try? encoder.encode(Report(ok: false, error: message)).write(to: out.appending(path: "qa.json"))
    FileHandle.standardError.write(Data("QA: \(message)\n".utf8))
    exit(2)
  }

  static var encoder: JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return encoder
  }

  static func start(_ launch: Launch, model: AppModel) {
    // The Web tab starts empty, and Ben's own pages and logins stay out of the run.
    UserDefaults.standard.removePersistentDomain(forName: "com.omni-os.mac.qa-web")
    NativeBrowsers.qa = UserDefaults(suiteName: "com.omni-os.mac.qa-web")
    let runner = QARunner(model: model, out: launch.out)
    current = runner
    Task { await runner.run(launch.script) }
  }

  struct StepResult: Encodable {
    let step: Int
    let action: String
    var ok = true
    var ms = 0
    var error: String?
    var files: [String] = []
    /// What a step measured: a thread's open time, frame times for a scroll.
    var note: String?
  }

  struct Report: Encodable {
    var ok = true
    var error: String?
    var steps: [StepResult] = []
    var facts: Facts?
  }

  struct Facts: Encodable {
    let serverState: String
    let connection: String
    let sidebarLoaded: Bool
    let channels: [String]
    let route: String
    let windows: [String]
  }

  let model: AppModel
  let out: URL
  var report = Report()
  var routedAt: ContinuousClock.Instant?

  private init(model: AppModel, out: URL) {
    self.model = model
    self.out = out
  }

  func run(_ text: String) async {
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
        case .palette(let query):
          if let query { model.shell.openPalette(query: query) } else { model.shell.paletteOpen = false }
          try? await Task.sleep(for: .milliseconds(400))
        case .channel(let action):
          try await channelStep(action)
        case .folder(let action):
          try await folderStep(action)
          try? await Task.sleep(for: .milliseconds(500))
        case .screen(let name):
          try await screen(name)
          result.files = [name + ".png"]
        case .handoffMenu(let name):
          try await handoffMenu(shot: name)
          result.files = [name + ".png"]
        case .prMenu(let name):
          guard let frame = QAPRProbe.button else { throw QAScriptError("no PR button on screen") }
          try await shootMenu(at: NSPoint(x: frame.midX, y: frame.midY), button: .leftMouseDown, shot: name, what: "the PR button")
          result.files = [name + ".png"]
        case .handOff(let device):
          guard let handOff = QAHandoffProbe.handOff else { throw QAScriptError("no thread that can be handed off on screen") }
          await handOff(device)
          try? await Task.sleep(for: .milliseconds(600))
        case .takeOver(let name):
          guard let takeOver = QAHandoffProbe.takeOver else { throw QAScriptError("no Take Over over the reply box") }
          takeOver.ask()
          try await screen(name)
          result.files = [name + ".png"]
          await takeOver.confirm()
          try? await Task.sleep(for: .milliseconds(600))
        case .scroll(let scroll):
          result.note = try await self.scroll(scroll)
        case .expand:
          guard let expand = QAProbe.expand else { throw QAScriptError("no thread or archived list on screen") }
          expand()
          try? await Task.sleep(for: .milliseconds(600))
        case .meter:
          guard let open = QAProbe.openMeter else { throw QAScriptError("no context meter on screen") }
          open()
          try? await Task.sleep(for: .milliseconds(800))
        case .modelPicker(let query):
          guard let open = QAProbe.openModelPicker else { throw QAScriptError("no new thread box on screen") }
          open(query)
          try? await Task.sleep(for: .milliseconds(1200))
        case .foldAll:
          guard let fold = QAProbe.foldAll else { throw QAScriptError("no sidebar fold-all button on screen") }
          fold()
          try? await Task.sleep(for: .milliseconds(800))
        case .searchHit(let i):
          guard let hit = QAProbe.openSearchHit?(i) else { throw QAScriptError("no search result \(i) on screen") }
          routedAt = .now
          result.note = try await revealed(hit)
        case .subagent(let i):
          guard let jump = QAProbe.jumpSubagent?(i) else { throw QAScriptError("no Running subagents row \(i) on screen") }
          result.note = try await revealed(thread: jump.thread, at: jump.at)
        case .editPending(let text):
          guard let edit = QAProbe.editPending, edit(text) else { throw QAScriptError("no editable unsent message on screen") }
          try? await Task.sleep(for: .milliseconds(500))
        case .webhookSecret(let id):
          guard let open = QAProbe.openWebhookSecret, open(id) else { throw QAScriptError("no webhook automation \(id) on screen") }
          try? await Task.sleep(for: .milliseconds(600))
        case .deliveries(let target):
          guard let show = QAProbe.showDeliveries else { throw QAScriptError("no Automations page on screen") }
          if let failure = await show(target) { throw QAScriptError(failure) }
          try? await Task.sleep(for: .milliseconds(600))
        case .imageZoom(let scale):
          guard let zoom = QAProbe.imageZoom else { throw QAScriptError("no image preview on screen") }
          if let scale { zoom.step(scale / zoom.scale) } else { zoom.fit() }
          try? await Task.sleep(for: .milliseconds(400))
        case .nativeBrowser(let address):
          guard let native = BrowserAnnotateProbe.native else { throw QAScriptError("the Web tab is not showing") }
          native.perform(.navigate(address))
          try? await Task.sleep(for: .milliseconds(300))
          let deadline = ContinuousClock.now + .seconds(15)
          while native.state.loading || native.state.url.isEmpty {
            guard ContinuousClock.now < deadline else { throw QAScriptError("the page did not finish loading: \(native.state.url)") }
            try? await Task.sleep(for: .milliseconds(100))
          }
          try? await Task.sleep(for: .milliseconds(500))
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
        case .settings(let tab):
          guard let openSettings = Self.openSettings else { throw QAScriptError("the main window has not appeared") }
          model.settingsTab = tab
          openSettings()
          try? await Task.sleep(for: .milliseconds(600))
        case .openThread(let id):
          guard let open = Self.openThreadWindow else { throw QAScriptError("the main window has not appeared") }
          open(id)
          try? await Task.sleep(for: .milliseconds(800))
        case .server(let action):
          guard model.settings.port != ServerSettings.defaultPort, model.supervisor.port != ServerSettings.defaultPort else {
            throw QAScriptError("port \(ServerSettings.defaultPort) is the live server")
          }
          switch action {
          case .start: await model.startServer()
          case .stop: await model.stopServer()
          case .check: await model.checkAgain()
          }
        case .type(let text):
          guard let composer = QAComposerProbe.current else { throw QAScriptError("no reply box is showing") }
          composer.setText(text)
          try? await Task.sleep(for: .milliseconds(300))
        case .run(let run):
          guard let composer = QAComposerProbe.current else { throw QAScriptError("no reply box is showing") }
          try composer.run(run)
          try? await Task.sleep(for: .milliseconds(800))
        case .send(let mode, let wait):
          guard let composer = QAComposerProbe.current else { throw QAScriptError("no reply box is showing") }
          if wait {
            try await composer.send(mode)
          } else {
            Task { try? await composer.send(mode) }
            try? await Task.sleep(for: .milliseconds(300))
          }
        case .attach(let path):
          guard let composer = QAComposerProbe.current else { throw QAScriptError("no reply box is showing") }
          guard let file = StagedFile.at(URL(fileURLWithPath: path)) else { throw QAScriptError("no file at \(path)") }
          composer.attach(file)
          try? await Task.sleep(for: .milliseconds(300))
        case .inspector(let command):
          guard let inspect = InspectorProbe.command else { throw QAScriptError("no thread is open") }
          inspect(command)
          try? await Task.sleep(for: .milliseconds(400))
        case .webTitle(let title):
          try await InspectorProbe.waitForTitle(title)
        case .selectLines(let file, let from, let to):
          guard let select = LineSelectionProbe.select else { throw QAScriptError("the Changes tab is not showing") }
          guard select(file, from, to) else { throw QAScriptError("no file \(file) whose lines can be picked") }
          try? await Task.sleep(for: .milliseconds(400))
        case .addContext(let note):
          guard let add = LineSelectionProbe.add else { throw QAScriptError("the Changes tab is not showing") }
          if let refused = add(note) { throw QAScriptError(refused) }
          try? await Task.sleep(for: .milliseconds(400))
        case .selectTerminal:
          guard let select = TerminalSelectionProbe.select, select() else { throw QAScriptError("the Terminal tab is not showing") }
          try? await Task.sleep(for: .milliseconds(400))
        case .addTerminal(let note):
          guard let add = TerminalSelectionProbe.add else { throw QAScriptError("no terminal output is selected") }
          if let refused = await add(note) { throw QAScriptError(refused) }
          try? await Task.sleep(for: .milliseconds(400))
        case .annotate(let action):
          try await annotate(action)
        case .browserAddress(let text, let escape):
          result.note = try await browserAddress(text, escape: escape)
        case .openContext(let index):
          guard let toggle = ContextChipsProbe.toggle, toggle(index) else { throw QAScriptError("no context chip \(index) in the reply box") }
          try? await Task.sleep(for: .milliseconds(400))
        case .referenceThread(let action):
          guard let probe = ThreadReferenceProbe.current else { throw QAScriptError("the thread header has no thread reference button") }
          try await probe.run(action)
          try? await Task.sleep(for: .milliseconds(500))
        case .quickPrompt(let action):
          guard let quick = Self.quickPrompt else { throw QAScriptError("no Quick Prompt") }
          switch action {
          case .open(let text): quick.show(dictate: false, text: text)
          case .send: await quick.submit(open: false)
          case .close: quick.hide()
          }
          try? await Task.sleep(for: .milliseconds(500))
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
  func end() async -> Never {
    if case .running(startedByApp: true, _) = model.supervisor.state {
      await model.stopServer()
    }
    await model.monitor.stop()
    write()
    exit(report.ok ? 0 : 1)
  }

  func finish(_ result: StepResult, _ started: ContinuousClock.Instant) {
    var result = result
    result.ms = Self.ms(ContinuousClock.now - started)
    if !result.ok { report.ok = false }
    report.steps.append(result)
  }

  static func ms(_ d: Duration) -> Int {
    Int(d.components.seconds * 1000 + d.components.attoseconds / 1_000_000_000_000_000)
  }

  func scriptData(_ text: String) throws -> Data {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.hasPrefix("[") || trimmed.hasPrefix("{") { return Data(trimmed.utf8) }
    return try Data(contentsOf: URL(filePath: (trimmed as NSString).expandingTildeInPath))
  }

  /// The settings form's calls, on the channel `qa-channel`, then the sidebar's reload.
  func channelStep(_ action: QAChannelAction) async throws(QAScriptError) {
    let id = "qa-channel"
    do {
      switch action {
      case .create:
        var form = ChannelForm()
        form.setName("QA Channel")
        form.notes = "Made by the QA run."
        _ = try await model.client.createChannel(form)
      case .edit:
        var form = ChannelForm(channel: try await model.client.channel(id).channel)
        form.setName("QA Channel Renamed")
        form.kind = .internal
        form.storeDomain = "https://qa-shop.myshopify.com/admin"
        form.notes = ""
        _ = try await model.client.updateChannel(id, form, system: false)
      case .archive, .unarchive:
        _ = try await model.client.setChannelArchived(id, action == .archive)
      }
    } catch {
      throw QAScriptError("channel \(action.rawValue): \(error.message)")
    }
    await model.store.reloadChannels()
  }

  /// Shows a folder state in the sidebar, through the same model the rows use.
  func folderStep(_ action: QAFolderAction) async throws(QAScriptError) {
    let folders = model.folders
    func folder(_ name: String) throws(QAScriptError) -> FolderWithThreads {
      let all = model.store.channels.flatMap(\.folders)
      guard let f = all.first(where: { $0.name == name }) else { throw QAScriptError("no folder named \(name)") }
      return f
    }
    func thread(_ title: String) throws(QAScriptError) -> ThreadStub {
      let all = model.store.channels.flatMap { $0.active + $0.recent + $0.folders.flatMap(\.threads) }
      guard let t = all.first(where: { $0.title == title }) else { throw QAScriptError("no thread titled \(title)") }
      return t
    }
    switch action {
    case .new(let channel):
      guard model.store.channel(channel) != nil else { throw QAScriptError("no channel \(channel)") }
      folders.editing = .new(channel: channel)
    case .create(let channel, let name):
      guard model.store.channel(channel) != nil else { throw QAScriptError("no channel \(channel)") }
      await folders.create(in: channel, name: name)
      if let failure = folders.failure { throw QAScriptError("\(failure.title): \(failure.message)") }
    case .rename(let name):
      folders.editing = .rename(try folder(name).id)
    case .delete(let name):
      folders.deletingID = try folder(name).id
    case .here(let name):
      model.openNewThread(.inFolder(try folder(name)))
    case .drag(let title, let name):
      folders.dragging = .thread(try thread(title))
      folders.dropTarget = try folder(name).id
    case .file(let title, let name):
      let t = try thread(title)
      folders.dragging = nil
      folders.dropTarget = nil
      await folders.move(t, to: try folder(name).id)
    case .menu(let name, let shot):
      try await menu(on: try folder(name), shot: shot)
    case .reset:
      folders.editing = nil
      folders.deletingID = nil
      folders.dragging = nil
      folders.dropTarget = nil
    }
  }


  func describe(_ step: QAStep) -> String {
    switch step {
    case .route(let route): "route \(route.hash)"
    case .wait(let condition, let timeout): "wait \(condition) up to \(timeout)"
    case .sleep(let duration): "sleep \(duration)"
    case .snapshot(let name): "snapshot \(name)"
    case .port(let port): "port \(port)"
    case .open(let window): "open \(window.rawValue)"
    case .settings(let tab): "settings \(tab.rawValue)"
    case .openThread(let id): "openThread \(id)"
    case .server(let action): "server \(action.rawValue)"
    case .appearance(let appearance): "appearance \(appearance.rawValue)"
    case .scroll(let scroll): "scroll \(scroll.rawValue)"
    case .expand: "expand"
    case .meter: "meter"
    case .modelPicker(let query): "modelPicker \(query)"
    case .foldAll: "foldAll"
    case .editPending(let text): "editPending \(text.prefix(40))"
    case .webhookSecret(let id): "webhookSecret \(id)"
    case .deliveries(let target): "deliveries \(target.automation)"
    case .searchHit(let i): "searchHit \(i)"
    case .subagent(let i): "subagent \(i)"
    case .imageZoom(let scale): "imageZoom \(scale.map { "\($0)" } ?? "fit")"
    case .nativeBrowser(let address): "nativeBrowser \(address.prefix(60))"
    case .type(let text): "type \(text.prefix(40))"
    case .run(let run): "run \(run.harness.rawValue) \(run.model) \(run.effort)"
    case .send(let mode, _): "send \(mode?.rawValue ?? "reply")"
    case .attach(let path): "attach \((path as NSString).lastPathComponent)"
    case .inspector(let command): "inspector \(command.rawValue)"
    case .webTitle(let title): "webTitle \(title)"
    case .channel(let action): "channel \(action.rawValue)"
    case .folder(let action): "folder \(action)"
    case .screen(let name): "screen \(name)"
    case .handoffMenu(let name): "handoffMenu \(name)"
    case .prMenu(let name): "prMenu \(name)"
    case .handOff(let device): "handOff \(device)"
    case .takeOver(let name): "takeOver \(name)"
    case .palette(let query): "palette \(query ?? "close")"
    case .quickPrompt(let action): "quickPrompt \(action)"
    case .selectLines(let file, let from, let to): "selectLines \(file) \(from)-\(to)"
    case .addContext(let note): "addContext \(note.prefix(40))"
    case .selectTerminal: "selectTerminal"
    case .addTerminal(let note): "addTerminal \(note.prefix(40))"
    case .annotate(let action): "annotate \(action)"
    case .browserAddress(let text, let escape): "browserAddress \(text)\(escape ? " escape" : "")"
    case .openContext(let index): "openContext \(index)"
    case .referenceThread(let action): "referenceThread \(action)"
    case .quit: "quit"
    }
  }

  func wait(for condition: QACondition, timeout: Duration) async throws(QAScriptError) {
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
  var facts: QAFacts {
    var f = model.qaFacts
    f.shownThread = QAProbe.shownThread
    f.browserFrame = BrowserAnnotateProbe.browser?.frame != nil
      || BrowserAnnotateProbe.native.map { $0.state.url.hasPrefix("http") && !$0.state.loading } == true
    return f
  }


  func abort(_ message: String) {
    report.ok = false
    report.error = message
    write()
    FileHandle.standardError.write(Data("QA: \(message)\n".utf8))
    exit(2)
  }

  func write() {
    let f = model.qaFacts
    report.facts = Facts(
      serverState: f.serverState, connection: f.connection, sidebarLoaded: f.sidebarLoaded, channels: f.channels.sorted(),
      route: model.route.hash, windows: Self.windows.map { $0.identifier?.rawValue ?? $0.title }
    )
    try? Self.encoder.encode(report).write(to: out.appending(path: "qa.json"))
  }

  /// The files the last snapshot wrote.
  var pending: [String] = []
}
#endif
