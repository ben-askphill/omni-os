import OmniKit
import SwiftUI

/// The user config that onboarding wrote (data/omni.config.json), like the Web UI's Settings page
/// (apps/web/src/pages/Settings.tsx). Its fields, labels, hints and placeholders are the shared settings contract's
/// (packages/shared/settings.ts); apps/server/tests/mac-fixtures.test.ts checks this file names each one: the General tab's part is who you are, plus Run setup again; the Workspace
/// tab's is where your work lives and the optional integrations. Each part saves only its own fields, so the other
/// tab's unsaved edits stay as they are. The store refreshes after a save so the greeting follows at once.
struct ProfileSettings: View {
  enum Part { case general, workspace }

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
    return part == .general ? SetupPatch(user: all.user) : SetupPatch(workspace: all.workspace, integrations: all.integrations)
  }

  private var dirty: Bool {
    guard let state else { return false }
    let stored = SetupPatch.cleaned(state.config)
    return part == .general ? patch.user != stored.user : patch.workspace != stored.workspace || patch.integrations != stored.integrations
  }

  var body: some View {
    VStack(alignment: .leading, spacing: z(16)) {
      if let state {
        if part == .general {
          SettingsCard(title: "You") {
            VStack(alignment: .leading, spacing: z(14)) {
              Row("Name", hint: "Used in the greeting on Home and told to every agent, so a thread knows who it works for.") {
                TextField("Name", text: $form.user.name, prompt: Text("Your name")).textFieldStyle(.omni).frame(maxWidth: z(320))
              }
              HStack(alignment: .top, spacing: z(12)) {
                Row("Pronouns") { PronounsField(value: $form.user.pronouns) }
                Row("Timezone", hint: "Empty uses the server's: \(state.fallbacks.timezone).") {
                  TextField("Timezone", text: $form.user.timezone, prompt: Text(state.fallbacks.timezone)).textFieldStyle(.omniMono)
                }
              }
              Row("Email") { TextField("Email", text: $form.user.email, prompt: Text(verbatim: "you@example.com")).textFieldStyle(.omni).frame(maxWidth: z(320)) }
            }
          }
        } else {
          SettingsCard(title: "Workspace") {
            VStack(alignment: .leading, spacing: z(14)) {
              Row("Workspace folder", hint: "Threads without a repo run here; its CLAUDE.md and skills load in every Claude thread.") {
                TextField("Workspace folder", text: $form.workspace.root, prompt: Text(state.fallbacks.workspaceRoot)).textFieldStyle(.omniMono)
              }
              Row("Repos folder") {
                TextField("Repos folder", text: $form.workspace.reposDir, prompt: Text(state.fallbacks.reposDir)).textFieldStyle(.omniMono)
              }
              Row("GitHub owner", hint: "Your GitHub user or org.") {
                TextField("GitHub owner", text: $form.workspace.githubOwner, prompt: Text("octocat")).textFieldStyle(.omniMono).frame(maxWidth: z(320))
              }
            }
          }
          // The developer integrations fold under Advanced, as on the web (#405).
          AdvancedFold(summary: "Hermes URL and central brain folder") {
            VStack(alignment: .leading, spacing: z(14)) {
              Text("Optional integrations. Leave a field empty to turn it off.")
                .font(.omni(size: 12.5)).foregroundStyle(Tok.fg3)
              Row("Hermes URL", hint: "A Hermes API server on your tailnet. Its token is the global secret HERMES_API_KEY.") {
                TextField("Hermes URL", text: $form.integrations.hermesUrl, prompt: Text(verbatim: "http://100.64.0.1:8642")).textFieldStyle(.omniMono)
              }
              Row("Central brain folder", hint: "A git repo of notes that the brain-nightly automation exports thread digests into.") {
                TextField("Central brain folder", text: $form.integrations.centralBrainDir, prompt: Text("~/central-brain")).textFieldStyle(.omniMono)
              }
            }
          }
        }
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
      } else if error == nil {
        Loader(size: 18).frame(maxWidth: .infinity).padding(.vertical, z(40))
      }
      if let error {
        Text(error).font(.omni(size: 12.5)).foregroundStyle(Tok.fg2).fixedSize(horizontal: false, vertical: true)
      }
      if part == .workspace {
        SettingsIntro(
          icon: "info",
          text: Text("These settings live in \(Text(state?.path ?? "data/omni.config.json").monospaced()) on this Mac and never go into git, so a fork stays clean. Server options such as the port and model defaults live in \(Text(".env").monospaced()).")
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

private struct Row<Content: View>: View {
  let label: String
  var hint: String?
  @ViewBuilder var content: Content

  init(_ label: String, hint: String? = nil, @ViewBuilder content: () -> Content) {
    self.label = label
    self.hint = hint
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      FieldLabel(text: label, hint: hint)
      content
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}
