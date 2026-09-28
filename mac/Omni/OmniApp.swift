import AppKit
import OmniKit
import SwiftUI

@main
struct OmniApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

  var body: some Scene {
    Window("Omni", id: "main") {
      MainWindow(model: delegate.model, updater: delegate.updater)
    }
    .defaultSize(width: 1100, height: 720)
    .commands {
      SidebarCommands()
      OmniCommands(model: delegate.model)
    }

    WindowGroup("Artifact", id: "artifact", for: ArtifactRef.self) { $ref in
      if let ref { ArtifactWindowView(model: delegate.model, ref: ref) }
    }
    .defaultSize(width: 720, height: 640)

    Settings {
      SettingsView(model: delegate.model, appearance: delegate.appearance)
    }
  }
}

/// Owns the one app model and passes app activation, wake and network changes to it.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private(set) lazy var model: AppModel = makeModel()
  let appearance = AppearanceSettings()
  private(set) lazy var updater = Updater(model: model)
  private var quitting = false
  private var events: SystemEvents?

  #if DEBUG
  private let qa = QARunner.launch()
  #endif

  private func makeModel() -> AppModel {
    let settings = ServerSettings()
    #if DEBUG
    if let qa {
      // A QA run keeps its server's log, record and data in its out folder, away from the real ones.
      let options = qa.supervisorOptions(repo: settings.config.repo)
      return AppModel(settings: settings, supervisor: ServerSupervisor(settings: settings, options: options))
    }
    #endif
    return AppModel(settings: settings)
  }

  /// Before any window shows, so none draws in the wrong appearance first.
  func applicationWillFinishLaunching(_ notification: Notification) {
    appearance.follow { NSApp.appearance = $0.nsAppearance }
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    model.launch()
    updater.start()
    events = SystemEvents(model: model)
    #if DEBUG
    if let qa { QARunner.start(qa, model: model) }
    #endif
  }

  func applicationDidBecomeActive(_ notification: Notification) {
    model.banners.windowActive = true
    model.didBecomeActive()
    Task { await updater.check() }
  }

  func applicationDidResignActive(_ notification: Notification) {
    model.banners.windowActive = false
  }

  /// Quit asks while turns run. With none, an app-started server stops and a hand-started one is left alone.
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard !quitting else { return .terminateLater }
    quitting = true
    Task {
      let proceed = await confirmQuit()
      quitting = false
      sender.reply(toApplicationShouldTerminate: proceed)
    }
    return .terminateLater
  }

  private func confirmQuit() async -> Bool {
    let byApp = model.serverStartedByApp
    let action: QuitRules.Action
    switch await model.quitDecision() {
    case .quit(let stopServer):
      action = .quit(interruptTurns: false, stopServer: stopServer)
    case .ask(let running):
      action = QuitRules.action(for: QuitDialog.ask(runningTurns: running), serverStartedByApp: byApp)
    }
    guard case .quit(let interrupt, let stop) = action else { return false }
    await model.prepareToQuit(interruptTurns: interrupt, stopServer: stop)
    return true
  }

  /// The server keeps running after the app quits. It is not tied to the app.
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

struct OmniCommands: Commands {
  let model: AppModel

  var body: some Commands {
    CommandGroup(replacing: .newItem) {
      NewThreadButton(model: model)
        .keyboardShortcut("n")
    }
    CommandGroup(after: .pasteboard) {
      Divider()
      Button("Copy Thread as Markdown") {
        if let text = model.openThreadMarkdown { Pasteboard.copy(text) }
      }
      .keyboardShortcut("c", modifiers: [.command, .shift])
      .disabled(model.openThread == nil)
    }
    ThreadCommands(model: model)
    CommandGroup(after: .toolbar) {
      InspectorCommand(model: model)
    }
    CommandMenu("Go") {
      Button("Back") { model.goBack() }
        .keyboardShortcut("[")
        .disabled(!model.shell.history.canGoBack)
      Button("Forward") { model.goForward() }
        .keyboardShortcut("]")
        .disabled(!model.shell.history.canGoForward)
      Divider()
      Button("Home") { model.route = .home }
        .keyboardShortcut("h", modifiers: [.command, .shift])
      Button("Go to…") { model.shell.openPalette() }
        .keyboardShortcut("k")
      Button("Search") { model.route = .search(query: "") }
        .keyboardShortcut("f", modifiers: [.command, .shift])
    }
    CommandMenu("Server") {
      ServerMenuItems(model: model, shortcuts: true)
    }
  }
}
