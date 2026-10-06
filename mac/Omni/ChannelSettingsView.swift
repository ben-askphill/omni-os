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
  @State private var svgError: String?
  @State private var designBusy = false
  @State private var designError: String?

  init(model: AppModel, existing: Channel? = nil) {
    self.model = model
    self.existing = existing
    _form = State(initialValue: existing.map(ChannelForm.init(channel:)) ?? ChannelForm())
  }

  private var isNew: Bool { existing == nil }

  /// Reads an SVG file into the form. The server cleans it and refuses one with scripts or links on save.
  private func uploadSVG() {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.svg]
    panel.allowsMultipleSelection = false
    panel.prompt = "Use SVG"
    panel.message = "Choose an SVG for the channel icon"
    guard panel.runModal() == .OK, let url = panel.url else { return }
    svgError = nil
    let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    guard size <= ChannelIcon.svgFileMax else { svgError = "That SVG is too big: keep it under 20 KB."; return }
    guard let text = try? String(contentsOf: url, encoding: .utf8), form.setSVG(text) else {
      svgError = "That file is not an SVG."
      return
    }
  }
  /// Sent as soon as the file is chosen, not with Save: the file is too big to hold in the form.
  private func chooseDesignSystem() {
    guard let existing else { return }
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.html]
    panel.allowsMultipleSelection = false
    panel.prompt = "Use file"
    panel.message = "Choose the channel's design system, a standalone HTML file"
    guard panel.runModal() == .OK, let url = panel.url else { return }
    designError = nil
    guard let data = try? Data(contentsOf: url) else { designError = "Could not read that file."; return }
    switch DesignSystemFile.read(data) {
    case .failure(let e): designError = e.message
    case .success(let html):
      Task { await changeDesignSystem(existing.id, set: (url.lastPathComponent, html)) }
    }
  }

  /// Sets the channel's design system to a file, or removes it when there is none.
  private func changeDesignSystem(_ id: String, set file: (name: String, html: String)? = nil) async {
    designBusy = true
    designError = nil
    defer { designBusy = false }
    do {
      if let file {
        _ = try await model.client.setDesignSystem(id, name: file.name, html: file.html)
      } else {
        _ = try await model.client.removeDesignSystem(id)
      }
      await model.store.reloadChannels()
    } catch {
      designError = error.message
    }
  }

  private var designSystem: some View {
    SettingsField(
      "Design system",
      hint: "One standalone HTML file with your tokens, type and components. Threads in this channel read it before they write an HTML page, so every artifact looks the same. Saved as soon as you pick the file."
    ) {
      VStack(alignment: .leading, spacing: 8) {
        HStack(spacing: 8) {
          if let name = existing?.designSystemName, let existing {
            HStack(spacing: 8) {
              OmniIcon(name: "file", size: 14)
              Link(name, destination: model.client.designSystemURL(existing.id))
              Text("\(max(1, Int((Double(existing.designSystemSize) / 1024).rounded()))) KB").foregroundStyle(Tok.fg3)
            }
            .font(.system(size: 13))
            .padding(.horizontal, 12)
            .frame(height: 30)
            .background(Capsule().fill(Tok.surface))
          }
          Button { chooseDesignSystem() } label: {
            HStack(spacing: 6) {
              if designBusy { Loader(size: 14) } else { OmniIcon(name: "file", size: 14) }
              Text(existing?.designSystemName == nil ? "Upload HTML file" : "Replace file")
            }
          }
          .buttonStyle(.pill(.secondary, height: 30))
          .disabled(designBusy)
          if existing?.designSystemName != nil, let existing {
            Button("Remove") { Task { await changeDesignSystem(existing.id) } }
              .buttonStyle(.pill(.secondary, height: 30))
              .disabled(designBusy)
          }
          Spacer(minLength: 0)
        }
        if let designError { ErrorNote(text: designError) }
      }
    }
  }

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
            .textFieldStyle(.omniMono)
            .disabled(!isNew)
            .accessibilityLabel("Id")
        }
      }
      SettingsField("Icon", hint: "Shown in the sidebar and on the channel. Type an emoji (Ctrl+Cmd+Space opens the picker), upload an SVG or pick an icon. Empty uses the first letter.") {
        VStack(alignment: .leading, spacing: 12) {
          HStack(spacing: 12) {
            ChannelAvatar(name: form.name.isEmpty ? form.id : form.name, size: 36, icon: form.icon)
            TextField("", text: Binding(get: { form.emoji }, set: { form.setIcon($0) }), prompt: Text("Emoji"))
              .font(.system(size: 18))
              .multilineTextAlignment(.center)
              .frame(width: 96)
              .accessibilityLabel("Emoji")
            Button { uploadSVG() } label: {
              HStack(spacing: 6) {
                OmniIcon(name: "image", size: 14)
                Text(form.hasSVG ? "Replace SVG" : "Upload SVG")
              }
            }
            .buttonStyle(.pill(.secondary, height: 30))
            if !form.icon.isEmpty {
              Button("Clear") { form.icon = ""; svgError = nil }
                .buttonStyle(.pill(.secondary, height: 30))
            }
            Spacer(minLength: 0)
          }
          if let svgError { ErrorNote(text: svgError) }
          GlyphPicker(selection: ChannelIcon(form.icon)) { form.toggleGlyph($0); svgError = nil }
        }
      }
      if !isSystem {
        SettingsField("Kind") {
          SegmentedPill(selection: $form.kind, options: [(.client, "Client"), (.internal, "Internal"), (.personal, "Personal")])
            .fixedSize()
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Kind")
        }
      }
      if !isNew { designSystem }
      SettingsField("Notes", hint: "Added to every thread's system prompt in this channel. Keep it short: who the client is, conventions, what not to touch.") {
        OmniTextEditor(text: $form.notes)
          .accessibilityLabel("Notes")
      }
    }
  }

  private var code: some View {
    SettingsSection("Code") {
      SettingsField("Repo path", hint: "Absolute path to a local git repo. Enables per-thread worktrees and the PRs tab.") {
        HStack(spacing: 8) {
          TextField("", text: $form.repoPath, prompt: Text("/Users/benrosenberg/code/apa-volero"))
            .textFieldStyle(.omniMono)
            .accessibilityLabel("Repo path")
          FolderButton(title: "Choose repo folder", path: $form.repoPath)
        }
      }
      SettingsField("GitHub repo", hint: "owner/name. Auto-detected from the repo path when left empty.") {
        TextField("", text: $form.githubRepo, prompt: Text("askphill/apa-volero"))
          .textFieldStyle(.omniMono)
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
            .textFieldStyle(.omniMono)
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
            .textFieldStyle(.omniMono)
            .accessibilityLabel("Store domain")
        }
        SettingsField("Portal slug", hint: "Ask Phill Portal company slug, for client context.") {
          TextField("", text: $form.portalSlug, prompt: Text("volero"))
            .textFieldStyle(.omniMono)
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
        HStack(spacing: 8) {
          if busy { Loader(size: 14) }
          Text(isNew ? "Create channel" : "Save changes")
        }
      }
      .buttonStyle(.pill(.primary, height: 34))
      .keyboardShortcut(.defaultAction)
      .disabled(busy)
      if saved {
        HStack(spacing: 6) {
          GlyphView(glyph: .done, size: 8)
          Text("Saved")
        }
        .font(.system(size: 12.5))
        .foregroundStyle(Tok.fg2)
        .transition(.scale(scale: 0.8).combined(with: .opacity))
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
          .buttonStyle(.pill(.ghost, height: 34))
          .disabled(archiving)
        Button(role: .destructive) { Task { await archive() } } label: {
          HStack(spacing: 8) {
            if archiving { Loader(size: 14) }
            Text(archiving ? "Archiving" : "Archive")
          }
        }
        .buttonStyle(.pill(.needs, height: 34))
        .disabled(archiving)
      }
    } else {
      Button {
        confirmArchive = true
      } label: {
        HStack(spacing: 8) {
          OmniIcon(name: "archive", size: 15)
          Text("Archive channel")
        }
      }
      .buttonStyle(.pill(.secondary, height: 34))
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
      VStack(alignment: .leading, spacing: 24) {
        OmniPageHeader(title: "New channel", subtitle: "One channel per client or project. Threads, PRs, secrets and the browser profile are scoped to it.")
        ChannelSettingsForm(model: model)
      }
      .padding(.top, 40)
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
    VStack(spacing: 0) {
      if let archived {
        EmptyNote(symbol: "archive", title: "#\(archived.name) is archived",
                  message: "Its threads are kept. Unarchive to see them in the sidebar and start new ones.") {
          VStack(spacing: 12) {
            if let error {
              HStack(spacing: 6) {
                GlyphView(glyph: .needs, size: 7)
                Text(error)
              }
              .font(.system(size: 12.5))
              .foregroundStyle(Tok.fg2)
            }
            HStack(spacing: 8) {
              Button {
                Task { await unarchive() }
              } label: {
                HStack(spacing: 8) {
                  if busy { Loader(size: 14) } else { OmniIcon(name: "archive", size: 15) }
                  Text("Unarchive")
                }
              }
              .buttonStyle(.pill(.primary, height: 34))
              .disabled(busy)
              Button("Go home") { model.route = .home }
                .buttonStyle(.pill(.secondary, height: 34))
            }
          }
        }
      } else if checked {
        EmptyNote(symbol: "hash", title: "#\(id) not found", message: "The id is wrong, or the channel was deleted.") {
          Button("Go home") { model.route = .home }
            .buttonStyle(.pill(.secondary, height: 34))
        }
      } else {
        LoadingNote().padding(.horizontal, 32)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
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
      Text(title).font(.system(size: 16, weight: .medium)).tracking(-0.16).foregroundStyle(Tok.fg)
      content
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(20)
    .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Tok.line))
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
    VStack(alignment: .leading, spacing: 0) {
      FieldLabel(text: label, hint: hint)
      content
        .textFieldStyle(.omni)
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
        Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(Tok.fg)
        Text(detail)
          .font(.system(size: 12))
          .foregroundStyle(Tok.fg3)
          .fixedSize(horizontal: false, vertical: true)
      }
      Spacer(minLength: 0)
      Toggle(title, isOn: $isOn)
        .toggleStyle(.omni)
        .accessibilityLabel(title)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
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
      Text("Choose")
    }
    .buttonStyle(.pill(.secondary, height: 38))
    .help(title)
  }
}

/// The design system icons a channel can pick, as IconPicker in ChannelSettings.tsx. The picked one is ink.
private struct GlyphPicker: View {
  let selection: ChannelIcon?
  let pick: (String) -> Void

  var body: some View {
    LazyVGrid(columns: [GridItem(.adaptive(minimum: 36, maximum: 36), spacing: 4)], alignment: .leading, spacing: 4) {
      ForEach(ChannelIcon.glyphs, id: \.self) { name in
        let on = selection == .glyph(name)
        Button { pick(name) } label: {
          OmniIcon(name: name, size: 17)
            .foregroundStyle(on ? Tok.onInk : Tok.fg2)
            .frame(width: 36, height: 36)
            .background(on ? Tok.fg : .clear, in: Circle())
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help(name)
        .accessibilityLabel(name)
        .accessibilityAddTraits(on ? .isSelected : [])
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Icon")
  }
}
