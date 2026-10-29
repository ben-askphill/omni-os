import AppKit
import OmniKit
import SwiftUI

struct SettingsView: View {
  @Bindable var model: AppModel
  let appearance: AppearanceSettings
  let quickPrompt: QuickPromptController

  var body: some View {
    TabView(selection: $model.settingsTab) {
      Tab("Connection", systemImage: "network", value: .connection) {
        ConnectionSettings(settings: model.settings, model: model)
          .frame(width: z(560), height: 820)
      }
      Tab("Profile", systemImage: "person", value: .profile) {
        ProfileSettings(model: model)
          .frame(width: z(560), height: 420)
      }
      Tab("Secrets", systemImage: "key", value: .secrets) {
        SecretsSettings(model: model)
          .frame(width: z(560), height: 680)
      }
      Tab("Sync", systemImage: "arrow.triangle.2.circlepath", value: .sync) {
        SyncSettings(model: model)
          .frame(width: z(560), height: 680)
      }
      Tab("Storage", systemImage: "internaldrive", value: .storage) {
        StorageSettings(model: model)
          .frame(width: z(560), height: 680)
      }
      Tab("Notifications", systemImage: "bell", value: .notifications) {
        NotificationSettingsView(model: model, attention: model.attention)
          .frame(width: z(560), height: 600)
      }
      Tab("Appearance", systemImage: "circle.lefthalf.filled", value: .appearance) {
        AppearanceSettingsView(appearance: appearance, zoom: UIZoom.settings)
          .frame(width: 560, height: 360)
      }
      Tab("Quick Prompt", systemImage: "command", value: .quickPrompt) {
        QuickPromptSettingsView(controller: quickPrompt, settings: quickPrompt.settings)
          .frame(width: z(560), height: 600)
      }
    }
  }
}

/// The remote server, then the port, the repo and the Node override. The model follows the settings, so a change
/// applies at once: a new port or remote server reconnects, and any change checks the server again.
struct ConnectionSettings: View {
  @Bindable var settings: ServerSettings
  let model: AppModel

  var body: some View {
    SettingsPage {
      SettingsCard(
        title: "Use",
        note: settings.mode == .remote
          ? "Every thread runs on the remote server. The server on this Mac is left as it is."
          : "Every thread runs on this Mac. Switch to Remote to run them on the remote server below."
      ) {
        SegmentedPill(selection: $settings.mode, options: [(ServerMode.local, "This Mac"), (ServerMode.remote, "Remote")])
        if settings.remote == nil {
          Text("Set a remote URL below to switch to Remote.")
            .font(.omni(size: 12.5))
            .foregroundStyle(Tok.fg3)
        }
      }

      RemoteServerCard(settings: settings, model: model)

      SettingsCard(
        title: "Server on this Mac",
        note: settings.mode == .remote
          ? "Not used in Remote mode."
          : "The app looks for the server on this port and starts it from this repo. Leave Node empty to use the newest Node 24 or later it finds."
      ) {
        VStack(alignment: .leading, spacing: 0) {
          FieldLabel(text: "Port")
          PortField(port: $settings.port)
            .textFieldStyle(.omniMono)
            .frame(maxWidth: z(140))
        }
        PathField(title: "Repo", path: $settings.repoPath, prompt: ServerSettings.defaultRepoPath) {
          chooseRepo(from: settings.config.repo)
        }
        PathField(title: "Node", path: $settings.nodePath, prompt: "Detect automatically") {
          chooseNode(from: settings.config.node)
        }
        if settings.isVolatile {
          HStack(spacing: z(8)) {
            OmniIcon(name: "info", size: 13).foregroundStyle(Tok.fg3)
            Text("Launch arguments set these values, so changes last until the app quits.")
              .fixedSize(horizontal: false, vertical: true)
          }
          .font(.omni(size: 12.5))
          .foregroundStyle(Tok.fg2)
          .padding(.horizontal, z(14))
          .padding(.vertical, z(10))
          .frame(maxWidth: .infinity, alignment: .leading)
          .omniCard(16)
        }
      }

      SettingsCard(title: "Status") {
        InfoRows {
          InfoRow("Server", value: model.serverLabel)
          if let name = model.store.status?.device?.name {
            InfoRow("Machine", value: name)
          }
          InfoRow("Feed", value: feedLabel)
          InfoRow(label: "Log") {
            Button("Open Log") { openLog(model) }
              .buttonStyle(.pill(.secondary, height: 26))
              .disabled(!logExists(model))
          }
          if let commit = Bundle.main.object(forInfoDictionaryKey: "OmniGitCommit") as? String, !commit.isEmpty {
            InfoRow(label: "Build") {
              Text(String(commit.prefix(12)))
                .font(.omni(size: 12, design: .monospaced))
                .foregroundStyle(Tok.fg2)
                .textSelection(.enabled)
            }
          }
        }
      }
    }
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

/// An Omni on another machine, like a Linux box behind `tailscale serve`. Its URL and its token, which goes in
/// this Mac's Keychain. The app then runs every thread there and starts nothing here.
struct RemoteServerCard: View {
  @Bindable var settings: ServerSettings
  let model: AppModel
  @State private var draft = ""
  @State private var token = ""
  @State private var saved: String?
  @State private var error: String?
  @State private var hasToken = false
  @FocusState private var urlFocused: Bool
  private let store = RemoteTokenStore()

  var body: some View {
    SettingsCard(
      title: "Remote server",
      note: "Another machine's Omni, like a Linux box on your tailnet. Use its https address from tailscale serve. Used only in Remote mode."
    ) {
      VStack(alignment: .leading, spacing: 0) {
        FieldLabel(text: "URL")
        TextField("URL", text: $draft, prompt: Text("https://omarchy.tailnet.ts.net"))
          .textFieldStyle(.omniMono)
          .focused($urlFocused)
          .onSubmit(commit)
        if !draft.trimmingCharacters(in: .whitespaces).isEmpty, ServerSettings.remote(draft) == nil {
          ErrorNote(text: "Use an https address with no path, like https://omarchy.tailnet.ts.net.")
            .padding(.top, z(8))
        }
      }
      if let origin = settings.remote {
        VStack(alignment: .leading, spacing: 0) {
          FieldLabel(text: "Token")
          SecureField("Token", text: $token, prompt: Text(hasToken ? "Saved in the Keychain. Paste to replace" : "Paste data/api-token from that machine"))
            .textFieldStyle(.omniMono)
            .privacySensitive()
            .onSubmit { save(origin) }
        }
        if let error { ErrorNote(text: error) }
        HStack(spacing: z(10)) {
          Button("Save Token") { save(origin) }
            .buttonStyle(.pill(.primary, height: 34))
            .disabled(token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          if hasToken {
            Button("Remove Token") { remove(origin) }
              .buttonStyle(.pill(.secondary, height: 34))
          }
          if let saved { DoneNote(text: saved) }
          Spacer(minLength: 0)
        }
      }
    }
    .onAppear {
      draft = settings.remoteURL
      refreshToken()
    }
    .onChange(of: settings.remoteURL) { _, new in
      if !urlFocused { draft = new }
      refreshToken()
    }
    .onChange(of: urlFocused) { _, now in
      if !now { commit() }
    }
    .onDisappear(perform: commit)
  }

  /// A URL that is not one is kept in the field with its note, and applies nothing until it is fixed or cleared.
  private func commit() {
    let value = draft.trimmingCharacters(in: .whitespaces)
    guard value.isEmpty || ServerSettings.remote(value) != nil else { return }
    let normal = ServerSettings.remote(value)?.absoluteString ?? ""
    if normal != settings.remoteURL { settings.remoteURL = normal }
    draft = normal
  }

  private func save(_ origin: URL) {
    saved = nil
    guard store.save(token, for: origin) else { return error = "Could not save the token in the Keychain." }
    error = nil
    token = ""
    saved = "Saved"
    refreshToken()
    Task { await model.checkAgain() }
  }

  private func remove(_ origin: URL) {
    saved = nil
    guard store.delete(origin) else { return error = "Could not remove the token from the Keychain." }
    error = nil
    refreshToken()
    Task { await model.checkAgain() }
  }

  private func refreshToken() {
    hasToken = settings.remote.map(store.has) ?? false
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
    VStack(alignment: .leading, spacing: 0) {
      FieldLabel(text: title)
      HStack(spacing: z(8)) {
        TextField(title, text: $draft, prompt: Text(prompt))
          .textFieldStyle(.omniMono)
          .frame(minWidth: z(160), idealWidth: z(260), maxWidth: .infinity)
          .focused($focused)
          .onSubmit(commit)
        Button("Choose") {
          if let picked = choose() {
            draft = picked
            commit()
          }
        }
        .buttonStyle(.pill(.secondary, height: 38))
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
