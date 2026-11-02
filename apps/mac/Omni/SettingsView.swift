import AppKit
import OmniKit
import SwiftUI

/// The Settings window: a searchable sidebar of grouped sections beside one section at a time, the same sections,
/// groups and order as the Web UI's Settings nav and the phone's Settings screen (SettingsCatalog.swift, from
/// packages/shared/settings-catalog.ts). A scoped section shows the channel picker under its title; the picked channel
/// stays picked from section to section. ⌘, and the sidebar's Settings row both open General.
struct SettingsView: View {
  @Bindable var model: AppModel
  let appearance: AppearanceSettings
  let quickPrompt: QuickPromptController
  @State private var query = ""

  var body: some View {
    NavigationSplitView {
      SettingsSidebar(model: model, query: $query)
        .navigationSplitViewColumnWidth(min: z(200), ideal: z(224), max: z(280))
    } detail: {
      SettingsDetail(model: model, appearance: appearance, quickPrompt: quickPrompt)
    }
    .frame(minWidth: z(820), idealWidth: z(900), minHeight: 600, idealHeight: 760)
  }
}

/// The groups of sections, or the settings a search finds. Picking a result opens its section.
private struct SettingsSidebar: View {
  @Bindable var model: AppModel
  @Binding var query: String

  var body: some View {
    let hits = SettingsCatalog.search(query)
    List(selection: Binding<SettingsTab?>(get: { model.settingsTab }, set: { if let tab = $0 { model.settingsTab = tab } })) {
      if query.trimmingCharacters(in: .whitespaces).isEmpty {
        ForEach(SettingsCatalog.groups) { group in
          if group.title.isEmpty {
            rows(group.id)
          } else {
            Section(group.title) { rows(group.id) }
          }
        }
      } else if hits.isEmpty {
        Text("No setting matches.").font(.omni(size: 12.5)).foregroundStyle(Tok.fg3)
      } else {
        ForEach(hits) { e in
          Button {
            if let tab = SettingsTab(rawValue: e.section) { model.settingsTab = tab }
            query = ""
          } label: {
            VStack(alignment: .leading, spacing: z(1)) {
              Text(e.title).font(.omni(size: 13)).foregroundStyle(Tok.fg)
              Text(SettingsCatalog.section(e.section).title).font(.omni(size: 11.5)).foregroundStyle(Tok.fg3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
      }
    }
    .listStyle(.sidebar)
    .searchable(text: $query, placement: .sidebar, prompt: "Search settings")
  }

  @ViewBuilder private func rows(_ group: String) -> some View {
    ForEach(SettingsCatalog.sections(in: group)) { s in
      if let tab = SettingsTab(rawValue: s.id) {
        Label {
          Text(s.title)
        } icon: {
          OmniIcon(name: s.icon, size: 15)
        }
        .tag(tab)
      }
    }
  }
}

/// The section's title, its one line, the scope picker when it has one, and the section itself.
private struct SettingsDetail: View {
  @Bindable var model: AppModel
  let appearance: AppearanceSettings
  let quickPrompt: QuickPromptController

  var body: some View {
    let section = model.settingsTab.section
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: z(6)) {
        Text(section.title).font(.omni(size: 24, weight: .medium)).tracking(-0.24).foregroundStyle(Tok.fg)
        Text(section.blurb).font(.omni(size: 13)).foregroundStyle(Tok.fg3)
        if section.scoped == true {
          SettingsScopeBar(model: model).padding(.top, z(8))
        }
      }
      .padding(.horizontal, z(24))
      .padding(.top, z(20))
      .padding(.bottom, z(4))
      .frame(maxWidth: .infinity, alignment: .leading)
      content
    }
    .background(Tok.bg)
  }

  @ViewBuilder private var content: some View {
    switch model.settingsTab {
    case .general:
      SettingsPage {
        ProfileSettings(model: model, part: .general)
        QuickPromptSettingsView(controller: quickPrompt, settings: quickPrompt.settings)
      }
    case .appearance:
      SettingsPage {
        AppearanceSettingsView(appearance: appearance, zoom: UIZoom.settings)
        Text("Appearance and zoom stay on this Mac and never sync.").font(.omni(size: 12.5)).foregroundStyle(Tok.fg3)
      }
    case .notifications:
      SettingsPage { NotificationSettingsView(model: model, attention: model.attention, scoped: model.scopedChannel?.id) }
    case .models: ModelsSection(model: model)
    case .threads: ThreadsSection(model: model)
    case .channels: ChannelsSection(model: model)
    case .workspace: WorkspaceSection(model: model)
    case .worktrees: WorktreesSection(model: model)
    case .machines: MachinesSettingsPage(settings: model.settings, model: model)
    case .sync: SyncSection(model: model)
    case .access: AccessSection(model: model)
    case .integrations: SettingsPage { ProfileSettings(model: model, part: .integrations) }
    case .secrets: SecretsSettings(model: model, scoped: model.scopedChannel?.id)
    case .about: AboutSection(model: model)
    }
  }
}

/// The Machines section: this Mac (its name and the server's state), the port, repo and Node the app runs the server
/// with, its log and build, and the server options from .env. The model follows the settings, so a change applies at
/// once: a new port reconnects, and any change checks the server again. Sync, Sharing & access and Worktrees were
/// parts of this tab before; they are sections of their own now.
struct MachinesSettingsPage: View {
  @Bindable var settings: ServerSettings
  let model: AppModel

  var body: some View {
    SettingsPage {
      SettingsCard(title: RunOnRules.hereLabel(model.store.status?.device?.name), note: "The machine this app runs Omni on, as other machines and the sync list name it.") {
        InfoRows {
          if let name = model.store.status?.device?.name { InfoRow("Machine", value: name) }
          InfoRow("Server", value: model.supervisor.state.label)
        }
      }
      AdvancedFold(summary: "Port, repo, Node, log and build") {
        serverCard
        statusCard
      }
      ServerOptionsFold(model: model, section: "machines", title: "Server port and host")
    }
  }

  /// The port, repo and Node the app runs the server with.
  private var serverCard: some View {
    SettingsCard(
      title: "This Mac's server",
      note: "The app looks for the server on this port and starts it from this repo. Leave Node empty to use the newest Node 24 or later it finds."
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
  }

  /// The server's state, the feed, the log and the build.
  private var statusCard: some View {
    SettingsCard(title: "Status") {
      InfoRows {
        InfoRow("Server", value: model.supervisor.state.label)
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
