import AppKit
import OmniKit
import SwiftUI
import UniformTypeIdentifiers

/// The new-thread screen, where New Thread lands: the composer alone on a channel (`channelID`), with a greeting
/// on Home (nil). Home and Channel embed `NewThreadComposerView` the same way when they are built.
struct NewThreadScreen: View {
  let model: AppModel
  let channelID: String?

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        if channelID == nil { greeting }
        NewThreadComposerView(model: model, channelID: channelID, big: channelID == nil)
      }
      .frame(maxWidth: ThreadStyle.column)
      .padding(.horizontal, 24)
      .padding(.top, channelID == nil ? 56 : 24)
      .padding(.bottom, 48)
      .frame(maxWidth: .infinity)
    }
    .id(channelID)
  }

  private var greeting: some View {
    VStack(alignment: .leading, spacing: 0) {
      StaticMark(size: 40).foregroundStyle(Tok.fg)
      Text(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(Locale(identifier: "en_GB"))))
        .omniCaption()
        .padding(.top, 16)
        .padding(.bottom, 10)
      Text(NewThreadText.greeting(hour: Calendar.current.component(.hour, from: .now)))
        .font(.omni(size: 36, weight: .medium))
        .tracking(-0.36)
        .foregroundStyle(Tok.fg)
    }
    .padding(.horizontal, 4)
  }
}

enum NewThreadText {
  static func greeting(hour h: Int) -> String {
    h < 5 ? "Late one, Ben" : h < 12 ? "Morning, Ben" : h < 18 ? "Afternoon, Ben" : "Evening, Ben"
  }
}

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
  @State private var focusTick = 0
  @State private var focused = false
  @State private var over = false
  @State private var picking = false

  private struct Lists: Equatable {
    let crew: [CrewRole]
    let channels: Set<String>
    let harnesses: [HarnessInfo]
    let defaults: [String: RunDefaults]
  }

  private var lists: Lists {
    let channels = model.store.channels
    return Lists(
      crew: model.store.crew, channels: Set(channels.map(\.id)), harnesses: model.store.harnesses,
      defaults: Dictionary(channels.map { ($0.id, $0.runDefaults) }, uniquingKeysWith: { a, _ in a }))
  }

  private var placeholder: String {
    if composer.fixedChannel == NewThreadRules.conductor { return "Ask the Conductor. It delegates to the crew." }
    return composer.choice.channel == NewThreadRules.conductor ? "Ask the Conductor anything. It delegates to the crew." : "Describe the task"
  }

  private var range: ClosedRange<CGFloat> { big ? 96...360 : 60...260 }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
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
        send: { _ throws(QAScriptError) in
          guard composer.canSend else { throw QAScriptError("the new thread box has nothing to send") }
          guard let t = await composer.send() else { throw QAScriptError(composer.sendError ?? "the send failed") }
          model.route = .thread(id: t.id)
        })
    }
    .onDisappear {
      if QAComposerProbe.owner == ObjectIdentifier(composer) { QAComposerProbe.current = nil }
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
        callbacks: callbacks, heightRange: range, label: "New thread", caretRequest: caret, fontSize: big ? 16 : 14.5)
      if let e = composer.attachError {
        Text(e).font(.omni(size: 12)).foregroundStyle(Tok.fg).padding(.horizontal, 16).padding(.bottom, 4)
      }
      footer
      SlashHintView(model: menu) {}
        .padding(.horizontal, 16)
        .padding(.bottom, menu.hint == nil ? 0 : 10)
        .padding(.top, menu.hint == nil ? 0 : 2)
      // The role's charter, inside the card, as Composer.tsx.
      if let role = composer.role, !role.description.isEmpty {
        Text(role.description)
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg3)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, 16)
          .padding(.bottom, 10)
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
        pick: { composer.selectModel(harness: $0, model: $1) }, refresh: refreshHarnesses, openRequest: pickerRequest)
      EffortMenu(options: composer.effortOptions, value: composer.choice.effort, pick: composer.selectEffort)
      AttachButton(disabled: composer.sending) { picking = true }
      HStack(spacing: 10) {
        ComposerHints()
        SendButton(title: "Start", armed: composer.canSend, sending: composer.sending) { start() }
      }
    }
    .padding(.horizontal, 8)
    .padding(.bottom, 8)
    .padding(.top, 6)
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
    Task {
      guard let list = try? await model.client.harnesses() else { return }
      let l = lists
      composer.update(crew: composer.crew, channels: l.channels, harnesses: list, defaults: l.defaults)
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

private extension View {
  func pillMenu() -> some View {
    menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
  }
}

/// The effort pill: Default and the model's levels, or a disabled "Auto effort" when the model has none.
struct EffortMenu: View {
  let options: [EffortOption]
  let value: String
  let pick: (String) -> Void

  var body: some View {
    if options.isEmpty {
      PickerPill(text: "Auto effort") { PillIcon(name: "sliders") }
        .opacity(0.45)
        .help("This model has no effort levels")
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
      .help("Effort")
      .accessibilityLabel("Effort: \(label)")
    }
  }
}

/// The model pill and its list: models under each harness with its plan, one search, the default marked, and a
/// harness that isn't installed or logged in shown disabled with the command that fixes it (`ModelPicker.tsx`).
struct ModelPickerButton: View {
  let harnesses: [HarnessInfo]
  let harness: HarnessID
  /// "" when none is picked: the pill reads `placeholder`.
  let model: String
  /// The pill's label when no model is picked.
  var placeholder = "Model"
  let pick: (HarnessID, String) -> Void
  let refresh: () -> Void
  /// Bumped to open the list, for "New thread on another model".
  var openRequest = 0
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
    .help("Model")
    .accessibilityLabel("Model: \(c.model?.label ?? "none")\(c.harness.map { " on \($0.name)" } ?? "")")
    .popover(isPresented: $open, arrowEdge: .bottom) { list }
    .onChange(of: openRequest) {
      query = ""
      open = true
      refresh()
    }
  }

  private func pill(_ c: (harness: HarnessInfo?, model: ModelEntry?), harness: Bool) -> some View {
    PickerPill(text: c.model?.label ?? placeholder, secondary: harness && c.model != nil ? c.harness?.name : nil) {
      if let h = c.harness {
        PillAvatar(fill: Tok.bg) { HarnessLogo(harness: h.id.rawValue, size: 13).foregroundStyle(Tok.fg) }
      } else {
        PillIcon(name: "zap")
      }
    }
  }

  private var list: some View {
    let groups = ModelSearch.groups(harnesses, query: query)
    return VStack(spacing: 0) {
      HStack(spacing: 8) {
        OmniIcon(name: "search", size: 15).foregroundStyle(Tok.fg4)
        TextField("Find a model or harness", text: $query).textFieldStyle(.plain).font(.omni(size: 13)).foregroundStyle(Tok.fg)
      }
      .padding(.horizontal, 12)
      .frame(height: z(40))
      .background(Tok.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
      .padding([.horizontal, .top], 6)
      .padding(.bottom, 4)
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0, pinnedViews: .sectionHeaders) {
          ForEach(groups) { group in
            Section {
              rows(group)
            } header: {
              header(group.harness)
            }
          }
        }
        .padding(.horizontal, 6)
        .padding(.bottom, 6)
      }
      .frame(height: z(320))
    }
    .frame(width: z(340))
    .background(Tok.elev)
  }

  private func header(_ h: HarnessInfo) -> some View {
    HStack {
      HStack(spacing: 6) {
        HarnessLogo(harness: h.id.rawValue, size: 12)
        Text(h.name).lineLimit(1)
      }
      .omniCaption()
      Spacer()
      Text(h.available ? "Bills your \(h.plan)" : "Unavailable").font(.omni(size: 11.5)).foregroundStyle(Tok.fg4)
    }
    .padding(.horizontal, 12)
    .padding(.top, 8)
    .padding(.bottom, 4)
    .frame(maxWidth: .infinity)
    .background(Tok.elev)
  }

  @ViewBuilder private func rows(_ group: ModelGroup) -> some View {
    let h = group.harness
    if !h.available {
      Text("Not available. Run \(Text(h.fix ?? "the harness login").monospaced()).")
        .font(.omni(size: 11.5))
        .foregroundStyle(Tok.fg4)
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    } else if group.models.isEmpty {
      if !query.trimmingCharacters(in: .whitespaces).isEmpty {
        Text("No match").font(.omni(size: 11.5)).foregroundStyle(Tok.fg4).padding(.horizontal, 12).padding(.bottom, 8)
      }
    } else {
      ForEach(group.models) { m in
        let selected = h.id == harness && m.id == model
        Button {
          pick(h.id, m.id)
          open = false
        } label: {
          HStack(spacing: 10) {
            HarnessLogo(harness: h.id.rawValue, size: 13)
              .foregroundStyle(Tok.fg)
              .frame(width: z(28), height: z(28))
              .background(Tok.surface2, in: Circle())
            VStack(alignment: .leading, spacing: 1) {
              (Text(m.label).foregroundStyle(Tok.fg) + Text(m.isDefault ? " (default)" : "").foregroundStyle(Tok.fg4)).font(.omni(size: 13)).lineLimit(1)
              if let note = m.note { Text(note).font(.omni(size: 11.5)).foregroundStyle(Tok.fg4).lineLimit(1) }
            }
            Spacer(minLength: 4)
            PickMark(on: selected)
          }
          .padding(.horizontal, 8)
          .padding(.vertical, 6)
          .frame(minHeight: z(40))
          .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
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
    let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
    ZStack {
      shape.fill(on ? Tok.fg : .clear)
      shape.strokeBorder(on ? Tok.fg : Tok.lineStrong, lineWidth: 1.5)
      if on { OmniIcon(name: "check", size: 12, weight: 2.4).foregroundStyle(Tok.onInk) }
    }
    .frame(width: z(18), height: z(18))
    .animation(.easeOut(duration: 0.16), value: on)
  }
}
