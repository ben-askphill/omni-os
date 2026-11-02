import OmniKit
import SwiftUI

// The Settings window's sections that the Web UI draws in apps/web/src/pages/Settings.tsx and SettingsAgents.tsx,
// and the pieces they share: the provenance chip beside a value, the channel scope picker and the .env options.
// SettingsView.swift lays them out beside the searchable sidebar.

// MARK: Shared pieces

/// Where a value comes from (`Origin` in settings-parts.tsx), with Reset beside a value Omni saved.
struct OriginChip: View {
  let of: Provenance
  var label: String? = nil
  var reset: (() -> Void)? = nil

  var body: some View {
    HStack(spacing: z(6)) {
      Chip(text: label ?? of.label, tone: tone)
      if let reset, of.resettable {
        Button("Reset", action: reset)
          .buttonStyle(.plain)
          .font(.omni(size: 11.5))
          .foregroundStyle(Tok.fg3)
      }
    }
    .fixedSize()
  }

  private var tone: Chip.Tone {
    switch of {
    case .default, .inherited, .device, .mixed: .outline
    case .env: .ink
    case .machine: .plain
    case .channel: .live
    }
  }
}

extension AppModel {
  /// Settings' channel in scope, nil for Every channel. One that is gone or archived reads as Every channel.
  var scopedChannel: ChannelWithRunning? {
    settingsScope.isEmpty ? nil : store.channels.first { $0.id == settingsScope && !$0.archived }
  }
}

/// The scope picker of a scoped section, as the web's `ScopeBar`: Every channel or one channel. It stays picked from
/// section to section.
struct SettingsScopeBar: View {
  @Bindable var model: AppModel

  var body: some View {
    let listed = model.store.channels.filter { !$0.archived }
    HStack(spacing: z(10)) {
      Text("Scope").font(.omni(size: 12.5)).foregroundStyle(Tok.fg3)
      Picker("Scope", selection: Binding(get: { model.scopedChannel?.id ?? "" }, set: { model.settingsScope = $0 })) {
        Text("Every channel").tag("")
        ForEach(listed) { c in
          Text(c.id == "conductor" ? "Conductor" : "#\(c.name)").tag(c.id)
        }
      }
      .labelsHidden()
      .fixedSize()
      Text(model.scopedChannel == nil ? "Showing this machine's values. Pick a channel to see its own." : "Showing what this channel sets and what it inherits.")
        .font(.omni(size: 12.5))
        .foregroundStyle(Tok.fg3)
    }
  }
}

/// The .env options for one section (`ServerOptions` in settings-parts.tsx): read-only, each with where it came from.
struct ServerOptionsFold: View {
  let model: AppModel
  let section: String
  var title = "Server options"
  @State private var options: [ServerOption]?
  @State private var error: String?

  var body: some View {
    Group {
      if let rows = options?.filter({ $0.section == section }), !rows.isEmpty {
        let set = rows.filter(\.fromEnv).count
        AdvancedFold(title: title, summary: set > 0 ? "\(set) set in .env" : "All built-in defaults") {
          Text("Read from \(Text(".env").monospaced()) or the environment when the server starts. Change one there and restart the server.")
            .font(.omni(size: 12.5))
            .foregroundStyle(Tok.fg3)
            .fixedSize(horizontal: false, vertical: true)
          VStack(alignment: .leading, spacing: z(12)) {
            ForEach(rows) { o in
              HStack(alignment: .top, spacing: z(12)) {
                VStack(alignment: .leading, spacing: z(2)) {
                  Text(o.label).font(.omni(size: 13, weight: .medium)).foregroundStyle(Tok.fg)
                  Text(o.hint).font(.omni(size: 12)).foregroundStyle(Tok.fg3).fixedSize(horizontal: false, vertical: true)
                  Text(o.env).font(.omni(size: 11.5, design: .monospaced)).foregroundStyle(Tok.fg3)
                }
                Spacer(minLength: z(8))
                VStack(alignment: .trailing, spacing: z(4)) {
                  Text(o.value).font(.omni(size: 12.5, design: .monospaced)).foregroundStyle(Tok.fg).textSelection(.enabled)
                  OriginChip(of: o.fromEnv ? .env : .default)
                    .help(o.fromEnv ? "Built-in default: \(o.default)" : "")
                }
              }
            }
          }
        }
      } else if let error {
        ErrorNote(text: error)
      }
    }
    .task(id: model.client.baseURL) {
      do {
        options = try await model.client.serverOptions().options
        error = nil
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}

// MARK: Harnesses & models

/// Each harness with whether it can run, how to fix it, its models and its cap.
struct HarnessesCard: View {
  let model: AppModel
  let channel: String?
  @State private var harnesses: [HarnessInfo]?
  @State private var error: String?

  var body: some View {
    SettingsCard(title: "Harnesses", note: "The agents Omni can start a thread on. Omni checks each one again when a picker opens.") {
      if let harnesses {
        VStack(alignment: .leading, spacing: z(12)) {
          ForEach(harnesses) { h in row(h) }
        }
      } else if let error {
        ErrorNote(text: error)
      } else {
        Loader(size: 16)
      }
    }
    .task(id: channel ?? "") {
      do {
        if let channel {
          harnesses = try await model.client.harnesses(channel: channel)
        } else {
          harnesses = try await model.client.harnesses()
        }
        error = nil
      } catch {
        self.error = error.localizedDescription
      }
    }
  }

  private func row(_ h: HarnessInfo) -> some View {
    let def = h.models.first(where: \.isDefault) ?? h.models.first
    let count = h.models.count == 1 ? "1 model" : "\(h.models.count) models"
    return HStack(alignment: .top, spacing: z(12)) {
      HarnessMark(harness: h.id.rawValue)
      VStack(alignment: .leading, spacing: z(2)) {
        HStack(spacing: z(8)) {
          Text(h.name).font(.omni(size: 13.5, weight: .medium)).foregroundStyle(Tok.fg)
          GlyphView(glyph: h.available ? .done : .needs, size: 7)
          Text(h.available ? "Ready" : "Not ready").font(.omni(size: 12)).foregroundStyle(Tok.fg3)
        }
        Text("\(h.plan) · \(count)\(def.map { " · default \($0.label)" } ?? "") · \(h.running) of \(h.cap) running")
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg3)
        if !h.available, let fix = h.fix ?? h.install {
          Text("To fix: \(fix)")
            .font(.omni(size: 12))
            .foregroundStyle(Tok.fg2)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
    }
  }
}

/// A channel's default as one line: Auto, or the harness and model with its effort.
func runDefaultLabel(_ c: Channel, harnesses: [HarnessInfo]?) -> String {
  let run = c.runDefaults
  guard run.setsRun, !run.isAuto else { return "Auto" }
  let harness = run.harness ?? .claudeCode
  let h = harnesses?.first { $0.id == harness }
  let model = h?.models.first { $0.id == run.model }?.label ?? (run.model?.isEmpty == false ? run.model! : "its default model")
  return [h?.name ?? harness.rawValue, model, run.effort ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
}

/// Every channel: what a new thread starts on in each, and which set their own (T3's "mixed").
struct ChannelDefaultsCard: View {
  @Bindable var model: AppModel
  @State private var harnesses: [HarnessInfo]?

  var body: some View {
    let listed = model.store.channels.filter { !$0.archived }
    let own = listed.filter { $0.channel.runDefaults.setsRun }
    SettingsCard(
      title: "Default model for new threads",
      note: "Each channel can name the model its new threads start on. Without one, Auto picks from the prompt. A thread or crew role that picks its own wins.",
      trailing: { OriginChip(of: own.isEmpty ? .default : .mixed, label: own.isEmpty ? "Auto everywhere" : "\(own.count) of \(listed.count) channels set one") }
    ) {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(listed) { c in
          Button {
            model.settingsScope = c.id
          } label: {
            HStack(spacing: z(10)) {
              Text(c.id == "conductor" ? "Conductor" : "#\(c.name)").font(.omni(size: 13)).foregroundStyle(Tok.fg).lineLimit(1)
              Spacer(minLength: z(8))
              Text(runDefaultLabel(c.channel, harnesses: harnesses)).font(.omni(size: 12.5)).foregroundStyle(Tok.fg2).lineLimit(1)
              OriginChip(of: c.channel.runDefaults.setsRun ? .channel : .default, label: c.channel.runDefaults.setsRun ? "Set on channel" : "Built-in default")
            }
            .padding(.vertical, z(8))
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
      }
      Text("Pick a channel to change its default.").font(.omni(size: 12)).foregroundStyle(Tok.fg3)
    }
    .task(id: model.client.baseURL) { harnesses = try? await model.client.harnesses() }
  }
}

/// One channel in scope: its default with where it comes from, Reset, and the form that changes it.
struct ChannelModelCard: View {
  @Bindable var model: AppModel
  let channel: Channel
  @State private var harnesses: [HarnessInfo]?
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    let set = channel.runDefaults.setsRun
    let resetAction: (() -> Void)? = busy ? nil : { reset() }
    SettingsCard(
      title: "Default model for new threads",
      note: "What a new thread in this channel starts on. A thread or crew role that picks its own wins.",
      trailing: { OriginChip(of: set ? .channel : .default, label: set ? "Set on #\(channel.name)" : "Built-in default: Auto", reset: resetAction) }
    ) {
      HStack(spacing: z(10)) {
        Text(runDefaultLabel(channel, harnesses: harnesses)).font(.omni(size: 13.5)).foregroundStyle(Tok.fg)
        Spacer(minLength: 0)
        Button("Change in Channels") { model.settingsTab = .channels }
          .buttonStyle(.pill(.secondary, height: 30))
      }
      if let error { ErrorNote(text: error) }
    }
    .task(id: channel.id) { harnesses = try? await model.client.harnesses(channel: channel.id) }
  }

  private func reset() {
    var form = ChannelForm(channel: channel)
    form.clearDefaultRun()
    busy = true
    Task {
      defer { busy = false }
      do {
        _ = try await model.client.updateChannel(channel.id, form, system: channel.kind == .system)
        await model.store.reloadChannels()
        error = nil
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}

struct ModelsSection: View {
  @Bindable var model: AppModel

  var body: some View {
    SettingsPage {
      HarnessesCard(model: model, channel: model.scopedChannel?.id)
      if let c = model.scopedChannel {
        ChannelModelCard(model: model, channel: c.channel).id(c.id)
      } else {
        ChannelDefaultsCard(model: model)
      }
      ServerOptionsFold(model: model, section: "models")
    }
  }
}

// MARK: Threads

/// Where new threads run, saved on pick through PUT /api/setup. With no other machine synced there is nothing to
/// pick, unless a saved machine has dropped out of sync: then This Mac stays pickable.
struct RunOnCard: View {
  let model: AppModel

  var body: some View {
    let devices = model.devices.devices
    let saved = model.runOn.saved
    SettingsCard(
      title: "Run new threads on",
      note: "New threads run there unless the composer picks another machine. Replies and Stop follow the thread wherever it runs.",
      trailing: {
        OriginChip(of: saved.isEmpty ? .default : .machine, label: saved.isEmpty ? "Built-in default: \(RunOnRules.hereLabel(model.store.status?.device?.name))" : nil) {
          Task { await model.runOn.save("") }
        }
      }
    ) {
      VStack(alignment: .leading, spacing: z(10)) {
        HStack(spacing: z(8)) {
          // A saved machine sync no longer lists shows as this one, where the server runs it.
          RunOnMenu(devices: devices, pick: RunOnRules.resolved(saved, devices: devices), hereName: model.store.status?.device?.name) { device in Task { await model.runOn.save(device) } }
            .disabled((devices.isEmpty && saved.isEmpty) || model.runOn.saving)
            .opacity(devices.isEmpty && saved.isEmpty ? 0.45 : 1)
          if model.runOn.saving { Loader(size: 14) }
        }
        if devices.isEmpty {
          Text(
            saved.isEmpty
              ? "No other machine is synced, so threads run on this one. Set up Sync on both machines to pick one."
              : "The saved machine isn't synced now, so new threads can't start there. Pick \(RunOnRules.hereLabel(model.store.status?.device?.name)), or check Sync."
          )
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg3)
          .fixedSize(horizontal: false, vertical: true)
        }
        if let error = model.runOn.error { ErrorNote(text: error) }
      }
    }
    .task(id: model.client.baseURL) {
      await model.runOn.load()
      await model.devices.refresh()
    }
  }
}

struct ThreadsSection: View {
  let model: AppModel

  var body: some View {
    SettingsPage {
      RunOnCard(model: model)
      ServerOptionsFold(model: model, section: "threads", title: "Sessions, usage limits and thread features")
      SettingsCard(
        title: "Automations",
        note: "Threads that start on a schedule, a GitHub event or a webhook. They have a page of their own in the main window.",
        trailing: {
          Button("Open Automations") { model.route = .automations }
            .buttonStyle(.pill(.secondary, height: 30))
        }
      ) { EmptyView() }
    }
  }
}

// MARK: Code

struct ChannelsSection: View {
  @Bindable var model: AppModel

  var body: some View {
    if let c = model.scopedChannel {
      SettingsPage {
        ChannelSettingsForm(model: model, existing: c.channel).id(c.id)
      }
    } else {
      SettingsPage {
        let listed = model.store.channels.filter { !$0.archived }
        let archived = model.store.channels.filter { $0.archived }
        SettingsCard(
          title: "Your channels",
          note: "One per client or project. Pick one to see and change its settings; it stays picked as you move between sections.",
          trailing: {
            Button("New channel") { model.route = .newChannel }
              .buttonStyle(.pill(.secondary, height: 30))
          }
        ) {
          VStack(alignment: .leading, spacing: 0) {
            ForEach(listed) { c in
              Button {
                model.settingsScope = c.id
              } label: {
                HStack(spacing: z(10)) {
                  ChannelAvatar(name: c.name, conductor: c.id == "conductor", size: 28, icon: c.icon)
                  VStack(alignment: .leading, spacing: z(1)) {
                    Text(c.id == "conductor" ? "Conductor" : "#\(c.name)").font(.omni(size: 13.5)).foregroundStyle(Tok.fg)
                    Text(c.repoPath ?? c.baseDir ?? "Workspace folder").font(.omni(size: 11.5, design: .monospaced)).foregroundStyle(Tok.fg3).lineLimit(1)
                  }
                  Spacer(minLength: 0)
                  OmniIcon(name: "chevronRight", size: 14).foregroundStyle(Tok.fg3)
                }
                .padding(.vertical, z(8))
                .contentShape(Rectangle())
              }
              .buttonStyle(.plain)
            }
          }
        }
        if !archived.isEmpty {
          AdvancedFold(title: "Archived", summary: "\(archived.count)") {
            ForEach(archived) { c in
              HStack {
                Text("#\(c.name)").font(.omni(size: 13))
                Spacer()
                Button("Open to unarchive") { model.route = .channel(id: c.id) }
                  .buttonStyle(.pill(.secondary, height: 26))
              }
            }
          }
        }
      }
    }
  }
}

/// The channel in scope's folder: its repo, its base directory, or the workspace folder it inherits.
private struct ChannelFolderCard: View {
  @Bindable var model: AppModel
  let channel: Channel
  let workspaceRoot: String?

  var body: some View {
    SettingsCard(title: "Where #\(channel.name)'s threads run", note: "A channel with a repo runs each thread in a worktree of it; without one, in its base directory, else your workspace folder.") {
      HStack(alignment: .top, spacing: z(8)) {
        VStack(alignment: .leading, spacing: z(2)) {
          FieldLabel(text: channel.repoPath != nil ? "Repo" : "Base directory")
          Text(channel.repoPath ?? channel.baseDir ?? workspaceRoot ?? "…")
            .font(.omni(size: 12.5, design: .monospaced))
            .foregroundStyle(channel.repoPath ?? channel.baseDir == nil ? Tok.fg2 : Tok.fg)
            .textSelection(.enabled)
        }
        Spacer(minLength: 0)
        if channel.repoPath != nil || channel.baseDir != nil {
          OriginChip(of: .channel, label: "Set on #\(channel.name)")
        } else {
          OriginChip(of: .inherited, label: "Inherited: workspace folder")
        }
      }
      Button("Change in Channels") { model.settingsTab = .channels }
        .buttonStyle(.pill(.secondary, height: 30))
    }
  }
}

struct WorkspaceSection: View {
  @Bindable var model: AppModel
  @State private var root: String?

  var body: some View {
    SettingsPage {
      if let c = model.scopedChannel {
        ChannelFolderCard(model: model, channel: c.channel, workspaceRoot: root)
      }
      ProfileSettings(model: model, part: .workspace)
    }
    .task(id: model.client.baseURL) { root = try? await model.client.setup().resolved.workspaceRoot }
  }
}

struct WorktreesSection: View {
  @Bindable var model: AppModel

  var body: some View {
    SettingsPage {
      if let c = model.scopedChannel {
        let repo = c.repoPath != nil
        SettingsCard(
          title: "Worktrees in #\(c.name)",
          note: repo ? "Each new thread gets its own git worktree and branch, so threads never share a checkout." : "This channel has no repo, so its threads run in a folder and get no worktree.",
          trailing: { if repo { OriginChip(of: .channel, label: "Set on #\(c.name)") } }
        ) {
          if repo {
            HStack {
              Text("Worktree per thread").font(.omni(size: 13))
              Spacer()
              Text(c.useWorktree ? "On" : "Off").font(.omni(size: 13)).foregroundStyle(Tok.fg2)
              Button("Change") { model.settingsTab = .channels }
                .buttonStyle(.pill(.secondary, height: 26))
            }
          }
          Text("Cleanup below is per machine. A channel cannot set its own yet.").font(.omni(size: 12)).foregroundStyle(Tok.fg3)
        }
      }
      StorageSettings(model: model)
      ServerOptionsFold(model: model, section: "worktrees")
    }
  }
}

// MARK: Connections and About

struct AccessSection: View {
  let model: AppModel

  var body: some View {
    SettingsPage {
      GoogleAccountSettings(model: model)
      ConnectSettings(model: model)
      ProfileSettings(model: model, part: .access)
    }
  }
}

struct SyncSection: View {
  let model: AppModel

  var body: some View {
    SettingsPage {
      SyncSettings(model: model)
      AdvancedFold(summary: "Where your folders are on your other machines") {
        SyncPathMap(model: model)
      }
    }
  }
}

struct AboutSection: View {
  let model: AppModel
  @State private var configPath: String?

  var body: some View {
    let server = model.store.status?.server
    SettingsPage {
      SettingsCard(title: "Version and build") {
        InfoRows {
          InfoRow("Version", value: server?.version ?? "…")
          InfoRow(label: "Commit") {
            Text(server?.gitHead.map { String($0.prefix(12)) } ?? "Unknown").font(.omni(size: 12, design: .monospaced)).textSelection(.enabled)
          }
          if let commit = Bundle.main.object(forInfoDictionaryKey: "OmniGitCommit") as? String, !commit.isEmpty {
            InfoRow(label: "App build") {
              Text(String(commit.prefix(12))).font(.omni(size: 12, design: .monospaced)).textSelection(.enabled)
            }
          }
          if let started = server?.startedAt {
            InfoRow("Started", value: RelTime.label(started, now: .now))
          }
        }
      }
      SettingsCard(title: "Where Omni keeps its files", note: "All on this machine. None of it goes into git.") {
        InfoRows {
          InfoRow(label: "Repo") { Text(server?.root ?? "…").font(.omni(size: 12, design: .monospaced)).textSelection(.enabled) }
          InfoRow(label: "Data") { Text(server?.dataDir ?? "…").font(.omni(size: 12, design: .monospaced)).textSelection(.enabled) }
          InfoRow(label: "Config") { Text(configPath ?? "data/omni.config.json").font(.omni(size: 12, design: .monospaced)).textSelection(.enabled) }
          InfoRow("Secrets", value: (server?.secretStore ?? .keychain).label)
        }
      }
    }
    .task(id: model.client.baseURL) { configPath = try? await model.client.setup().path }
  }
}
