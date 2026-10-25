import AppKit
import OmniKit
import SwiftUI
import UniformTypeIdentifiers

/// The reply box pinned under a thread. It is the one line `ReplyComposerHost` in ThreadScreen.swift;
/// `ReplyComposer` in Composer.tsx is the behavior. Interrupt lives in the thread toolbar, beside the panel.
struct ReplyComposerHost: View {
  let model: AppModel
  let store: ThreadStore
  let thread: OmniThread
  @State private var box = ReplyBox()

  /// Made on first use, once per thread screen: reading the draft is a file read.
  @MainActor private final class ReplyBox {
    var model: ReplyComposerModel?
    var menu: SlashMenuModel?
  }

  var body: some View {
    let reply = box.model ?? ReplyComposerModel(threadID: store.id, api: model.client, context: store.draftContext)
    box.model = reply
    let menu = box.menu ?? SlashMenuModel(
      commands: SlashCommandsStore(api: model.client, source: .thread(store.id)),
      files: FileMentionsStore(api: model.client, source: .thread(store.id)), placement: .reply, harness: thread.harness.rawValue)
    box.menu = menu
    return ReplyComposerView(model: model, store: store, thread: thread, reply: reply, menu: menu)
    .frame(maxWidth: ThreadStyle.thread)
    .padding(.horizontal, z(24))
    .padding(.top, z(4))
    .padding(.bottom, z(16))
    .frame(maxWidth: .infinity)
  }
}

/// Interrupt in the toolbar. It reads Interrupting until the turn stops.
struct InterruptButton: View {
  let store: ThreadStore

  var body: some View {
    Button {
      Task { await store.interrupt() }
    } label: {
      if store.interrupting {
        HStack(spacing: z(6)) {
          Loader(size: 13)
          Text("Interrupting")
        }
      } else {
        Label("Interrupt", systemImage: "stop.fill")
      }
    }
    .disabled(store.interrupting)
    .help("Interrupt the agent (Esc). Messages already sent still run.")
    .accessibilityLabel(store.interrupting ? "Interrupting" : "Interrupt")
  }
}

/// Open PR until the branch has a PR, then that PR and whether it merged: `ThreadPR` in Thread.tsx.
/// It opens a menu of every PR from the branch, with Open PR there while none is open.
private struct ThreadPRSlot: View {
  let model: AppModel
  let thread: OmniThread
  let busy: Bool
  let opening: Bool
  let open: () -> Void
  /// nil until the first answer, so the button does not flash before the PR shows.
  @State private var prs: ThreadPullRequests?
  @State private var failed = false
  @State private var watch: PRWatch?
  @State private var watchError: String?

  var body: some View {
    // A ZStack, not a Group: a Group spreads its modifiers over its children, and before the first
    // answer it has none, so the .task below never ran and Open PR never showed.
    ZStack {
      if let pr = prs?.pr, let prs {
        Menu {
          Section("\(prs.prs.count) PR\(prs.prs.count == 1 ? "" : "s") from \(thread.branch ?? "this branch")") {
            ForEach(prs.prs) { p in
              Button("#\(p.number)  \(p.title)  (\(p.badge))") {
                model.route = .channel(id: thread.channelID, tab: .prs, pr: p.number)
              }
            }
          }
          if prs.canOpenAnother {
            Divider()
            Button("Open a new PR", action: open).disabled(opening)
          }
          PRWatchSection(client: model.client, threadID: thread.id, open: pr.isOpen, watch: $watch, error: $watchError)
        } label: {
          HStack(spacing: z(5)) {
            if opening { ProgressView().controlSize(.mini) } else { Image(systemName: "arrow.triangle.pull") }
            Text("#\(pr.number)")
            PRChip(text: pr.badge, tone: pr.badge == "open" ? .ok : pr.badge == "merged" ? .info : .outline)
            if prs.prs.count > 1 { Text("+\(prs.prs.count - 1)").foregroundStyle(Tok.fg4) }
            PRWatchGlyph(watch: watch)
          }
          .font(.omni(size: 12.5))
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.visible)
        .fixedSize()
        .padding(.horizontal, z(8))
        .frame(height: z(26))
        .foregroundStyle(Tok.fg3)
        .help(pr.title)
        #if DEBUG
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { QAPRProbe.button = $0 }
        #endif
      } else if prs != nil || failed {
        openButton
      } else {
        Color.clear.frame(width: 0, height: 0)
      }
    }
    // Again when a turn ends (it may have opened the PR), and every minute to catch a merge.
    .task(id: busy) {
      guard !busy else { return }
      while !Task.isCancelled {
        await load()
        try? await Task.sleep(for: .seconds(60))
      }
    }
  }

  private var openButton: some View {
    Button(action: open) {
      HStack(spacing: z(6)) {
        if opening { Loader(size: 13) } else { OmniIcon(name: "pr", size: 14) }
        Text("Open PR")
      }
    }
    .buttonStyle(.pill(.ghost, height: 28))
    .disabled(opening)
    .help(ReplyComposerModel.openPRPrompt)
  }

  private func load() async {
    do {
      prs = try await model.client.pullRequests(forThread: thread.id)
    } catch {
      failed = true
    }
    guard prs?.pr != nil else { return }
    do {
      watch = try await model.client.prWatch(forThread: thread.id)
    } catch {
      // A failed read keeps the last answer.
    }
  }
}

private struct ReplyComposerView: View {
  let model: AppModel
  let store: ThreadStore
  let thread: OmniThread
  @Bindable var reply: ReplyComposerModel
  let menu: SlashMenuModel
  @State private var caret: CaretRequest?
  @State private var omniBusy = false
  @State private var omniError: String?
  @State private var focused = false
  @State private var over = false
  @State private var focusTick = 0
  @State private var picking = false
  @State private var switching = false
  @State private var switchError: String?
  /// The harness list fetched when the model list opens, newer than the store's.
  @State private var fetchedHarnesses: [HarnessInfo]?

  private var busyThread: Bool { thread.status.isActive }
  /// The server's guess at the next reply, shown in the empty box. Tab takes it.
  private var suggestion: String? {
    guard !busyThread, reply.text.isEmpty, let s = thread.suggestion, !s.isEmpty else { return nil }
    return s
  }
  /// A switch queued behind the turn: what Ben sends waits for it too (apps/server/runner/queue.ts), so nothing steers.
  private var canSteer: Bool {
    let caps = model.store.harnesses.first { $0.id == thread.harness }?.capabilities
    return SendRules.canSteer(harness: thread.harness, capabilities: caps) && RunSwitch.queued(thread) == nil
  }

  var body: some View {
    VStack(alignment: .leading, spacing: z(8)) {
      // The setup card in the transcript says why while the worktree is not ready, and the handoff card while the
      // thread is on its way to or from another Mac: the server's block is then that card's own line.
      if let b = store.blocked, thread.setup == nil, store.handoff?.inFlight != true { ErrorNote(text: b) }
      if let e = store.actionError { ErrorNote(text: e.message) }
      if let e = reply.sendError ?? omniError ?? switchError { ErrorNote(text: e) }
      shell
    }
    #if DEBUG
    .onAppear {
      QAComposerProbe.current = QAComposerProbe.Hooks(
        setText: {
          reply.text = $0
          focusTick += 1
        },
        run: { run throws(QAScriptError) in
          guard !busyThread, !switching else { throw QAScriptError("switch after this turn") }
          switchRun(run)
        },
        send: { mode throws(QAScriptError) in
          guard reply.canSend else { throw QAScriptError("the reply box has nothing to send") }
          guard let t = await reply.send(mode: mode) else { throw QAScriptError(reply.sendError ?? "the send failed") }
          store.merge(t, isReply: true)
        })
    }
    .onDisappear { QAComposerProbe.current = nil }
    #endif
    .onChange(of: model.store.status?.maxUploadMb, initial: true) { _, mb in
      reply.maxUploadMB = mb ?? AttachmentRules.defaultMaxMB
    }
    .onAppear {
      menu.onEdit = { text, at in
        reply.text = text
        caret = CaretRequest(id: (caret?.id ?? 0) + 1, offset: at)
      }
    }
    // Lines just added from the Changes tab: Ben writes about them next.
    .onChange(of: reply.context.records.count) { old, new in if new > old { focusTick += 1 } }
    // Text set from outside the box (a sent or cleared draft) reaches the menu with the caret at the end.
    .onChange(of: reply.text) { _, text in
      if menu.text != text { menu.update(text: text, caret: text.utf16.count) }
    }
    .fileImporter(isPresented: $picking, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
      if case .success(let urls) = result { stage(urls) }
    }
  }

  private var shell: some View {
    VStack(alignment: .leading, spacing: 0) {
      DraftContextStrip(draft: reply.context)
      if !reply.files.isEmpty {
        AttachmentStrip(files: reply.files, remove: reply.removeFile)
      }
      ComposerTextView(
        text: $reply.text, placeholder: suggestion ?? SendRules.placeholder(busy: busyThread, canSteer: canSteer), running: busyThread,
        interrupting: store.interrupting, focusTick: focusTick, callbacks: callbacks, caretRequest: caret,
        scale: UIZoom.settings.scale
      )
      .fixedSize(horizontal: false, vertical: false)
      if let e = reply.attachError {
        Text(e)
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg)
          .padding(.horizontal, z(16))
          .padding(.bottom, z(4))
      }
      footer
      SlashHintView(model: menu) { newThreadOnAnotherModel() }
        .padding(.horizontal, z(16))
        .padding(.bottom, menu.hint == nil ? 0 : 10)
        .padding(.top, menu.hint == nil ? 0 : 2)
    }
    .composerShell(radius: 12, focused: focused, over: over)
    .dropDestination(for: URL.self) { urls, _ in
      stage(urls)
      return true
    } isTargeted: {
      over = $0
    }
    .slashMenu(menu)
  }

  private var footer: some View {
    ComposerFooterLayout {
      AttachButton(disabled: reply.sending) { picking = true }
      ThreadReferenceButton(client: model.client, thread: thread, draft: store.draftContext, disabled: reply.sending)
      DictateButton { focusTick += 1 }
      runPickers
      if thread.branch != nil {
        ThreadPRSlot(model: model, thread: thread, busy: busyThread, opening: reply.openingPR) { Task { await openPR() } }
      }
      HStack(spacing: z(10)) {
        ComposerHints(tab: suggestion != nil)
        if let omni = menu.reply, omni.action != .send {
          SendButton(title: omni.label ?? "Send", armed: omni.armed, sending: omniBusy) { runOmni() }
        } else if busyThread {
          SteerButton(canSteer: canSteer, enabled: reply.canSend, sending: reply.sending) { send($0) }
        } else {
          SendButton(armed: reply.canSend, sending: reply.sending) { send(nil) }
        }
      }
    }
    .padding(.horizontal, z(8))
    .padding(.bottom, z(8))
    .padding(.top, z(6))
  }

  /// The model and effort the thread runs on. A pick switches its next turn. While a turn runs it waits for that turn:
  /// the pickers show it, ringed, after a "Next turn" chip whose click keeps the current run. Separate views, so the
  /// footer wraps between them in a narrow window.
  @ViewBuilder private var runPickers: some View {
    let harnesses = fetchedHarnesses ?? model.store.harnesses
    let shown = RunSwitch.shown(thread)
    let queued = RunSwitch.queued(thread) != nil
    let disabled = switching ? "Switching" : nil
    let ring = Capsule().strokeBorder(queued ? Tok.live : .clear, lineWidth: 1)
    if queued { NextTurnChip(now: RunSwitch.describe(RunSwitch.current(thread), harnesses: harnesses)) { switchRun(RunSwitch.current(thread)) } }
    ModelPickerButton(
      harnesses: harnesses, harness: shown.harness, model: RunSwitch.shownModel(shown, harnesses: harnesses),
      pick: { switchRun(RunSwitch.picking(harness: $0, model: $1, from: shown, harnesses: harnesses)) },
      refresh: refreshHarnesses, offersAuto: false, autoReason: queued ? nil : thread.autoReason, disabledHelp: disabled)
      .overlay(ring)
    EffortMenu(
      options: EffortRules.options(for: EffortRules.model(harness: shown.harness, model: shown.model, in: harnesses)),
      value: shown.effort, disabledHelp: disabled) { switchRun(RunSwitch.picking(effort: $0, from: shown)) }
      .overlay(ring)
  }

  private func refreshHarnesses() {
    Task {
      if let list = try? await model.client.harnesses() { fetchedHarnesses = list }
    }
  }

  /// Nothing changes until the server answers: it checks the catalog, and queues the pick while a turn runs.
  private func switchRun(_ run: Run?) {
    guard let run, !switching else { return }
    switching = true
    switchError = nil
    Task {
      defer { switching = false }
      do {
        store.merge(try await model.client.switchRun(thread.id, to: run))
      } catch {
        switchError = error.localizedDescription
      }
    }
  }

  private var callbacks: ComposerCallbacks {
    ComposerCallbacks(
      send: { interrupt in
        if let omni = menu.reply, omni.action != .send { return runOmni() }
        send(SendRules.mode(busy: busyThread, canSteer: canSteer, shift: interrupt))
      },
      escape: { context in
        var context = context
        context.slashMenuOpen = menu.isOpen
        guard EscapeGate.interrupts(context) else { return false }
        Task { await store.interrupt() }
        return true
      },
      files: { stage($0) },
      image: { stagePasted($0) },
      dragTargeted: { over = $0 },
      focusChanged: {
        focused = $0
        menu.setFocused($0)
      },
      slash: { menu.handle($0) },
      edited: { menu.update(text: $0, caret: $1) },
      tab: {
        guard let s = suggestion else { return false }
        reply.text = s
        return true
      })
  }

  /// Send when the message starts with an Omni command: `/clear` and `/new` start a thread, `/rename` renames this one.
  private func runOmni() {
    guard let omni = menu.reply, omni.action != .send, omni.armed, !omniBusy else { return }
    let raw = reply.text
    omniBusy = true
    omniError = nil
    Task {
      defer { omniBusy = false }
      do {
        guard let result = try await OmniKit.OmniCommands.run(omni.action, in: thread, client: model.client) else { return }
        if reply.text == raw { reply.text = "" }
        switch result {
        case .openNewThread(let preset): model.openNewThread(preset)
        case .threadCreated(let t): model.route = .thread(id: t.id)
        case .renamed(let t): store.merge(t)
        }
      } catch let error as OmniAPIError {
        omniError = error.message
      } catch {
        omniError = error.localizedDescription
      }
    }
  }

  /// The hint under `/model`, `/effort` and `/fast` offers a new thread that picks its model.
  private func newThreadOnAnotherModel() {
    reply.text = ""
    model.openNewThread(.otherModel(thread))
  }

  private func send(_ mode: SendMode?) {
    guard reply.canSend else { return }
    Task {
      if let t = await reply.send(mode: mode) { store.merge(t, isReply: true) }
      focusTick += 1
    }
  }

  private func openPR() async {
    if let t = await reply.openPR(running: busyThread) { store.merge(t, isReply: true) }
  }

  private func stage(_ urls: [URL]) {
    reply.addFiles(urls.compactMap(StagedFile.at))
  }

  /// A pasted screenshot goes to a temp `image.png`, which goes again when it is removed or sent.
  private func stagePasted(_ data: Data) {
    let dir = FileManager.default.temporaryDirectory.appending(path: "omni-paste-\(UUID().uuidString.prefix(8))")
    let url = dir.appending(path: "image.png")
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      try data.write(to: url)
    } catch {
      return
    }
    reply.addFiles([StagedFile(url: url, size: data.count, modified: .now, isTemporary: true)])
  }
}

/// The chip ahead of the pickers while a switch waits for the turn to end. Clicking it keeps the run the thread is on.
private struct NextTurnChip: View {
  /// The run the thread is on, named.
  let now: String
  let keep: () -> Void
  @State private var hover = false

  var body: some View {
    Button(action: keep) {
      HStack(spacing: z(6)) {
        OmniIcon(name: "clock", size: 13)
        Text("Next turn").font(.omni(size: 12, weight: .semibold))
        OmniIcon(name: "x", size: 12).foregroundStyle(Tok.fg4)
      }
      .foregroundStyle(Tok.live)
      .padding(.leading, z(10))
      .padding(.trailing, z(8))
      .frame(height: z(32))
      .background(hover ? Tok.surface3 : Tok.surface2, in: Capsule())
      .contentShape(Capsule())
      .onHover { hover = $0 }
    }
    .buttonStyle(.plain)
    .fixedSize()
    .help("Runs on \(now) until this turn ends. Click to keep it.")
    .accessibilityLabel("Keep \(now) for the next turn")
  }
}

/// SendButton in Composer.tsx: Bencho's round "cmd" go button, quiet until there is something to send, then ink.
struct SendButton: View {
  var title = "Send"
  let armed: Bool
  let sending: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Group {
        if sending { Loader(size: 16) } else { OmniIcon(name: "send", size: 16, weight: 2) }
      }
      .foregroundStyle(Tok.onInk)
      .frame(width: z(34), height: z(34))
      .background(Tok.fg, in: Circle())
      .contentShape(Circle())
    }
    .buttonStyle(PressScale())
    .opacity(armed && !sending ? 1 : 0.25)
    .fixedSize()
    .layoutPriority(1)
    .disabled(!armed || sending)
    .animation(.easeOut(duration: 0.15), value: armed)
    .help(title)
    .accessibilityLabel(title)
  }
}

/// `active:scale-[.92]`.
private struct PressScale: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.92 : 1)
      .animation(Motion.settle, value: configuration.isPressed)
  }
}

/// The busy thread's send: Steer (Queue where the harness can't steer) and a menu of the other ways.
private struct SteerButton: View {
  let canSteer: Bool
  let enabled: Bool
  let sending: Bool
  let send: (SendMode) -> Void

  private func symbol(_ mode: SendMode) -> String {
    switch mode {
    case .steer: "paperplane"
    case .queue: "clock"
    default: "stop.fill"
    }
  }

  var body: some View {
    HStack(spacing: 0) {
      Button {
        send(SendRules.primary(canSteer: canSteer))
      } label: {
        HStack(spacing: z(6)) {
          if sending {
            Loader(size: 16)
          } else {
            OmniIcon(name: canSteer ? "send" : "clock", size: 16, weight: 2)
          }
          Text(SendRules.buttonTitle(canSteer: canSteer)).font(.omni(size: 13, weight: .medium))
        }
        .padding(.leading, z(14))
        .padding(.trailing, z(10))
        .frame(height: z(34))
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      Rectangle().fill(Tok.onInk.opacity(0.25)).frame(width: 1, height: z(34))
      Menu {
        ForEach(SendRules.options(canSteer: canSteer), id: \.rawValue) { mode in
          Button {
            send(mode)
          } label: {
            Label(SendRules.title(mode), systemImage: symbol(mode))
          }
          .help(SendRules.hint(mode))
        }
      } label: {
        OmniIcon(name: "chevronDown", size: 13)
          .foregroundStyle(Tok.onInk)
          .frame(width: z(32), height: z(34))
          .contentShape(Rectangle())
      }
      .menuStyle(.button)
      .buttonStyle(.plain)
      .menuIndicator(.hidden)
      .fixedSize()
      .help("More ways to send")
      .accessibilityLabel("More ways to send")
    }
    .foregroundStyle(Tok.onInk)
    .background(Tok.fg, in: Capsule())
    .clipShape(Capsule())
    .opacity(enabled ? 1 : 0.25)
    .disabled(!enabled || sending)
  }
}

/// Staged files above the input, each removable until the message is sent.
struct AttachmentStrip: View {
  let files: [StagedFile]
  let remove: (StagedFile) -> Void

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: z(6)) {
        ForEach(files) { f in
          HStack(spacing: z(8)) {
            Thumb(file: f)
            VStack(alignment: .leading, spacing: 1) {
              Text(f.name).font(.omni(size: 12.5, weight: .medium)).foregroundStyle(Tok.fg2).lineLimit(1).truncationMode(.middle)
              Text(Format.bytes(f.size)).font(.omni(size: 10.5)).foregroundStyle(Tok.fg4).monospacedDigit()
            }
            .frame(maxWidth: z(170), alignment: .leading)
            Button {
              remove(f)
            } label: {
              OmniIcon(name: "x", size: 13)
            }
            .buttonStyle(.icon(size: 24))
            .help("Remove \(f.name)")
            .accessibilityLabel("Remove \(f.name)")
          }
          .padding(.leading, z(4))
          .padding(.trailing, z(4))
          .frame(height: z(44))
          .background(Tok.surface2, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
        }
      }
      .padding(.horizontal, z(12))
    }
    .padding(.top, z(12))
    .padding(.bottom, z(2))
  }
}

private struct Thumb: View {
  let file: StagedFile
  @State private var image: NSImage?

  var body: some View {
    Group {
      if let image {
        Image(nsImage: image).resizable().scaledToFill()
      } else {
        OmniIcon(name: "file", size: 15).foregroundStyle(Tok.fg3)
      }
    }
    .frame(width: z(36), height: z(36))
    .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(8), style: .continuous))
    .clipShape(RoundedRectangle(cornerRadius: z(8), style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: z(8), style: .continuous).strokeBorder(Tok.line))
    .task(id: file.url) {
      guard file.isImage else { return }
      let url = file.url
      image = await Task.detached { NSImage(contentsOf: url) }.value
    }
  }
}

#if DEBUG
/// What the QA runner reaches in the reply box: its text and its send.
@MainActor
enum QAComposerProbe {
  struct Hooks {
    let setText: (String) -> Void
    let run: (Run) throws(QAScriptError) -> Void
    let send: (SendMode?) async throws(QAScriptError) -> Void
  }

  static var current: Hooks?
  /// Who set `current`, so a box that goes away after its successor appeared does not clear the successor's hooks.
  static var owner: ObjectIdentifier?
}
#endif
