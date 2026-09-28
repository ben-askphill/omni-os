import AppKit
import OmniKit
import SwiftUI

/// The channel settings form, as ChannelSettingsForm in ChannelSettings.tsx. With `existing` it edits and
/// archives that channel; without, it creates one.
struct ChannelSettingsForm: View {
  let model: AppModel
  var existing: Channel?

  @State private var form: ChannelForm
  @State private var busy = false
  @State private var error: String?
  @State private var saved = false
  /// The form as the server returned it, so setting it does not clear the Saved mark.
  @State private var savedForm: ChannelForm?
  @State private var archiveError: String?
  @State private var confirmArchive = false
  @State private var archiving = false

  init(model: AppModel, existing: Channel? = nil) {
    self.model = model
    self.existing = existing
    _form = State(initialValue: existing.map(ChannelForm.init(channel:)) ?? ChannelForm())
  }

  private var isNew: Bool { existing == nil }
  private var isSystem: Bool { existing?.kind == .system }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      basics
      code
      storeAndBrowser
      if let error { ErrorNote(text: error) }
      actions
      if let archiveError { ErrorNote(text: archiveError) }
    }
    .onChange(of: form) { if form != savedForm { saved = false } }
  }

  private var basics: some View {
    SettingsSection("Basics") {
      HStack(alignment: .top, spacing: 16) {
        SettingsField("Name") {
          TextField("", text: Binding(get: { form.name }, set: { form.setName($0) }), prompt: Text("Volero"))
            .accessibilityLabel("Name")
        }
        SettingsField("Id", hint: isNew ? "Lowercase slug, used in URLs and by the Conductor. Cannot change later." : "Fixed after creation.") {
          TextField("", text: Binding(get: { form.id }, set: { form.setID($0) }), prompt: Text("volero"))
            .font(.system(size: 13, design: .monospaced))
            .disabled(!isNew)
            .accessibilityLabel("Id")
        }
      }
      if !isSystem {
        SettingsField("Kind") {
          Picker("Kind", selection: $form.kind) {
            Text("Client").tag(ChannelKind.client)
            Text("Internal").tag(ChannelKind.internal)
            Text("Personal").tag(ChannelKind.personal)
          }
          .pickerStyle(.segmented)
          .labelsHidden()
          .fixedSize()
        }
      }
      SettingsField("Notes", hint: "Added to every thread's system prompt in this channel. Keep it short: who the client is, conventions, what not to touch.") {
        TextEditor(text: $form.notes)
          .font(.system(size: 13))
          .scrollContentBackground(.hidden)
          .frame(minHeight: 84)
          .padding(4)
          .background(ThreadStyle.surface, in: RoundedRectangle(cornerRadius: 8))
          .accessibilityLabel("Notes")
      }
    }
  }

  private var code: some View {
    SettingsSection("Code") {
      SettingsField("Repo path", hint: "Absolute path to a local git repo. Enables per-thread worktrees and the PRs tab.") {
        HStack(spacing: 8) {
          TextField("", text: $form.repoPath, prompt: Text("/Users/benrosenberg/code/apa-volero"))
            .font(.system(size: 13, design: .monospaced))
            .accessibilityLabel("Repo path")
          FolderButton(title: "Choose repo folder", path: $form.repoPath)
        }
      }
      SettingsField("GitHub repo", hint: "owner/name. Auto-detected from the repo path when left empty.") {
        TextField("", text: $form.githubRepo, prompt: Text("askphill/apa-volero"))
          .font(.system(size: 13, design: .monospaced))
          .accessibilityLabel("GitHub repo")
      }
      SettingsToggle(
        title: "Worktree per thread",
        detail: "Each thread gets its own branch (omni/...) so parallel work never collides. Off runs in the repo itself.",
        isOn: $form.useWorktree
      )
      .disabled(form.repoPath.trimmingCharacters(in: .whitespaces).isEmpty)
      SettingsField("Base directory", hint: "Where threads run when there is no repo. Defaults to the brain folder (phillbert) so skills load.") {
        HStack(spacing: 8) {
          TextField("", text: $form.baseDir, prompt: Text("/Users/benrosenberg/phillbert"))
            .font(.system(size: 13, design: .monospaced))
            .accessibilityLabel("Base directory")
          FolderButton(title: "Choose base folder", path: $form.baseDir)
        }
      }
    }
  }

  private var storeAndBrowser: some View {
    SettingsSection("Store and browser") {
      HStack(alignment: .top, spacing: 16) {
        SettingsField("Store domain", hint: "The myshopify domain, e.g. volero-eu.myshopify.com") {
          TextField("", text: $form.storeDomain, prompt: Text("volero-eu.myshopify.com"))
            .font(.system(size: 13, design: .monospaced))
            .accessibilityLabel("Store domain")
        }
        SettingsField("Portal slug", hint: "Ask Phill Portal company slug, for client context.") {
          TextField("", text: $form.portalSlug, prompt: Text("volero"))
            .font(.system(size: 13, design: .monospaced))
            .accessibilityLabel("Portal slug")
        }
      }
      SettingsToggle(
        title: "Show the browser window",
        detail: "Off runs the channel browser headless. Turn on to watch it or to log in by hand. Logins persist per channel.",
        isOn: $form.showBrowser
      )
    }
  }

  private var actions: some View {
    HStack(spacing: 10) {
      Button {
        Task { await save() }
      } label: {
        HStack(spacing: 6) {
          if busy { ProgressView().controlSize(.small) }
          Text(isNew ? "Create channel" : "Save changes")
        }
      }
      .buttonStyle(.borderedProminent)
      .controlSize(.large)
      .keyboardShortcut(.defaultAction)
      .disabled(busy)
      if saved {
        Label("Saved", systemImage: "checkmark")
          .font(.system(size: 12.5))
          .foregroundStyle(ThreadStyle.ok)
      }
      Spacer()
      if let existing, !isSystem, existing.id != "inbox" {
        archiveControl
      }
    }
  }

  @ViewBuilder private var archiveControl: some View {
    if confirmArchive {
      HStack(spacing: 8) {
        Button("Cancel") { confirmArchive = false }
          .disabled(archiving)
        Button(archiving ? "Archiving" : "Archive", role: .destructive) { Task { await archive() } }
          .disabled(archiving)
      }
      .controlSize(.large)
    } else {
      Button {
        confirmArchive = true
      } label: {
        Label("Archive channel", systemImage: "archivebox")
      }
      .controlSize(.large)
    }
  }

  private func save() async {
    if let message = form.validate(isNew: isNew) {
      error = message
      return
    }
    busy = true
    error = nil
    defer { busy = false }
    do {
      if let existing {
        let ch = try await model.client.updateChannel(existing.id, form, system: isSystem)
        await model.store.reloadChannels()
        form = ChannelForm(channel: ch)
        savedForm = form
        saved = true
      } else {
        let ch = try await model.client.createChannel(form)
        await model.store.reloadChannels()
        model.route = .channel(id: ch.id)
      }
    } catch {
      self.error = error.message
    }
  }

  private func archive() async {
    guard let existing else { return }
    archiveError = nil
    archiving = true
    defer { archiving = false }
    do {
      _ = try await model.client.setChannelArchived(existing.id, true)
      await model.store.reloadChannels()
      model.route = .home
    } catch {
      archiveError = error.message
      confirmArchive = false
    }
  }
}

/// The `#/new-channel` screen.
struct NewChannelScreen: View {
  let model: AppModel

  var body: some View {
    ScreenColumn(width: 672) {
      VStack(alignment: .leading, spacing: 20) {
        VStack(alignment: .leading, spacing: 6) {
          Text("New channel").font(.system(size: 28, weight: .semibold))
          Text("One channel per client or project. Threads, PRs, secrets and the browser profile are scoped to it.")
            .font(.system(size: 13.5))
            .foregroundStyle(.secondary)
        }
        ChannelSettingsForm(model: model)
      }
      .padding(.top, 32)
    }
  }
}

/// A channel that is not in the sidebar list: archived (offer Unarchive) or a wrong id.
struct MissingChannelView: View {
  let model: AppModel
  let id: String
  @State private var archived: Channel?
  @State private var checked = false
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    VStack(spacing: 12) {
      if let archived {
        Image(systemName: "archivebox").font(.system(size: 26)).foregroundStyle(.tertiary)
        Text("#\(archived.name) is archived").font(.system(size: 15, weight: .medium))
        Text("Its threads are kept. Unarchive to see them in the sidebar and start new ones.")
          .font(.system(size: 12.5))
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
        if let error { Text(error).font(.system(size: 12.5)).foregroundStyle(ThreadStyle.bad) }
        HStack {
          Button {
            Task { await unarchive() }
          } label: {
            Label("Unarchive", systemImage: "archivebox")
          }
          .buttonStyle(.borderedProminent)
          .disabled(busy)
          Button("Go Home") { model.route = .home }
        }
        .controlSize(.large)
      } else if checked {
        ContentUnavailableView {
          Label("#\(id) not found", systemImage: "number")
        } description: {
          Text("The id is wrong, or the channel was deleted.")
        } actions: {
          Button("Go Home") { model.route = .home }
        }
      } else {
        ProgressView().controlSize(.small)
      }
    }
    .frame(maxWidth: 420)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .task(id: id) {
      let found = try? await model.client.channel(id)
      archived = found.flatMap { $0.archived ? $0.channel : nil }
      checked = true
    }
  }

  private func unarchive() async {
    busy = true
    error = nil
    defer { busy = false }
    do {
      _ = try await model.client.setChannelArchived(id, false)
      await model.store.reloadChannels()
    } catch {
      self.error = error.message
    }
  }
}

private struct SettingsSection<Content: View>: View {
  let title: String
  @ViewBuilder var content: Content

  init(_ title: String, @ViewBuilder content: () -> Content) {
    self.title = title
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(title).font(.system(size: 16, weight: .semibold))
      content
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(20)
    .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(ThreadStyle.line))
  }
}

private struct SettingsField<Content: View>: View {
  let label: String
  var hint: String?
  @ViewBuilder var content: Content

  init(_ label: String, hint: String? = nil, @ViewBuilder content: () -> Content) {
    self.label = label
    self.hint = hint
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      Text(label).font(.system(size: 12.5, weight: .medium))
      content
        .textFieldStyle(.roundedBorder)
      if let hint {
        Text(hint)
          .font(.system(size: 11.5))
          .foregroundStyle(.tertiary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct SettingsToggle: View {
  let title: String
  let detail: String
  @Binding var isOn: Bool

  var body: some View {
    HStack(alignment: .top, spacing: 16) {
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.system(size: 13, weight: .medium))
        Text(detail)
          .font(.system(size: 12))
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
      Spacer(minLength: 0)
      Toggle(title, isOn: $isOn)
        .labelsHidden()
        .toggleStyle(.switch)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
    .background(ThreadStyle.surface, in: RoundedRectangle(cornerRadius: 14))
  }
}

/// Opens a folder panel and puts the pick in `path`.
private struct FolderButton: View {
  let title: String
  @Binding var path: String

  var body: some View {
    Button {
      let panel = NSOpenPanel()
      panel.canChooseFiles = false
      panel.canChooseDirectories = true
      panel.allowsMultipleSelection = false
      panel.prompt = "Choose"
      panel.message = title
      let current = path.trimmingCharacters(in: .whitespaces)
      if !current.isEmpty { panel.directoryURL = URL(fileURLWithPath: (current as NSString).expandingTildeInPath) }
      if panel.runModal() == .OK, let url = panel.url { path = url.path }
    } label: {
      Label("Choose", systemImage: "folder")
    }
    .help(title)
  }
}
