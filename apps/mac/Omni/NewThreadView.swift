import AppKit
import OmniKit
import SwiftUI
import UniformTypeIdentifiers

/// The composer with channel, role, model and effort pickers; `NewThreadComposer` in Composer.tsx is the behavior.
/// Creating the thread opens it.
struct NewThreadComposerView: View {
  let model: AppModel
  let channelID: String?
  var big = false
  @State private var box = ComposerBox()

  /// Made on first use: reading the draft is a file read.
  @MainActor private final class ComposerBox {
    var composer: NewThreadComposerModel?
    var menu: SlashMenuModel?
  }

  var body: some View {
    let composer = box.composer ?? NewThreadComposerModel(fixedChannel: channelID, api: model.client)
    box.composer = composer
    let menu = box.menu ?? SlashMenuModel(
      commands: SlashCommandsStore(api: model.client, source: Self.source(composer.choice)),
      files: FileMentionsStore(api: model.client, source: .channel(composer.choice.channel)), placement: .newThread,
      harness: composer.choice.harness.rawValue)
    box.menu = menu
    // The menu's box overflows below the composer, over what follows it.
    return NewThreadBox(model: model, composer: composer, menu: menu, big: big).zIndex(1)
  }

  /// The list a thread started with these pickers would read its commands from.
  static func source(_ c: NewThreadChoice) -> CommandsSource {
    .newThread(harness: c.harness.rawValue, channel: c.channel)
  }
}

private struct NewThreadBox: View {
  let model: AppModel
  @Bindable var composer: NewThreadComposerModel
  let menu: SlashMenuModel
  let big: Bool
  @State private var caret: CaretRequest?
  @State private var pickerRequest = 0
  /// What the model list's search holds when `pickerRequest` opens it. Only QA sets it.
  @State private var pickerQuery = ""
  @State private var focusTick = 0
  @State private var focused = false
  @State private var over = false
  @State private var picking = false
  /// The harnesses as the picked channel sees them, once fetched. The store's list stands in until then.
  @State private var channelHarnesses: (channel: String, list: [HarnessInfo])?
  @State private var bases = BaseOptionsModel()

  private struct Lists: Equatable {
    let crew: [CrewRole]
    let channels: Set<String>
    let harnesses: [HarnessInfo]
    let defaults: [String: RunDefaults]
  }

  private struct RunOnInputs: Equatable {
    let devices: [Device]
    let saved: String
  }

  private var lists: Lists {
    let channels = model.store.channels
    let own = channelHarnesses.flatMap { $0.channel == composer.choice.channel ? $0.list : nil }
    return Lists(
      crew: model.store.crew, channels: Set(channels.map(\.id)), harnesses: own ?? model.store.harnesses,
      defaults: Dictionary(channels.map { ($0.id, $0.runDefaults) }, uniquingKeysWith: { a, _ in a }))
  }

  private var placeholder: String {
    if composer.fixedChannel == NewThreadRules.conductor { return SendRules.withKeys("Ask the Conductor. It delegates to the crew.") }
    return SendRules.withKeys(composer.choice.channel == NewThreadRules.conductor ? "Ask the Conductor anything. It delegates to the crew." : "Describe the task")
  }

  /// The Conductor channel runs the Conductor, and with no crew there is nothing to pick (`showRole` in Composer.tsx).
  private var showsRole: Bool { !composer.crew.isEmpty && composer.choice.channel != NewThreadRules.conductor }

  private var range: ClosedRange<CGFloat> { big ? 96...360 : 60...260 }

  var body: some View {
    VStack(alignment: .leading, spacing: z(8)) {
      shell
      if let e = composer.sendError { ErrorNote(text: e) }
    }
    #if DEBUG
    .onAppear {
      QAComposerProbe.owner = ObjectIdentifier(composer)
      QAComposerProbe.current = QAComposerProbe.Hooks(
        setText: {
          composer.text = $0
          focusTick += 1
        },
        run: { run throws(QAScriptError) in
          guard !composer.sending else { throw QAScriptError("the new thread is sending") }
          composer.selectModel(harness: run.harness, model: run.model)
          composer.selectEffort(run.effort)
        },
        send: { _ throws(QAScriptError) in
          guard composer.canSend else { throw QAScriptError("the new thread box has nothing to send") }
          guard let t = await composer.send() else { throw QAScriptError(composer.sendError ?? "the send failed") }
          model.route = .thread(id: t.id)
        },
        attach: { composer.addFiles([$0]) })
    }
    .onDisappear {
      if QAComposerProbe.owner == ObjectIdentifier(composer) { QAComposerProbe.current = nil }
    }
    .onAppear {
      QAProbe.openModelPicker = {
        pickerQuery = $0
        pickerRequest += 1
      }
    }
    #endif
    .onChange(of: lists, initial: true) { _, l in
      composer.update(crew: l.crew, channels: l.channels, harnesses: l.harnesses, defaults: l.defaults)
    }
    .onAppear {
      menu.onEdit = { text, at in
        composer.text = text
        caret = CaretRequest(id: (caret?.id ?? 0) + 1, offset: at)
      }
      takePreset()
    }
    .onChange(of: model.shell.newThreadPreset) { takePreset() }
    .onChange(of: RunOnInputs(devices: model.devices.devices, saved: model.runOn.saved), initial: true) { _, i in
      composer.updateRunOn(devices: i.devices, saved: i.saved)
    }
    // Where the thread can run: the other machines (Tailscale's view changes as they sleep) and Settings' default.
    .task(id: model.client.baseURL) {
      await model.runOn.load()
      while !Task.isCancelled {
        await model.devices.refresh()
        try? await Task.sleep(for: .seconds(30))
      }
    }
    // Cursor Cloud depends on the channel (it needs a GitHub repo), so the list is the channel's own.
    .onChange(of: composer.choice.channel, initial: true) { refreshHarnesses() }
    .task(id: composer.choice.channel) { await bases.load(channel: composer.choice.channel, api: model.client) }
    // Another harness or channel has its own list.
    .onChange(of: NewThreadComposerView.source(composer.choice), initial: true) { _, source in
      menu.commands.source = source
      menu.files?.source = .channel(composer.choice.channel)
      menu.harness = composer.choice.harness.rawValue
      if menu.isOpen || menu.hint != nil { Task { await menu.commands.load() } }
    }
    // Text set from outside the box (a sent or cleared draft) reaches the menu with the caret at the end.
    .onChange(of: composer.text) { _, text in
      if menu.text != text { menu.update(text: text, caret: text.utf16.count) }
    }
    .onChange(of: model.store.status?.maxUploadMb, initial: true) { _, mb in
      composer.maxUploadMB = mb ?? AttachmentRules.defaultMaxMB
    }
    .fileImporter(isPresented: $picking, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
      if case .success(let urls) = result { stage(urls) }
    }
  }

  private var shell: some View {
    return VStack(alignment: .leading, spacing: 0) {
      if !composer.files.isEmpty { AttachmentStrip(files: composer.files, remove: composer.removeFile) }
      ComposerTextView(
        text: $composer.text, placeholder: placeholder, running: false, interrupting: false, focusTick: focusTick,
        callbacks: callbacks, heightRange: range, label: "New thread", caretRequest: caret, fontSize: big ? 16 : 14.5, scale: UIZoom.settings.scale)
      if let e = composer.attachError {
        Text(e).font(.omni(size: 12)).foregroundStyle(Tok.fg).padding(.horizontal, z(16)).padding(.bottom, z(4))
      }
      footer
      SlashHintView(model: menu)
        .padding(.horizontal, z(16))
        .padding(.bottom, menu.hint == nil ? 0 : 10)
        .padding(.top, menu.hint == nil ? 0 : 2)
      // The role's charter, inside the card, as Composer.tsx.
      if showsRole, let role = composer.role, !role.description.isEmpty {
        Text(role.description)
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg3)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, z(16))
          .padding(.bottom, z(10))
      }
    }
    .composerShell(radius: 12, focused: focused, over: over)
    .dropDestination(for: URL.self) { urls, _ in
      stage(urls)
      return true
    } isTargeted: {
      over = $0
    }
    .slashMenu(menu, below: true)
  }

  private var footer: some View {
    ComposerFooterLayout {
      if composer.fixedChannel == nil { channelMenu }
      if showsRole { roleMenu }
      ModelPickerButton(
        harnesses: composer.harnesses, harness: composer.choice.harness, model: composer.choice.model,
        pick: { composer.selectModel(harness: $0, model: $1) }, refresh: refreshHarnesses, openRequest: pickerRequest, openQuery: pickerQuery,
        effort: EffortPick(options: composer.effortOptions, value: composer.choice.effort, pick: composer.selectEffort))
      if !composer.devices.isEmpty {
        RunOnMenu(devices: composer.devices, pick: composer.runOn, select: composer.selectRunOn)
      }
      if BaseRules.isOffered(bases.options, harness: composer.choice.harness), let options = bases.options {
        BasePicker(options: options, pick: composer.basePick, select: composer.selectBase)
      }
      AttachButton(disabled: composer.sending) { picking = true }
      if let folder = composer.folderChip {
        // "New thread here" on a sidebar folder files the thread in it, until Ben takes it out.
        Button { composer.clearFolder() } label: {
          FolderChip(name: folder.name)
        }
        .buttonStyle(.plain)
        .help("Filed in this folder. Click to start it ungrouped.")
        .accessibilityLabel("In folder \(folder.name). Remove")
      }
      DictateButton { focusTick += 1 }
      SendButton(title: "Start", armed: composer.canSend, sending: composer.sending) { start() }
    }
    .padding(.horizontal, z(8))
    .padding(.bottom, z(8))
    .padding(.top, z(6))
  }

  // MARK: Pickers

  private var channelMenu: some View {
    let channels = model.store.channels
    let current = composer.choice.channel
    return Menu {
      Picker("Channel", selection: Binding(get: { composer.choice.channel }, set: { composer.selectChannel($0) })) {
        ForEach(channels) { c in Text(c.id == NewThreadRules.conductor ? "Conductor" : c.name).tag(c.id) }
        if !channels.contains(where: { $0.id == current }) { Text(current).tag(current) }
      }
      .pickerStyle(.inline)
      .labelsHidden()
    } label: {
      PickerPill(text: channelName(current)) {
        if current == NewThreadRules.conductor {
          PillIcon(name: "target")
        } else {
          PillAvatar { Text(AvatarMark(name: channelName(current)).letter) }
        }
      }
    }
    .pillMenu()
    .help("Channel")
    .accessibilityLabel("Channel: \(channelName(current))")
  }

  private func channelName(_ id: String) -> String {
    id == NewThreadRules.conductor ? "Conductor" : model.store.channel(id)?.name ?? id
  }

  private var roleMenu: some View {
    let current = composer.role
    return Menu {
      Picker("Role", selection: Binding(get: { composer.choice.role }, set: { composer.selectRole($0) })) {
        Text("No role").tag("")
        ForEach(composer.crew) { r in Text(r.name).tag(r.id) }
      }
      .pickerStyle(.inline)
      .labelsHidden()
    } label: {
      PickerPill(text: current?.name ?? "No role") {
        if let current {
          if current.id == NewThreadRules.conductor {
            PillAvatar(fill: Tok.bg) { StaticMark(size: 13, ring: true).foregroundStyle(Tok.fg) }
          } else {
            PillAvatar { Text(AvatarMark(name: current.name).letter) }
          }
        } else {
          PillIcon(name: "x")
        }
      }
    }
    .pillMenu()
    .help("Role")
    .accessibilityLabel("Role: \(current?.name ?? "No role")")
  }

  private func refreshHarnesses() {
    let channel = composer.choice.channel
    Task {
      guard let list = try? await model.client.harnesses(channel: channel) else { return }
      channelHarnesses = (channel, list)
      let l = lists
      composer.update(crew: composer.crew, channels: l.channels, harnesses: l.harnesses, defaults: l.defaults)
    }
  }

  // MARK: Sending and files

  private var callbacks: ComposerCallbacks {
    ComposerCallbacks(
      send: { _ in start() },
      escape: { _ in false },
      files: { stage($0) },
      image: { stagePasted($0) },
      dragTargeted: { over = $0 },
      focusChanged: {
        focused = $0
        menu.setFocused($0)
      },
      slash: { menu.handle($0) },
      edited: { menu.update(text: $0, caret: $1) })
  }

  /// A preset waiting for this channel's composer (`/clear`, `/new`, a suggested thread): take it once.
  private func takePreset() {
    guard let preset = model.shell.newThreadPreset, preset.channel == composer.fixedChannel else { return }
    model.shell.newThreadPreset = nil
    composer.apply(preset)
    if preset.pickModel { pickerRequest += 1 }
  }

  private func start() {
    guard composer.canSend else { return }
    Task {
      if let t = await composer.send() { model.route = .thread(id: t.id) }
    }
  }

  private func stage(_ urls: [URL]) {
    composer.addFiles(urls.compactMap(StagedFile.at))
  }

  private func stagePasted(_ data: Data) {
    let dir = FileManager.default.temporaryDirectory.appending(path: "omni-paste-\(UUID().uuidString.prefix(8))")
    let url = dir.appending(path: "image.png")
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      try data.write(to: url)
    } catch {
      return
    }
    composer.addFiles([StagedFile(url: url, size: data.count, modified: .now, isTemporary: true)])
  }
}

/// The folder a thread from "New Thread Here" is filed in, as the web composer's chip: folder, name, x.
private struct FolderChip: View {
  let name: String
  @State private var hover = false

  var body: some View {
    HStack(spacing: z(6)) {
      OmniIcon(name: "folder", size: 13).foregroundStyle(Tok.fg3)
      Text(name).lineLimit(1).truncationMode(.tail)
      OmniIcon(name: "x", size: 12).foregroundStyle(Tok.fg4)
    }
    .font(.omni(size: 12.5))
    .foregroundStyle(hover ? Tok.fg : Tok.fg2)
    .padding(.horizontal, z(10))
    .frame(height: z(30))
    .frame(maxWidth: z(180))
    .background(hover ? Tok.wash : .clear, in: Capsule())
    .contentShape(Capsule())
    .onHover { hover = $0 }
    .fixedSize()
  }
}
