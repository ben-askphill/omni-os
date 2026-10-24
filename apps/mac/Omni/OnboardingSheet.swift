import AppKit
import OmniKit
import SwiftUI

/// Onboarding, as Onboarding.tsx: five screens on first run (the status says `onboarded: false`, because the server
/// has no data/omni.config.json yet), or again from Settings > Profile. It writes the user config through /api/setup;
/// `npm run setup` asks the same questions in a terminal.
struct OnboardingSupport: ViewModifier {
  let model: AppModel
  /// The window's own appearance: the modifier sits inside the chrome's forced dark scheme, as the palette does.
  let scheme: ColorScheme

  private var needed: Bool {
    model.setupRequested || (model.store.status?.profile?.needsOnboarding ?? false)
  }

  func body(content: Content) -> some View {
    content.sheet(isPresented: Binding(get: { needed }, set: { if !$0 { model.setupRequested = false } })) {
      OnboardingSheet(model: model)
        .environment(\.colorScheme, scheme)
        .interactiveDismissDisabled(!model.setupRequested)
    }
  }
}

struct OnboardingSheet: View {
  let model: AppModel
  @State private var state: SetupState?
  @State private var step = Self.firstStep
  @State private var form = UserConfig()
  @State private var channelName = ""
  @State private var channelRepo = ""
  @State private var channelStore = ""
  @State private var createdChannel: String?
  @State private var harnesses: [HarnessInfo]?
  @State private var busy = false
  @State private var error: String?

  private var rerun: Bool { state?.onboarded ?? false }

  /// Debug launch arg `-OmniOnboardingStep harnesses` opens on that screen, since QA scripts only pick routes.
  private static var firstStep: OnboardingStep {
    #if DEBUG
      if let name = UserDefaults.standard.string(forKey: "OmniOnboardingStep"),
        let s = OnboardingStep.allCases.first(where: { $0.title.lowercased() == name.lowercased() })
      {
        return s
      }
    #endif
    return .you
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        StaticMark(size: 32).foregroundStyle(Tok.fg)
        Spacer()
        StepDots(step: step)
      }
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          if state == nil, error == nil {
            Loader(size: 18).frame(maxWidth: .infinity).padding(.vertical, z(40))
          } else if let state {
            screen(state)
          }
          if let error {
            Text(error)
              .font(.omni(size: 12.5))
              .foregroundStyle(Tok.fg2)
              .fixedSize(horizontal: false, vertical: true)
              .padding(.top, z(12))
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, z(20))
      }
      .scrollIndicators(.automatic)
      HStack {
        if step == .you {
          Button(rerun ? "Cancel" : "Skip setup") { rerun ? (model.setupRequested = false) : skip() }
            .buttonStyle(.pill(.ghost, height: 34))
            .disabled(busy)
        } else {
          Button("Back") {
            error = nil
            if let p = step.previous { step = p }
          }
          .buttonStyle(.pill(.ghost, height: 34))
          .disabled(busy)
        }
        Spacer()
        Button(action: next) {
          if busy { Loader(size: 14) } else { Text(primaryLabel) }
        }
        .buttonStyle(.pill(.primary, height: 34))
        .disabled(busy || state == nil)
        .keyboardShortcut(.defaultAction)
      }
      .padding(.top, z(20))
    }
    .padding(z(32))
    .frame(width: 500, height: 600)
    .background(Tok.bg)
    .task {
      await load()
      if step == .harnesses, harnesses == nil { await loadHarnesses() }
    }
  }

  private var primaryLabel: String {
    switch step {
    case .done: rerun ? "Save" : "Open Conductor"
    case .channel where createdChannel == nil && channelName.trimmingCharacters(in: .whitespaces).isEmpty: "Skip"
    default: "Continue"
    }
  }

  @ViewBuilder private func screen(_ state: SetupState) -> some View {
    switch step {
    case .you:
      Screen(caption: rerun ? "Setup" : "Welcome to Omni", title: "Tell Omni about you",
             note: "Your name and pronouns are told to every agent, so a thread knows who it works for. Automations use your timezone.") {
        Field("Name") { TextField("Name", text: $form.user.name, prompt: Text("Your name")).textFieldStyle(.omni) }
        Field("Email", hint: "Optional. Agents use it to recognise your own commits, PRs and mail.") {
          TextField("Email", text: $form.user.email, prompt: Text(verbatim: "you@example.com")).textFieldStyle(.omni)
        }
        HStack(alignment: .top, spacing: z(12)) {
          Field("Timezone", hint: "Prefilled from this Mac.") {
            TextField("Timezone", text: $form.user.timezone, prompt: Text("Europe/Amsterdam")).textFieldStyle(.omniMono)
          }
          Field("Pronouns") { PronounsField(value: $form.user.pronouns) }
        }
      }
    case .workspace:
      Screen(caption: "Workspace", title: "Where your work lives",
             note: "Threads in a channel without a repo run in the workspace folder, and its CLAUDE.md and skills load in every Claude thread. Omni makes it if it is missing.") {
        Field("Workspace folder") {
          TextField("Workspace folder", text: $form.workspace.root, prompt: Text(state.fallbacks.workspaceRoot)).textFieldStyle(.omniMono)
        }
        Field("Repos folder", hint: "Where your git checkouts live. Used to suggest repo paths for channels.") {
          TextField("Repos folder", text: $form.workspace.reposDir, prompt: Text(state.fallbacks.reposDir)).textFieldStyle(.omniMono)
        }
        Field("GitHub owner", hint: "Your GitHub user or org, for your repos and your fork of Omni.") {
          TextField("GitHub owner", text: $form.workspace.githubOwner, prompt: Text("octocat")).textFieldStyle(.omniMono)
        }
      }
    case .harnesses:
      Screen(caption: "Harnesses", title: "The agents Omni can run",
             note: "Each thread runs on a CLI you are signed in to, billed to that plan. Omni needs Claude Code; Codex and Cursor Agent are optional.") {
        VStack(alignment: .leading, spacing: z(8)) {
          if let harnesses {
            ForEach(harnesses.filter { !$0.id.isRemote || $0.available }) { HarnessRow(harness: $0) }
          } else {
            Loader(size: 16).frame(maxWidth: .infinity).padding(.vertical, z(20))
          }
          HStack {
            Text(harnesses?.first { $0.id == .claudeCode }?.available == false ? "Set up Claude Code before your first thread." : "You can add the others any time.")
              .font(.omni(size: 12)).foregroundStyle(Tok.fg3)
            Spacer()
            Button("Check again") { Task { await loadHarnesses() } }.buttonStyle(.pill(.ghost, height: 30))
          }
        }
      }
    case .channel:
      Screen(caption: "First channel", title: "Add a client or project",
             note: "A channel holds the threads for one client or project. With a repo, every thread gets its own git worktree. Skip it and add channels later from the sidebar.") {
        if let createdChannel {
          Text("Created #\(createdChannel).").font(.omni(size: 13)).foregroundStyle(Tok.fg2)
            .padding(z(16)).frame(maxWidth: .infinity, alignment: .leading).omniCard(16)
        } else {
          Field("Name") { TextField("Name", text: $channelName, prompt: Text("Acme")).textFieldStyle(.omni) }
          Field("Repo folder", hint: "Optional. A git checkout on this Mac.") {
            TextField("Repo folder", text: $channelRepo, prompt: Text("\(state.resolved.reposDir)/acme-theme")).textFieldStyle(.omniMono)
          }
          Field("Shopify store", hint: "Optional. The myshopify domain.") {
            TextField("Shopify store", text: $channelStore, prompt: Text(verbatim: "acme.myshopify.com")).textFieldStyle(.omniMono)
          }
        }
      }
    case .done:
      let first = OnboardingStep.firstName(form.user.name)
      Screen(caption: "Done", title: first.isEmpty ? "You're set" : "You're set, \(first)",
             note: rerun ? "Save to keep these settings." : "Omni opens #conductor with a welcome message. Tell the Conductor what you need and it hands the work to the right crew role.") {
        VStack(alignment: .leading, spacing: z(6)) {
          SummaryRow(key: "Name", value: form.user.name)
          SummaryRow(key: "Pronouns", value: form.user.pronouns)
          SummaryRow(key: "Timezone", value: form.user.timezone.isEmpty ? state.resolved.timezone : form.user.timezone)
          SummaryRow(key: "Workspace", value: form.workspace.root.isEmpty ? state.fallbacks.workspaceRoot : form.workspace.root)
          SummaryRow(key: "GitHub", value: form.workspace.githubOwner.isEmpty ? "not set" : form.workspace.githubOwner)
          if let createdChannel { SummaryRow(key: "Channel", value: "#\(createdChannel)") }
        }
        .padding(z(16)).frame(maxWidth: .infinity, alignment: .leading).omniCard(16)
        Text("Saved in \(state.path), which stays out of git. Change it any time in Settings, or run npm run setup.")
          .font(.omni(size: 12)).foregroundStyle(Tok.fg3).fixedSize(horizontal: false, vertical: true)
      }
    }
  }

  private func load() async {
    do {
      let s = try await model.client.setup()
      state = s
      form = s.config
      if form.user.timezone.isEmpty { form.user.timezone = TimeZone.current.identifier }
      if form.user.pronouns.isEmpty { form.user.pronouns = "they/them" }
      form.workspace.githubOwner = OnboardingStep.suggestedOwner(s)
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func loadHarnesses() async {
    harnesses = (try? await model.client.harnesses()) ?? []
  }

  private func next() {
    error = nil
    let name = form.user.name.trimmingCharacters(in: .whitespacesAndNewlines)
    if step == .you, name.isEmpty { return error = "Enter a name, or skip setup for now." }
    if step == .you, name.count > Profile.nameMax { return error = "Keep the name under \(Profile.nameMax) characters." }
    busy = true
    Task {
      defer { busy = false }
      do {
        switch step {
        case .you, .workspace:
          // Each step saves what it asked, so closing the app keeps the answers.
          state = try await model.client.saveSetup(SetupPatch.cleaned(form, integrations: false))
        case .channel:
          if createdChannel == nil, !channelName.trimmingCharacters(in: .whitespaces).isEmpty {
            let ch = try await model.client.createChannel(OnboardingStep.channelForm(name: channelName, repo: channelRepo, store: channelStore))
            createdChannel = ch.id
            await model.store.reloadChannels()
          }
        case .done:
          return try await finish(SetupPatch.cleaned(form, integrations: false))
        case .harnesses:
          break
        }
        if let n = step.next {
          step = n
          if n == .harnesses, harnesses == nil { await loadHarnesses() }
        }
      } catch {
        self.error = error.localizedDescription
      }
    }
  }

  private func skip() {
    busy = true
    Task {
      defer { busy = false }
      do {
        // Skipping still writes the file, so this is not asked again; Settings > Profile has every field.
        try await finish(.empty)
      } catch {
        self.error = error.localizedDescription
      }
    }
  }

  private func finish(_ patch: SetupPatch) async throws(OmniAPIError) {
    let wasRerun = rerun
    let done = try await model.client.completeSetup(patch)
    model.setupRequested = false
    await model.store.refresh()
    if let id = done.threadId {
      model.route = .thread(id: id)
    } else if !wasRerun {
      model.route = .channel(id: "conductor")
    }
  }
}

private struct Screen<Content: View>: View {
  let caption: String
  let title: String
  let note: String
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(caption).omniCaption().padding(.bottom, z(8))
      Text(title)
        .font(.omni(size: 24, weight: .medium))
        .tracking(-0.24)
        .foregroundStyle(Tok.fg)
      Text(note)
        .font(.omni(size: 13))
        .lineSpacing(2)
        .foregroundStyle(Tok.fg3)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, z(8))
      VStack(alignment: .leading, spacing: z(14)) { content }.padding(.top, z(20))
    }
  }
}

private struct Field<Content: View>: View {
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

private struct StepDots: View {
  let step: OnboardingStep

  var body: some View {
    HStack(spacing: z(6)) {
      ForEach(OnboardingStep.allCases, id: \.self) { s in
        Capsule()
          .fill(s == step ? Tok.fg : s.rawValue < step.rawValue ? Tok.fg2 : Tok.lineStrong)
          .frame(width: z(s == step ? 24 : 6), height: z(6))
      }
    }
    .animation(Motion.settle, value: step)
    .accessibilityElement()
    .accessibilityLabel("Step \(step.rawValue + 1) of \(OnboardingStep.allCases.count): \(step.title)")
  }
}

private struct HarnessRow: View {
  let harness: HarnessInfo

  var body: some View {
    VStack(alignment: .leading, spacing: z(8)) {
      HStack(spacing: z(10)) {
        OmniIcon(name: harness.available ? "check" : "x", size: 12)
          .foregroundStyle(harness.available ? Tok.ink : Tok.fg3)
          .frame(width: z(24), height: z(24))
          .background(harness.available ? Tok.done : Tok.bg, in: Circle())
        Text(harness.name).font(.omni(size: 13.5, weight: .medium)).foregroundStyle(Tok.fg)
        Text(harness.plan).font(.omni(size: 12)).foregroundStyle(Tok.fg3)
        Spacer()
        Text(harness.available ? "Ready" : "Not set up").font(.omni(size: 12)).foregroundStyle(harness.available ? Tok.fg2 : Tok.fg3)
      }
      if !harness.available {
        if let install = harness.install { CommandLine(label: "Install", command: install) }
        if let fix = harness.fix { CommandLine(label: "Sign in", command: fix) }
      }
    }
    .padding(z(14))
    .frame(maxWidth: .infinity, alignment: .leading)
    .omniCard(16)
  }
}

private struct CommandLine: View {
  let label: String
  let command: String
  @State private var copied = false

  var body: some View {
    HStack(spacing: z(8)) {
      Text(label).font(.omni(size: 11.5)).foregroundStyle(Tok.fg3).frame(width: z(48), alignment: .leading)
      Text(command)
        .font(.system(size: z(12), design: .monospaced))
        .foregroundStyle(Tok.fg)
        .lineLimit(1)
        .truncationMode(.middle)
        .textSelection(.enabled)
        .padding(.horizontal, z(8))
        .padding(.vertical, z(4))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tok.surface2, in: RoundedRectangle(cornerRadius: z(8), style: .continuous))
      Button(copied ? "Copied" : "Copy") {
        Pasteboard.copy(command)
        copied = true
      }
      .buttonStyle(.pill(.ghost, height: 26))
    }
    .padding(.leading, z(34))
  }
}

private struct SummaryRow: View {
  let key: String
  let value: String

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: z(12)) {
      Text(key).font(.omni(size: 13)).foregroundStyle(Tok.fg3).frame(width: z(80), alignment: .leading)
      Text(value).font(.omni(size: 13)).foregroundStyle(Tok.fg).lineLimit(1).truncationMode(.middle)
    }
  }
}

/// A menu of the common sets plus Other, which shows a field for any other set.
struct PronounsField: View {
  @Binding var value: String
  @State private var other = false

  var body: some View {
    HStack(spacing: z(8)) {
      Menu {
        ForEach(OnboardingStep.pronouns, id: \.self) { p in
          Button(p) {
            other = false
            value = p
          }
        }
        Divider()
        Button("Other…") {
          other = true
          value = ""
        }
      } label: {
        Text(other ? "Other" : value).font(.omni(size: 13)).foregroundStyle(Tok.fg)
      }
      .menuStyle(.button)
      .fixedSize()
      if other {
        TextField("Pronouns", text: $value, prompt: Text("xe/xem")).textFieldStyle(.omni)
      }
    }
    .onAppear { other = !value.isEmpty && !OnboardingStep.pronouns.contains(value) }
  }
}
