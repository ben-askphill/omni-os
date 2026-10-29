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
    if composer.fixedChannel == NewThreadRules.conductor { return "Ask the Conductor. It delegates to the crew." }
    return composer.choice.channel == NewThreadRules.conductor ? "Ask the Conductor anything. It delegates to the crew." : "Describe the task"
  }

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
        })
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
      SlashHintView(model: menu) {}
        .padding(.horizontal, z(16))
        .padding(.bottom, menu.hint == nil ? 0 : 10)
        .padding(.top, menu.hint == nil ? 0 : 2)
      // The role's charter, inside the card, as Composer.tsx.
      if let role = composer.role, !role.description.isEmpty {
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
      roleMenu
      ModelPickerButton(
        harnesses: composer.harnesses, harness: composer.choice.harness, model: composer.choice.model,
        pick: { composer.selectModel(harness: $0, model: $1) }, refresh: refreshHarnesses, openRequest: pickerRequest, openQuery: pickerQuery)
      EffortMenu(options: composer.effortOptions, value: composer.choice.effort, auto: composer.choice.isAuto, pick: composer.selectEffort)
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
      HStack(spacing: z(10)) {
        ComposerHints()
        SendButton(title: "Start", armed: composer.canSend, sending: composer.sending) { start() }
      }
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

  /// A preset waiting for this channel's composer (`/clear`, `/new`, "New thread on another model"): take it once.
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

extension View {
  func pillMenu() -> some View {
    menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
  }
}

/// The effort pill: Default and the model's levels, or a disabled "Auto effort" when the model has none or Auto picks it.
struct EffortMenu: View {
  let options: [EffortOption]
  let value: String
  var auto = false
  /// Why it can't be picked now. nil when it can.
  var disabledHelp: String? = nil
  let pick: (String) -> Void

  var body: some View {
    if auto || options.isEmpty {
      PickerPill(text: "Auto effort") { PillIcon(name: "sliders") }
        .opacity(0.45)
        .help(auto ? "Auto picks the effort for each task" : "This model has no effort levels")
    } else {
      let label = options.first { $0.value == value }?.label ?? options[0].label
      Menu {
        Picker("Effort", selection: Binding(get: { value }, set: { pick($0) })) {
          ForEach(options) { o in Text(o.label).tag(o.value) }
        }
        .pickerStyle(.inline)
        .labelsHidden()
      } label: {
        PickerPill(text: label) { PillIcon(name: "sliders") }
      }
      .pillMenu()
      .disabled(disabledHelp != nil)
      .opacity(disabledHelp != nil ? 0.45 : 1)
      .help(disabledHelp ?? "Effort")
      .accessibilityLabel("Effort: \(label)")
    }
  }
}

/// The model pill and its list: Auto first, then models under each harness with its plan, one search, the default
/// marked, and a harness that isn't installed or logged in shown disabled with the command that fixes it (`ModelPicker.tsx`).
struct ModelPickerButton: View {
  let harnesses: [HarnessInfo]
  let harness: HarnessID
  /// "" when none is picked: the pill reads `placeholder`. `AutoRun.model` for Auto.
  let model: String
  /// The pill's label when no model is picked.
  var placeholder = "Model"
  let pick: (HarnessID, String) -> Void
  let refresh: () -> Void
  /// Bumped to open the list, for "New thread on another model".
  var openRequest = 0
  /// The search the list opens with on `openRequest`.
  var openQuery = ""
  /// A thread's reply box leaves Auto out: Auto only picks a run for a new thread.
  var offersAuto = true
  /// Why Auto picked this model. The pill then reads "Auto · <model>".
  var autoReason: String? = nil
  /// Why it can't be picked now. nil when it can.
  var disabledHelp: String? = nil
  @State private var open = false
  @State private var query = ""

  private var current: (harness: HarnessInfo?, model: ModelEntry?) {
    let h = harnesses.first { $0.id == harness }
    return (h, h?.models.first { $0.id == model })
  }

  var body: some View {
    let c = current
    Button {
      query = ""
      open.toggle()
      if open { refresh() }
    } label: {
      ViewThatFits(in: .horizontal) {
        pill(c, harness: true)
        pill(c, harness: false)
      }
    }
    .buttonStyle(.plain)
    .disabled(disabledHelp != nil)
    .opacity(disabledHelp != nil ? 0.45 : 1)
    .help(disabledHelp ?? autoReason ?? "Model")
    .accessibilityLabel(AutoRun.isAuto(model) ? "Model: Auto" : "Model: \(autoReason == nil ? "" : "Auto · ")\(c.model?.label ?? "none")\(c.harness.map { " on \($0.name)" } ?? "")")
    .popover(isPresented: $open, arrowEdge: .bottom) { list }
    .onChange(of: openRequest) {
      query = openQuery
      open = true
      refresh()
    }
  }

  private func title(_ c: (harness: HarnessInfo?, model: ModelEntry?)) -> String {
    let label = c.model?.label ?? placeholder
    return autoReason == nil ? label : "Auto · \(label)"
  }

  private func pill(_ c: (harness: HarnessInfo?, model: ModelEntry?), harness: Bool) -> some View {
    let auto = AutoRun.isAuto(model)
    return PickerPill(text: auto ? "Auto" : title(c), secondary: harness && c.model != nil ? c.harness?.name : nil) {
      if !auto, let h = c.harness {
        PillAvatar(fill: Tok.bg) { HarnessLogo(harness: h.id.rawValue, size: 13).foregroundStyle(Tok.fg) }
      } else {
        PillIcon(name: "zap")
      }
    }
  }

  private var list: some View {
    let groups = ModelSearch.groups(harnesses, query: query)
    return VStack(spacing: 0) {
      HStack(spacing: z(8)) {
        OmniIcon(name: "search", size: 15).foregroundStyle(Tok.fg4)
        TextField("Find a model or harness", text: $query).textFieldStyle(.plain).font(.omni(size: 13)).foregroundStyle(Tok.fg)
      }
      .padding(.horizontal, z(12))
      .frame(height: z(40))
      .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
      .padding([.horizontal, .top], z(6))
      .padding(.bottom, z(4))
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0, pinnedViews: .sectionHeaders) {
          if offersAuto && "auto".hasPrefix(query.trimmingCharacters(in: .whitespaces).lowercased()) { autoRow }
          ForEach(groups) { group in
            Section {
              rows(group)
            } header: {
              header(group.harness)
            }
          }
        }
        .padding(.horizontal, z(6))
        .padding(.bottom, z(6))
      }
      .frame(height: z(320))
    }
    .frame(width: z(340))
    .background(Tok.elev)
  }

  private func header(_ h: HarnessInfo) -> some View {
    HStack {
      HStack(spacing: z(6)) {
        HarnessLogo(harness: h.id.rawValue, size: 12)
        Text(h.name).lineLimit(1)
      }
      .omniCaption()
      Spacer()
      Text(h.available ? "Bills your \(h.plan)" : "Unavailable").font(.omni(size: 11.5)).foregroundStyle(Tok.fg4)
    }
    .padding(.horizontal, z(12))
    .padding(.top, z(8))
    .padding(.bottom, z(4))
    .frame(maxWidth: .infinity)
    .background(Tok.elev)
  }

  private var autoRow: some View {
    let selected = AutoRun.isAuto(model)
    return Button {
      pick(AutoRun.harness, AutoRun.model)
      open = false
    } label: {
      row(selected: selected, title: Text("Auto").foregroundStyle(Tok.fg), note: "Picks a model for each task") {
        OmniIcon(name: "zap", size: 13)
      }
    }
    .buttonStyle(.plain)
    .padding(.top, z(4))
    .accessibilityAddTraits(selected ? .isSelected : [])
  }

  private func row(selected: Bool, title: Text, note: String?, @ViewBuilder mark: () -> some View) -> some View {
    HStack(spacing: z(10)) {
      mark()
        .foregroundStyle(Tok.fg)
        .frame(width: z(28), height: z(28))
        .background(Tok.surface2, in: Circle())
      VStack(alignment: .leading, spacing: 1) {
        title.font(.omni(size: 13)).lineLimit(1)
        if let note { Text(note).font(.omni(size: 11.5)).foregroundStyle(Tok.fg4).lineLimit(1) }
      }
      Spacer(minLength: z(4))
      PickMark(on: selected)
    }
    .padding(.horizontal, z(8))
    .padding(.vertical, z(6))
    .frame(minHeight: z(40))
    .contentShape(RoundedRectangle(cornerRadius: z(16), style: .continuous))
  }

  @ViewBuilder private func rows(_ group: ModelGroup) -> some View {
    let h = group.harness
    if !h.available {
      Group {
        if let fix = h.fix, h.fixCommand == nil {
          Text("Not available. \(fix)")
        } else {
          Text("Not available. Run \(Text(h.fix ?? "the harness login").monospaced()).")
        }
      }
        .font(.omni(size: 11.5))
        .foregroundStyle(Tok.fg4)
        .padding(.horizontal, z(12))
        .padding(.bottom, z(8))
    } else if group.models.isEmpty {
      if !query.trimmingCharacters(in: .whitespaces).isEmpty {
        Text("No match").font(.omni(size: 11.5)).foregroundStyle(Tok.fg4).padding(.horizontal, z(12)).padding(.bottom, z(8))
      }
    } else {
      ForEach(group.models) { m in
        let selected = h.id == harness && m.id == model
        Button {
          pick(h.id, m.id)
          open = false
        } label: {
          row(selected: selected, title: Text(m.label).foregroundStyle(Tok.fg) + Text(m.isDefault ? " (default)" : "").foregroundStyle(Tok.fg4), note: m.note) {
            HarnessLogo(harness: h.id.rawValue, size: 13)
          }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
      }
    }
  }
}

/// `.pik-mark` in index.css: an outlined square that fills with ink when picked.
private struct PickMark: View {
  let on: Bool

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: z(6), style: .continuous)
    ZStack {
      shape.fill(on ? Tok.fg : .clear)
      shape.strokeBorder(on ? Tok.fg : Tok.lineStrong, lineWidth: 1.5)
      if on { OmniIcon(name: "check", size: 12, weight: 2.4).foregroundStyle(Tok.onInk) }
    }
    .frame(width: z(18), height: z(18))
    .animation(.easeOut(duration: 0.16), value: on)
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
