import OmniKit
import SwiftUI

/// The channel's named actions in its settings: each with Edit and Delete, and a form to add or change one. Every save
/// goes to the server at once, not with the channel form's Save. Threads run them from the inspector's Actions tab.
struct ChannelActionsView: View {
  let client: OmniClient
  let channel: String

  /// The form's action: nil adds a new one.
  private struct Editing: Hashable {
    var id: String?
    var draft: ChannelActionDraft
  }

  @State private var actions: Result<[ChannelAction], OmniAPIError>?
  @State private var editing: Editing?
  @State private var saving = false
  @State private var formError: String?
  @State private var confirmingDelete: String?
  @State private var deleting: String?
  @State private var deleteError: String?

  /// The form's scroll id: opening it scrolls the settings to it, since the card sits below the fold.
  private static let formID = "channel-action-form"

  var body: some View {
    ScrollViewReader { proxy in
      card
        .onChange(of: editing != nil) { _, open in
          if open { withAnimation { proxy.scrollTo(Self.formID, anchor: .bottom) } }
        }
    }
  }

  private var card: some View {
    SettingsCard(
      title: "Actions",
      note: "Commands a thread can run in its checkout from the inspector's Actions tab, like Theme preview or Tests."
    ) {
      if editing == nil {
        Button { open(Editing(draft: ChannelActionDraft())) } label: {
          HStack(spacing: z(6)) {
            OmniIcon(name: "plus", size: 13)
            Text("Add action")
          }
        }
        .buttonStyle(.pill(.secondary, height: 30))
      }
    } content: {
      list
      if let deleteError { ErrorNote(text: deleteError) }
      if editing != nil { form.id(Self.formID) }
    }
    .task(id: channel) {
      await load()
      #if DEBUG
      openFromLaunchArgument()
      #endif
    }
  }

  @ViewBuilder private var list: some View {
    switch actions {
    case nil:
      LoadingNote(label: "Loading actions")
    case .failure(let error):
      ErrorNote(text: error.message) { Task { await load() } }
    case .success(let list) where list.isEmpty && editing == nil:
      Text("No actions yet.").font(.omni(size: 12.5)).foregroundStyle(Tok.fg3)
    case .success(let list):
      VStack(spacing: z(8)) {
        ForEach(list) { action in row(action) }
      }
    }
  }

  private func row(_ action: ChannelAction) -> some View {
    HStack(spacing: z(12)) {
      VStack(alignment: .leading, spacing: z(3)) {
        HStack(spacing: z(8)) {
          Text(action.name)
            .font(.omni(size: 13, weight: .medium))
            .foregroundStyle(Tok.fg)
            .lineLimit(1)
          if let setup = action.setup {
            Chip(text: "Setup", tone: .outline)
              .help("Runs in each new worktree: \(setup.label.lowercased())")
          }
        }
        Text(action.command)
          .font(.omni(size: 12, design: .monospaced))
          .foregroundStyle(Tok.fg3)
          .lineLimit(1)
          .truncationMode(.tail)
          .help(action.command)
        Text(([ChannelActions.portLabel(action.port)] + action.secrets + [action.setup?.label].compactMap(\.self)).joined(separator: " · "))
          .font(.omni(size: 11.5))
          .foregroundStyle(Tok.fg4)
          .lineLimit(1)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if confirmingDelete == action.id {
        Button("Cancel") { confirmingDelete = nil }
          .buttonStyle(.pill(.ghost, height: 30))
          .disabled(deleting != nil)
        Button(role: .destructive) { Task { await delete(action) } } label: {
          HStack(spacing: z(6)) {
            if deleting == action.id { Loader(size: 12) }
            Text("Delete")
          }
        }
        .buttonStyle(.pill(.needs, height: 30))
        .disabled(deleting != nil)
      } else {
        Button("Edit \(action.name)", systemImage: "pencil") { open(Editing(id: action.id, draft: ChannelActionDraft(action))) }
          .labelStyle(.iconOnly)
          .buttonStyle(.icon(size: 28))
          .help("Edit")
        Button("Delete \(action.name)", systemImage: "trash") {
          deleteError = nil
          confirmingDelete = action.id
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.icon(size: 28))
        .help("Delete")
      }
    }
    .padding(.horizontal, z(16))
    .padding(.vertical, z(12))
    .background(editing?.id == action.id ? Tok.surface3 : Tok.surface, in: RoundedRectangle(cornerRadius: z(18), style: .continuous))
  }

  @ViewBuilder private var form: some View {
    let draft = Binding { editing?.draft ?? ChannelActionDraft() } set: { editing?.draft = $0 }
    VStack(alignment: .leading, spacing: z(14)) {
      Text(editing?.id == nil ? "New action" : "Edit action")
        .font(.omni(size: 13, weight: .medium))
        .foregroundStyle(Tok.fg)
      VStack(alignment: .leading, spacing: 0) {
        FieldLabel(text: "Name", hint: "What the Run button says.")
        TextField("", text: draft.name, prompt: Text("Theme preview"))
          .textFieldStyle(.omni)
          .accessibilityLabel("Name")
      }
      VStack(alignment: .leading, spacing: 0) {
        FieldLabel(text: "Command", hint: "Runs in the thread's checkout with your login shell. Use $OMNI_PORT for the run's port.")
        OmniTextEditor(text: draft.command, minHeight: 64, mono: true)
          .accessibilityLabel("Command")
      }
      VStack(alignment: .leading, spacing: 0) {
        FieldLabel(text: "Secrets", hint: "Names the command reads as $NAME, separated by commas. Values stay in the server's secret store.")
        TextField("", text: draft.secrets, prompt: Text("SHOPIFY_CLI_THEME_TOKEN"))
          .textFieldStyle(.omniMono)
          .autocorrectionDisabled()
          .accessibilityLabel("Secrets")
      }
      VStack(alignment: .leading, spacing: 0) {
        FieldLabel(text: "Port", hint: Self.portHint(draft.wrappedValue.portMode))
        HStack(spacing: z(10)) {
          SegmentedPill(selection: draft.portMode, options: [(.none, "None"), (.free, "Free port per run"), (.fixed, "Fixed")])
            .fixedSize()
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Port")
          if draft.wrappedValue.portMode == .fixed {
            TextField("", text: draft.fixedPort, prompt: Text("9292"))
              .textFieldStyle(.omniMono)
              .frame(width: z(110))
              .accessibilityLabel("Fixed port")
          }
          Spacer(minLength: 0)
        }
      }
      VStack(alignment: .leading, spacing: 0) {
        FieldLabel(text: "Run in new worktrees", hint: setupHint(draft.wrappedValue.setup))
        SegmentedPill(selection: draft.setup, options: [(nil, "Off"), (.blocking, SetupMode.blocking.label), (.background, SetupMode.background.label)])
          .fixedSize()
          .accessibilityElement(children: .contain)
          .accessibilityLabel("Run in new worktrees")
      }
      if let formError { ErrorNote(text: formError) }
      HStack(spacing: z(10)) {
        Button { Task { await save() } } label: {
          HStack(spacing: z(8)) {
            if saving { Loader(size: 14) }
            Text(editing?.id == nil ? "Add action" : "Save action")
          }
        }
        .buttonStyle(.pill(.primary, height: 34))
        .disabled(saving)
        Button("Cancel") { editing = nil }
          .buttonStyle(.pill(.ghost, height: 34))
          .disabled(saving)
        Spacer(minLength: 0)
      }
    }
    .padding(z(16))
    .overlay(RoundedRectangle(cornerRadius: z(18), style: .continuous).strokeBorder(Tok.line))
  }

  private static func portHint(_ mode: ChannelActionDraft.PortMode) -> String {
    switch mode {
    case .none: "The command serves nothing."
    case .free: "Omni picks a free port for each run as $OMNI_PORT, so two threads never share one."
    case .fixed: "Always this port. A second run while it is taken is refused."
    }
  }

  /// What the setup choice does, and which action it takes over from: a channel has one setup action.
  private func setupHint(_ mode: SetupMode?) -> String {
    let what = switch mode {
    case .blocking?: "Runs once in each new worktree. The agent starts after it succeeds."
    case .background?: "Runs once in each new worktree while the agent starts."
    default: "New worktrees do not run it."
    }
    guard mode != nil, case .success(let list) = actions,
      let other = list.first(where: { $0.setup != nil && $0.id != editing?.id })
    else { return what }
    return "\(what) It takes over from \(other.name), as a channel has one setup action."
  }

  private func open(_ e: Editing) {
    formError = nil
    confirmingDelete = nil
    editing = e
  }

  private func load() async {
    do {
      actions = .success(try await client.channelActions(channel))
    } catch {
      if case .success = actions { return }
      actions = .failure(error)
    }
  }

  private func save() async {
    guard let e = editing else { return }
    guard let input = e.draft.input else {
      formError = ChannelActionDraft.portProblem
      return
    }
    saving = true
    formError = nil
    defer { saving = false }
    do {
      if let id = e.id {
        _ = try await client.updateChannelAction(channel, action: id, input)
      } else {
        _ = try await client.createChannelAction(channel, input)
      }
      editing = nil
      await load()
    } catch {
      formError = error.message
    }
  }

  private func delete(_ action: ChannelAction) async {
    deleting = action.id
    defer { deleting = nil }
    do {
      try await client.deleteChannelAction(channel, action: action.id)
      confirmingDelete = nil
      if editing?.id == action.id { editing = nil }
      await load()
    } catch {
      deleteError = error.message
      confirmingDelete = nil
    }
  }

  #if DEBUG
  /// `-OmniActionForm new` opens the add form, `-OmniActionForm "<name>"` that action's edit form, for QA snapshots.
  private func openFromLaunchArgument() {
    guard editing == nil, let asked = UserDefaults.standard.string(forKey: "OmniActionForm") else { return }
    if asked == "new" { open(Editing(draft: ChannelActionDraft())) }
    if case .success(let list) = actions, let action = list.first(where: { $0.name == asked }) {
      open(Editing(id: action.id, draft: ChannelActionDraft(action)))
    }
  }
  #endif
}
