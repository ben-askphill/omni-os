import AppKit
import OmniKit
import SwiftUI

@main
struct OmniApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

  var body: some Scene {
    Window("Omni", id: "main") {
      MainWindow(model: delegate.model)
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
    events = SystemEvents(model: model)
    #if DEBUG
    if let qa { QARunner.start(qa, model: model) }
    #endif
  }

  func applicationDidBecomeActive(_ notification: Notification) {
    model.didBecomeActive()
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
    CommandMenu("Server") {
      ServerMenuItems(model: model, shortcuts: true)
    }
  }
}
