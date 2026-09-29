import AppKit
import OmniKit
import SwiftUI
import UniformTypeIdentifiers

/// The reply box pinned under a thread, and the toolbar's Interrupt button. It is the one line
/// `ReplyComposerHost` in ThreadScreen.swift; `ReplyComposer` in Composer.tsx is the behavior.
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
      commands: SlashCommandsStore(api: model.client, source: .thread(store.id)), placement: .reply, harness: thread.harness.rawValue)
    box.menu = menu
    return ReplyComposerView(model: model, store: store, thread: thread, reply: reply, menu: menu)
    .frame(maxWidth: ThreadStyle.column)
    .padding(.horizontal, 24)
    .padding(.top, 4)
    .padding(.bottom, 16)
    .frame(maxWidth: .infinity)
    .toolbar {
      if thread.status.isActive {
        ToolbarItem(placement: .primaryAction) { InterruptButton(store: store) }
      }
    }
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
          ProgressView().controlSize(.small)
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
private struct ThreadPRSlot: View {
  let model: AppModel
  let thread: OmniThread
  let busy: Bool
  let opening: Bool
  let open: () -> Void
  /// nil until the first answer, so the button does not flash before the PR shows.
  @State private var pr: PullRequestSummary??

  var body: some View {
    HStack(spacing: 4) {
      switch pr {
      case .none: EmptyView()
      case .some(.none): openButton
      case .some(.some(let pr)):
        Button {
          model.route = .channel(id: thread.channelID, tab: .prs, pr: pr.number)
        } label: {
          HStack(spacing: 5) {
            Image(systemName: "arrow.triangle.pull")
            Text("#\(pr.number)")
            PRChip(text: pr.badge, tone: pr.badge == "open" ? .ok : pr.badge == "merged" ? .info : .outline)
          }
          .font(.system(size: 12.5))
          .padding(.horizontal, 8)
          .frame(height: 26)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .help(pr.title)
        if pr.state == "CLOSED" { openButton }
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
      HStack(spacing: 5) {
        if opening { ProgressView().controlSize(.mini) } else { Image(systemName: "arrow.triangle.pull") }
        Text("Open PR")
      }
      .font(.system(size: 12.5))
      .padding(.horizontal, 8)
      .frame(height: 26)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .foregroundStyle(.secondary)
    .disabled(opening)
    .help(ReplyComposerModel.openPRPrompt)
  }

  private func load() async {
    do {
      pr = .some(try await model.client.pullRequest(forThread: thread.id))
    } catch {
      if pr == nil { pr = .some(nil) }
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
        text: $reply.text, placeholder: SendRules.placeholder(busy: busyThread), running: busyThread,
        interrupting: store.interrupting, focusTick: focusTick, callbacks: callbacks, caretRequest: caret
      )
      .fixedSize(horizontal: false, vertical: false)
      if let e = reply.attachError {
        Text(e)
          .font(.system(size: 12))
          .foregroundStyle(ThreadStyle.bad)
          .padding(.horizontal, 16)
          .padding(.bottom, 4)
      }
      footer
      SlashHintView(model: menu) { newThreadOnAnotherModel() }
        .padding(.horizontal, 16)
        .padding(.bottom, menu.hint == nil ? 0 : 10)
        .padding(.top, menu.hint == nil ? 0 : 2)
    }
    .background(Color(nsColor: .textBackgroundColor).opacity(0.6), in: RoundedRectangle(cornerRadius: 24))
    .overlay {
      RoundedRectangle(cornerRadius: 24)
        .strokeBorder(Color.primary.opacity(over || focused ? 0.3 : 0.12), lineWidth: over ? 1.5 : 1)
    }
    .overlay {
      if over {
        RoundedRectangle(cornerRadius: 24)
          .fill(.background.opacity(0.85))
          .overlay { Label("Drop to attach", systemImage: "paperclip").font(.system(size: 13, weight: .medium)) }
          .allowsHitTesting(false)
      }
    }
    .dropDestination(for: URL.self) { urls, _ in
      stage(urls)
      return true
    } isTargeted: {
      over = $0
    }
    .slashMenu(menu)
  }

  private var footer: some View {
    HStack(spacing: 8) {
      Button {
        picking = true
      } label: {
        Image(systemName: "paperclip").frame(width: 28, height: 28).contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .foregroundStyle(.secondary)
      .disabled(reply.sending)
      .help("Attach files")
      .accessibilityLabel("Attach files")
      ThreadRunPills(thread: thread, harnesses: model.store.harnesses)
      if thread.branch != nil {
        ThreadPRSlot(model: model, thread: thread, busy: busyThread, opening: reply.openingPR) { Task { await openPR() } }
      }
      Spacer(minLength: 8)
      Text("↩")
        .font(.system(size: 11.5))
        .foregroundStyle(.tertiary)
        .accessibilityHidden(true)
      if let omni = menu.reply, omni.action != .send {
        SendButton(title: omni.label ?? "Send", armed: omni.armed, sending: omniBusy) { runOmni() }
      } else if busyThread {
        SteerButton(canSteer: canSteer, enabled: reply.canSend, sending: reply.sending) { send($0) }
      } else {
        SendButton(armed: reply.canSend, sending: reply.sending) { send(nil) }
      }
    }
    .padding(.horizontal, 8)
    .padding(.bottom, 8)
    .padding(.top, 2)
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
      edited: { menu.update(text: $0, caret: $1) })
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
      Image(systemName: symbol).font(.system(size: 11.5)).foregroundStyle(.secondary)
      Text(text).font(.system(size: 12.5, weight: .medium)).lineLimit(1)
      if let detail { Text("· \(detail)").font(.system(size: 12.5)).foregroundStyle(.tertiary).lineLimit(1) }
    }
    .padding(.horizontal, 10)
    .frame(height: 28)
    .frame(maxWidth: 220)
    .background(ThreadStyle.surface2, in: Capsule())
    .help("Fixed for this thread")
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label)
    .fixedSize()
  }
}

/// Send, quiet until there is something to send.
struct SendButton: View {
  var title = "Send"
  let armed: Bool
  let sending: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        if sending { ProgressView().controlSize(.mini) } else { Image(systemName: "paperplane.fill").font(.system(size: 11)) }
        Text(title).font(.system(size: 13, weight: .medium))
      }
      .padding(.leading, 12)
      .padding(.trailing, 14)
      .frame(height: 30)
      .foregroundStyle(armed ? Color(nsColor: .textBackgroundColor) : Color.secondary)
      .background(armed ? Color.primary : ThreadStyle.surface2, in: Capsule())
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .fixedSize()
    .layoutPriority(1)
    .disabled(!armed || sending)
    .animation(.easeOut(duration: 0.2), value: armed)
    .accessibilityLabel(title)
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
    let ink = Color(nsColor: .textBackgroundColor)
    HStack(spacing: 0) {
      Button {
        send(SendRules.primary(canSteer: canSteer))
      } label: {
        HStack(spacing: 6) {
          if sending {
            ProgressView().controlSize(.mini)
          } else {
            Image(systemName: canSteer ? "paperplane.fill" : "clock").font(.system(size: 11))
          }
          Text(SendRules.buttonTitle(canSteer: canSteer)).font(.system(size: 13, weight: .medium))
        }
        .padding(.leading, 12)
        .padding(.trailing, 9)
        .frame(height: 30)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      Rectangle().fill(ink.opacity(0.25)).frame(width: 1, height: 30)
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
        Image(systemName: "chevron.down")
          .font(.system(size: 10, weight: .semibold))
          .frame(width: 26, height: 30)
          .contentShape(Rectangle())
      }
      .menuStyle(.button)
      .buttonStyle(.plain)
      .menuIndicator(.hidden)
      .fixedSize()
      .help("More ways to send")
      .accessibilityLabel("More ways to send")
    }
    .foregroundStyle(ink)
    .background(Color.primary, in: Capsule())
    .clipShape(Capsule())
    .opacity(enabled ? 1 : 0.4)
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
              Text(f.name).font(.system(size: 12.5, weight: .medium)).lineLimit(1).truncationMode(.middle)
              Text(Format.bytes(f.size)).font(.system(size: 10.5)).foregroundStyle(.tertiary).monospacedDigit()
            }
            .frame(maxWidth: 170, alignment: .leading)
            Button {
              remove(f)
            } label: {
              Image(systemName: "xmark").font(.system(size: 9, weight: .semibold)).frame(width: 22, height: 22).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help("Remove \(f.name)")
            .accessibilityLabel("Remove \(f.name)")
          }
          .padding(.leading, 4)
          .padding(.trailing, 4)
          .frame(height: 44)
          .background(ThreadStyle.surface2, in: RoundedRectangle(cornerRadius: 16))
        }
      }
      .padding(.horizontal, 8)
    }
    .padding(.top, 8)
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
        Image(systemName: "doc").font(.system(size: 15)).foregroundStyle(.secondary)
      }
    }
    .frame(width: 36, height: 36)
    .background(ThreadStyle.surface, in: RoundedRectangle(cornerRadius: 10))
    .clipShape(RoundedRectangle(cornerRadius: 10))
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
