import AppKit
import OmniKit
import SwiftUI

struct SettingsView: View {
  @Bindable var model: AppModel
  let appearance: AppearanceSettings

  var body: some View {
    TabView(selection: $model.settingsTab) {
      Tab("Connection", systemImage: "network", value: .connection) {
        ConnectionSettings(settings: model.settings, model: model)
          .frame(width: 560, height: 520)
      }
      Tab("Secrets", systemImage: "key", value: .secrets) {
        SecretsSettings(model: model)
          .frame(width: 560, height: 680)
      }
      Tab("Sync", systemImage: "arrow.triangle.2.circlepath", value: .sync) {
        SyncSettings(model: model)
          .frame(width: 560, height: 680)
      }
      Tab("Appearance", systemImage: "circle.lefthalf.filled", value: .appearance) {
        AppearanceSettingsView(appearance: appearance)
          .frame(width: 560, height: 220)
      }
    }
  }
}

/// The port, the repo and the Node override. The model follows the settings, so a change applies at once:
/// a new port reconnects, and any change checks the server again.
struct ConnectionSettings: View {
  @Bindable var settings: ServerSettings
  let model: AppModel

  var body: some View {
    Form {
      Section {
        PortField(port: $settings.port)
        PathField(title: "Repo", path: $settings.repoPath, prompt: ServerSettings.defaultRepoPath) {
          chooseRepo(from: settings.config.repo)
        }
        PathField(title: "Node", path: $settings.nodePath, prompt: "Detect automatically") {
          chooseNode(from: settings.config.node)
        }
      } header: {
        Text("Server")
      } footer: {
        Text("The app looks for the server on this port and starts it from this repo. Leave Node empty to use the newest Node 24 or later it finds.")
          .foregroundStyle(.secondary)
      }

      if settings.isVolatile {
        Section {
          Label("Launch arguments set these values, so changes last until the app quits.", systemImage: "info.circle")
            .foregroundStyle(.secondary)
        }
      }

      Section("Status") {
        LabeledContent("Server", value: model.supervisor.state.label)
        LabeledContent("Feed", value: feedLabel)
        LabeledContent("Log") {
          Button("Open Log") { openLog(model) }
            .disabled(!logExists(model))
        }
        if let commit = Bundle.main.object(forInfoDictionaryKey: "OmniGitCommit") as? String, !commit.isEmpty {
          LabeledContent("Build", value: String(commit.prefix(12)))
            .textSelection(.enabled)
        }
      }
    }
    .formStyle(.grouped)
  }

  private var feedLabel: String {
    switch model.store.connection {
    case .open: "Connected"
    case .connecting: "Connecting"
    case .reconnecting: "Reconnecting"
    case .closed: "Closed"
    }
  }
}

/// The port as typed. Like a path it applies on Return, focus loss or when Settings closes, so typing 4759
/// does not try ports 4, 47 and 475 on the way. A number that is not a port puts the current one back.
struct PortField: View {
  @Binding var port: Int
  @State private var draft = ""
  @FocusState private var focused: Bool

  var body: some View {
    TextField("Port", text: $draft)
      .focused($focused)
      .onSubmit(commit)
      .onAppear { draft = String(port) }
      .onChange(of: port) { _, new in
        if !focused { draft = String(new) }
      }
      .onChange(of: focused) { _, now in
        if !now { commit() }
      }
      .onDisappear(perform: commit)
  }

  private func commit() {
    if let n = Int(draft.trimmingCharacters(in: .whitespaces)), n != port { port = n }
    draft = String(port)
  }
}

/// A path typed or picked. Typing applies on Return, when the field loses focus or when Settings closes
/// (closing a window does not end editing), not per key.
struct PathField: View {
  let title: String
  @Binding var path: String
  let prompt: String
  let choose: () -> String?
  @State private var draft = ""
  @FocusState private var focused: Bool

  var body: some View {
    LabeledContent(title) {
      HStack {
        TextField(title, text: $draft, prompt: Text(prompt))
          .labelsHidden()
          .frame(minWidth: 160, idealWidth: 260, maxWidth: .infinity)
          .focused($focused)
          .onSubmit(commit)
        Button("Choose…") {
          if let picked = choose() {
            draft = picked
            commit()
          }
        }
      }
    }
    .onAppear { draft = path }
    .onChange(of: path) { _, new in
      if !focused { draft = new }
    }
    .onChange(of: focused) { _, now in
      if !now { commit() }
    }
    .onDisappear(perform: commit)
  }

  private func commit() {
    let value = draft.trimmingCharacters(in: .whitespaces)
    if value != path { path = value }
  }
}

@MainActor private func chooseRepo(from current: URL) -> String? {
  let panel = NSOpenPanel()
  panel.canChooseDirectories = true
  panel.canChooseFiles = false
  panel.allowsMultipleSelection = false
  panel.message = "Choose the omni-os folder"
  panel.prompt = "Choose"
  panel.directoryURL = current
  guard panel.runModal() == .OK, let url = panel.url else { return nil }
  return (url.path as NSString).abbreviatingWithTildeInPath
}

@MainActor private func chooseNode(from current: URL?) -> String? {
  let panel = NSOpenPanel()
  panel.canChooseDirectories = false
  panel.canChooseFiles = true
  panel.allowsMultipleSelection = false
  panel.showsHiddenFiles = true
  panel.treatsFilePackagesAsDirectories = true
  panel.message = "Choose a node binary, version 24 or later"
  panel.prompt = "Choose"
  let nvm = URL.homeDirectory.appending(path: ".nvm/versions/node")
  if let current {
    panel.directoryURL = current.deletingLastPathComponent()
  } else if FileManager.default.fileExists(atPath: nvm.path) {
    panel.directoryURL = nvm
  }
  guard panel.runModal() == .OK, let url = panel.url else { return nil }
  return (url.path as NSString).abbreviatingWithTildeInPath
}
