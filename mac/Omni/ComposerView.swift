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
    let reply = box.model ?? ReplyComposerModel(threadID: store.id, api: model.client)
    box.model = reply
    let menu = box.menu ?? SlashMenuModel(
      commands: SlashCommandsStore(api: model.client, source: .thread(store.id)),
      files: FileMentionsStore(api: model.client, source: .thread(store.id)), placement: .reply, harness: thread.harness.rawValue)
    box.menu = menu
    return ReplyComposerView(model: model, store: store, thread: thread, reply: reply, menu: menu)
    .frame(maxWidth: ThreadStyle.thread)
    .padding(.horizontal, 24)
    .padding(.top, 4)
    .padding(.bottom, 16)
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
        HStack(spacing: 6) {
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
        } label: {
          HStack(spacing: 5) {
            if opening { ProgressView().controlSize(.mini) } else { Image(systemName: "arrow.triangle.pull") }
            Text("#\(pr.number)")
            PRChip(text: pr.badge, tone: pr.badge == "open" ? .ok : pr.badge == "merged" ? .info : .outline)
            if prs.prs.count > 1 { Text("+\(prs.prs.count - 1)").foregroundStyle(Tok.fg4) }
          }
          .font(.omni(size: 12.5))
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.visible)
        .fixedSize()
        .padding(.horizontal, 8)
        .frame(height: z(26))
        .foregroundStyle(Tok.fg3)
        .help(pr.title)
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
      HStack(spacing: 6) {
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

  private var busyThread: Bool { thread.status.isActive }
  /// The server's guess at the next reply, shown in the empty box. Tab takes it.
  private var suggestion: String? {
    guard !busyThread, reply.text.isEmpty, let s = thread.suggestion, !s.isEmpty else { return nil }
    return s
  }
  private var canSteer: Bool {
    let caps = model.store.harnesses.first { $0.id == thread.harness }?.capabilities
    return SendRules.canSteer(harness: thread.harness, capabilities: caps)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let e = store.actionError { ErrorNote(text: e.message) }
      if let e = reply.sendError ?? omniError { ErrorNote(text: e) }
      shell
    }
    #if DEBUG
    .onAppear {
      QAComposerProbe.current = QAComposerProbe.Hooks(
        setText: {
          reply.text = $0
          focusTick += 1
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
      if !reply.files.isEmpty {
        AttachmentStrip(files: reply.files, remove: reply.removeFile)
      }
      ComposerTextView(
        text: $reply.text, placeholder: suggestion ?? SendRules.placeholder(busy: busyThread), running: busyThread,
        interrupting: store.interrupting, focusTick: focusTick, callbacks: callbacks, caretRequest: caret
      )
      .fixedSize(horizontal: false, vertical: false)
      if let e = reply.attachError {
        Text(e)
          .font(.omni(size: 12))
          .foregroundStyle(Tok.fg)
          .padding(.horizontal, 16)
          .padding(.bottom, 4)
      }
      footer
      SlashHintView(model: menu) { newThreadOnAnotherModel() }
        .padding(.horizontal, 16)
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
      DictateButton { focusTick += 1 }
      ThreadRunPills(thread: thread, harnesses: model.store.harnesses)
      if thread.branch != nil {
        ThreadPRSlot(model: model, thread: thread, busy: busyThread, opening: reply.openingPR) { Task { await openPR() } }
      }
      HStack(spacing: 10) {
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
    .padding(.horizontal, 8)
    .padding(.bottom, 8)
    .padding(.top, 6)
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

  /// `/model`, `/effort` and `/fast` can't change a running thread: offer a new one that picks its model.
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

/// The model and effort this thread is running on. Fixed, so they stay visible and are not pickers.
private struct ThreadRunPills: View {
  let thread: OmniThread
  let harnesses: [HarnessInfo]

  var body: some View {
    let labels = ThreadRunLabels.make(harness: thread.harness, model: thread.model, effort: thread.effort, harnesses: harnesses)
    HStack(spacing: 6) {
      pill(symbol: "bolt", text: labels.model, detail: labels.harnessName, label: "Model: \(labels.model) on \(labels.harnessName)")
      pill(symbol: "slider.horizontal.3", text: labels.effort, detail: nil, label: "Effort: \(labels.effort)")
    }
  }

  private func pill(symbol: String, text: String, detail: String?, label: String) -> some View {
    HStack(spacing: 6) {
      Image(systemName: symbol).font(.omni(size: 11.5)).foregroundStyle(Tok.fg3)
      Text(text).font(.omni(size: 12.5, weight: .medium)).lineLimit(1)
      if let detail { Text("· \(detail)").font(.omni(size: 12.5)).foregroundStyle(Tok.fg4).lineLimit(1) }
    }
    .padding(.horizontal, 10)
    .frame(height: z(28))
    .frame(maxWidth: z(220))
    .foregroundStyle(Tok.fg)
    .background(Tok.surface2, in: Capsule())
    .help("Fixed for this thread")
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label)
    .fixedSize()
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
        HStack(spacing: 6) {
          if sending {
            Loader(size: 16)
          } else {
            OmniIcon(name: canSteer ? "send" : "clock", size: 16, weight: 2)
          }
          Text(SendRules.buttonTitle(canSteer: canSteer)).font(.omni(size: 13, weight: .medium))
        }
        .padding(.leading, 14)
        .padding(.trailing, 10)
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
      HStack(spacing: 6) {
        ForEach(files) { f in
          HStack(spacing: 8) {
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
          .padding(.leading, 4)
          .padding(.trailing, 4)
          .frame(height: z(44))
          .background(Tok.surface2, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
      }
      .padding(.horizontal, 12)
    }
    .padding(.top, 12)
    .padding(.bottom, 2)
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
    .background(Tok.bg, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Tok.line))
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
    let send: (SendMode?) async throws(QAScriptError) -> Void
  }

  static var current: Hooks?
  /// Who set `current`, so a box that goes away after its successor appeared does not clear the successor's hooks.
  static var owner: ObjectIdentifier?
}
#endif
