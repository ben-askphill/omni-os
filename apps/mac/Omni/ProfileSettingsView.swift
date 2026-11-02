import OmniKit
import SwiftUI

/// The user config that onboarding wrote (data/omni.config.json), like the Web UI's Settings page
/// (apps/web/src/pages/Settings.tsx). Its fields, labels, hints and placeholders are the shared settings contract's
/// (packages/shared/settings.ts); apps/server/tests/mac-fixtures.test.ts checks this file names each one. Four parts,
/// one per Settings section: General's You, Workspace's Folders, Integrations, and Sharing & access's Network access
/// (read-only: only the file or its env var sets those). Each part saves only its own fields, so another section's
/// unsaved edits stay as they are. A chip beside each field says where its value comes from, with Reset beside one
/// this machine saved. The store refreshes after a save so the greeting follows at once.
struct ProfileSettings: View {
  enum Part { case general, workspace, integrations, access }

  let model: AppModel
  let part: Part
  @State private var state: SetupState?
  @State private var form = UserConfig()
  @State private var saving = false
  @State private var saved = false
  @State private var error: String?

  /// This part's fields, cleaned, as PUT /api/setup takes them.
  private var patch: SetupPatch {
    let all = SetupPatch.cleaned(form)
    switch part {
    case .general: return SetupPatch(user: all.user)
    case .workspace: return SetupPatch(workspace: all.workspace)
    case .integrations: return SetupPatch(integrations: all.integrations)
    case .access: return .empty
    }
  }

  private var dirty: Bool {
    guard let state else { return false }
    let stored = SetupPatch.cleaned(state.config)
    switch part {
    case .general: return patch.user != stored.user
    case .workspace: return patch.workspace != stored.workspace
    case .integrations: return patch.integrations?.hermesUrl != stored.integrations?.hermesUrl || patch.integrations?.centralBrainDir != stored.integrations?.centralBrainDir
    case .access: return false
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: z(16)) {
      if let state {
        switch part {
        case .general: general(state)
        case .workspace: workspace(state)
        case .integrations: integrations(state)
        case .access: access(state)
        }
        if part != .access {
          HStack(spacing: z(10)) {
            Button(action: save) {
              if saving { Loader(size: 14) } else { Text("Save") }
            }
            .buttonStyle(.pill(.primary, height: 36))
            .disabled(!dirty || saving)
            if saved, !dirty { Text("Saved").font(.omni(size: 12.5)).foregroundStyle(Tok.fg3) }
            Spacer()
            if part == .general {
              Button("Run setup again") { model.setupRequested = true }
                .buttonStyle(.pill(.ghost, height: 36))
            }
          }
        }
      } else if error == nil {
        Loader(size: 18).frame(maxWidth: .infinity).padding(.vertical, z(40))
      }
      if let error {
        Text(error).font(.omni(size: 12.5)).foregroundStyle(Tok.fg2).fixedSize(horizontal: false, vertical: true)
      }
      if part != .access {
        SettingsIntro(
          icon: "info",
          text: Text("These settings live in \(Text(state?.path ?? "data/omni.config.json").monospaced()) on this machine and never go into git, so a fork stays clean. An environment variable in \(Text(".env").monospaced()) wins over a value here; the chip beside a field says so.")
        )
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .task { await load() }
    // The wizard, the Web UI or `npm run setup` may have changed the file.
    .onChange(of: model.setupRequested) { _, open in
      if !open { Task { await load() } }
    }
    .onChange(of: form) { _, _ in saved = false }
  }

  // MARK: Parts

  @ViewBuilder private func general(_ state: SetupState) -> some View {
    SettingsCard(title: "You") {
      VStack(alignment: .leading, spacing: z(14)) {
        // The name is required, so it has no Reset.
        Row("Name", hint: "Used in the greeting on Home and told to every agent, so a thread knows who it works for.", origin: origin("user.name", state.config.user.name, "", state, reset: nil)) {
          TextField("Name", text: $form.user.name, prompt: Text("Your name")).textFieldStyle(.omni).frame(maxWidth: z(320))
        }
        HStack(alignment: .top, spacing: z(12)) {
          Row("Pronouns", origin: origin("user.pronouns", state.config.user.pronouns, "they/them", state) { $0.user.pronouns = "they/them" }) { PronounsField(value: $form.user.pronouns) }
          Row("Timezone", hint: "Empty uses the server's: \(state.fallbacks.timezone).", origin: origin("user.timezone", state.config.user.timezone, "", state) { $0.user.timezone = "" }) {
            TextField("Timezone", text: $form.user.timezone, prompt: Text(state.fallbacks.timezone)).textFieldStyle(.omniMono)
          }
        }
        Row("Email", origin: origin("user.email", state.config.user.email, "", state) { $0.user.email = "" }) {
          TextField("Email", text: $form.user.email, prompt: Text(verbatim: "you@example.com")).textFieldStyle(.omni).frame(maxWidth: z(320))
        }
      }
    }
  }

  @ViewBuilder private func workspace(_ state: SetupState) -> some View {
    SettingsCard(title: "Folders") {
      VStack(alignment: .leading, spacing: z(14)) {
        Row("Workspace folder", hint: "Threads without a repo run here; its CLAUDE.md and skills load in every Claude thread.", origin: origin("workspace.root", state.config.workspace.root, "", state) { $0.workspace.root = "" }) {
          TextField("Workspace folder", text: $form.workspace.root, prompt: Text(state.fallbacks.workspaceRoot)).textFieldStyle(.omniMono)
        }
        Row("Repos folder", origin: origin("workspace.reposDir", state.config.workspace.reposDir, "", state) { $0.workspace.reposDir = "" }) {
          TextField("Repos folder", text: $form.workspace.reposDir, prompt: Text(state.fallbacks.reposDir)).textFieldStyle(.omniMono)
        }
        Row("GitHub owner", hint: "Your GitHub user or org.", origin: origin("workspace.githubOwner", state.config.workspace.githubOwner, "", state) { $0.workspace.githubOwner = "" }) {
          TextField("GitHub owner", text: $form.workspace.githubOwner, prompt: Text("octocat")).textFieldStyle(.omniMono).frame(maxWidth: z(320))
        }
      }
    }
  }

  @ViewBuilder private func integrations(_ state: SetupState) -> some View {
    SettingsCard(title: "Integrations", note: "Optional. Leave a field empty to turn it off.") {
      VStack(alignment: .leading, spacing: z(14)) {
        Row("Hermes URL", hint: "A Hermes API server on your tailnet. Its token is the global secret HERMES_API_KEY.", origin: origin("integrations.hermesUrl", state.config.integrations.hermesUrl, "", state) { $0.integrations.hermesUrl = "" }) {
          TextField("Hermes URL", text: $form.integrations.hermesUrl, prompt: Text(verbatim: "http://100.64.0.1:8642")).textFieldStyle(.omniMono)
        }
        Row("Central brain folder", hint: "A git repo of notes that the brain-nightly automation exports thread digests into.", origin: origin("integrations.centralBrainDir", state.config.integrations.centralBrainDir, "", state) { $0.integrations.centralBrainDir = "" }) {
          TextField("Central brain folder", text: $form.integrations.centralBrainDir, prompt: Text("~/central-brain")).textFieldStyle(.omniMono)
        }
      }
    }
  }

  /// Read-only: a page or an agent must not open this Omni wider, so only the file or the env var sets these.
  @ViewBuilder private func access(_ state: SetupState) -> some View {
    let i = state.config.integrations
    SettingsCard(title: "Network access", note: "Set in data/omni.config.json or its environment variable, so a page cannot open this Omni wider.") {
      VStack(alignment: .leading, spacing: z(14)) {
        Row("Tailscale logins", hint: "Logins let in through tailscale serve, comma separated. Empty: any login on your tailnet with the token.", origin: origin("integrations.tailscaleLogin", i.tailscaleLogin, "", state, reset: nil)) {
          ReadOnlyValue(value: i.tailscaleLogin)
        }
        Row("Public MCP URL", hint: "A Cloudflare Tunnel that forwards only /mcp and /.well-known here. /api still refuses it.", origin: origin("integrations.mcpPublicUrl", i.mcpPublicUrl, "", state, reset: nil)) {
          ReadOnlyValue(value: i.mcpPublicUrl, placeholder: "https://omni.example.com")
        }
      }
    }
    AdvancedFold(summary: "Clerk instance for Google sign-in") {
      VStack(alignment: .leading, spacing: z(14)) {
        Text("Empty uses the shared instance Omni ships with.").font(.omni(size: 12.5)).foregroundStyle(Tok.fg3)
        Row("Clerk publishable key", origin: origin("integrations.clerkPublishableKey", i.clerkPublishableKey, "", state, reset: nil)) {
          ReadOnlyValue(value: i.clerkPublishableKey)
        }
        Row("Clerk OAuth client id", origin: origin("integrations.clerkClientId", i.clerkClientId, "", state, reset: nil)) {
          ReadOnlyValue(value: i.clerkClientId)
        }
      }
    }
  }

  // MARK: Provenance

  /// The chip for one field, with Reset when this machine saved it and `reset` puts the default back.
  private func origin(_ id: String, _ saved: String, _ fallback: String, _ state: SetupState, reset: ((inout UserConfig) -> Void)?) -> OriginChip {
    let (p, label) = Provenance.of(field: id, saved: saved, default: fallback, env: state.env)
    return OriginChip(of: p, label: label, reset: reset.map { r in { resetField(r) } })
  }

  /// Saves the field's default at once and keeps the other fields' drafts.
  private func resetField(_ apply: @escaping (inout UserConfig) -> Void) {
    guard let state else { return }
    var stored = state.config
    apply(&stored)
    let all = SetupPatch.cleaned(stored)
    let sent: SetupPatch
    switch part {
    case .general: sent = SetupPatch(user: all.user)
    case .workspace: sent = SetupPatch(workspace: all.workspace)
    case .integrations: sent = SetupPatch(integrations: all.integrations)
    case .access: return
    }
    Task {
      do {
        let s = try await model.client.saveSetup(sent)
        apply(&form)
        self.state = s
        if part == .general { await model.store.refresh() }
      } catch {
        self.error = error.localizedDescription
      }
    }
  }

  private func load() async {
    do {
      let s = try await model.client.setup()
      state = s
      form = s.config
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func save() {
    if part == .general {
      let name = form.user.name.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !name.isEmpty else { return error = "Enter a name." }
      guard name.count <= Profile.nameMax else { return error = "Keep it under \(Profile.nameMax) characters." }
    }
    guard dirty, !saving else { return }
    saving = true
    error = nil
    Task {
      defer { saving = false }
      do {
        let s = try await model.client.saveSetup(patch)
        state = s
        form = s.config
        saved = true
        if part == .general { await model.store.refresh() }
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}

/// A field's label and hint on the left, where its value comes from on the right, the control below.
private struct Row<Content: View>: View {
  let label: String
  var hint: String?
  var origin: OriginChip?
  @ViewBuilder var content: Content

  init(_ label: String, hint: String? = nil, origin: OriginChip? = nil, @ViewBuilder content: () -> Content) {
    self.label = label
    self.hint = hint
    self.origin = origin
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: z(8)) {
        FieldLabel(text: label, hint: hint)
        Spacer(minLength: 0)
        if let origin { origin }
      }
      content
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// A value Settings shows but does not edit, in the field's place.
private struct ReadOnlyValue: View {
  let value: String
  var placeholder = "Not set"

  var body: some View {
    Text(value.isEmpty ? placeholder : value)
      .font(.omni(size: 13, design: .monospaced))
      .foregroundStyle(value.isEmpty ? Tok.fg4 : Tok.fg2)
      .textSelection(.enabled)
      .lineLimit(2)
      .padding(.horizontal, z(12))
      .frame(maxWidth: .infinity, minHeight: z(38), alignment: .leading)
      .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(14), style: .continuous))
  }
}
