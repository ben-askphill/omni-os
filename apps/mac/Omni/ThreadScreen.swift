import OmniKit
import SwiftUI

/// The `#/t/<id>` screen. It holds the thread's store while it shows, so the stream stays open only as long
/// as something shows the thread.
struct ThreadScreen: View {
  let model: AppModel
  let id: String
  @State private var store: ThreadStore?

  private struct Hold: Hashable {
    let registry: ObjectIdentifier
    let id: String
  }

  var body: some View {
    Group {
      if let store, store.id == id {
        ThreadView(model: model, store: store)
          .id(ObjectIdentifier(store))
          .environment(\.omniClient, model.client)
      } else {
        Color.clear
      }
    }
    .task(id: Hold(registry: ObjectIdentifier(model.threads), id: id)) {
      let registry = model.threads
      let id = self.id
      #if DEBUG
      QAProbe.shownThread = nil
      #endif
      store = registry.acquire(id)
      while !Task.isCancelled { try? await Task.sleep(for: .seconds(86_400)) }
      registry.release(id)
    }
  }
}

private struct ThreadView: View {
  let model: AppModel
  let store: ThreadStore
  @State private var ui = TranscriptUI()
  @State private var markdown = MarkdownCache<Int>()

  var body: some View {
    switch store.loadState {
    case .notFound:
      EmptyNote(symbol: "message", title: "Thread not found", message: "It may have been deleted, or the link is wrong.") {
        Button("Go home") { model.route = .home }
          .buttonStyle(.pill(.secondary))
      }
      .frame(maxHeight: .infinity)
    case .failed(let error):
      VStack {
        ErrorNote(text: error.message) { Task { await store.reload() } }
        Spacer()
      }
      .padding(z(24))
    case .loading:
      HStack(spacing: z(8)) {
        Loader(size: 14)
        Text("Loading thread")
      }
      .font(.omni(size: 13))
      .foregroundStyle(Tok.fg3)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    case .loaded:
      if let thread = store.thread {
        VStack(spacing: 0) {
          ThreadHeader(model: model, store: store, thread: thread)
          TranscriptView(model: model, store: store, ui: ui, markdown: markdown)
            .overlay(alignment: .topTrailing) { ModToastStack(store: store) }
          ReplyComposerHost(model: model, store: store, thread: thread)
        }
        .readsShownResult(model: model, threadID: thread.id, status: thread.status)
        #if DEBUG
        .onAppear {
          QAProbe.expand = {
            ui.expandAll(store.transcript.items) {
              store.clipped[$0.id] != nil || store.clippedResults[$0.callID] != nil || $0.result?.output != nil || $0.isPending
            }
          }
          QAProbe.editPending = { text in
            guard let m = store.pending.first(where: \.isEditable) else { return false }
            store.edits.open(m)
            store.edits.update(m.uuid) { $0.prompt = text }
            return true
          }
        }
        .onDisappear {
          QAProbe.expand = nil
          QAProbe.editPending = nil
        }
        #endif
        .threadInspector(model: model, store: store)
      }
    }
  }
}

/// Channel, parent and task over the title, then the context meter, Done, the status and the ⋯ menu, as the header in
/// Thread.tsx. The inspector's toggle is in the toolbar.
private struct ThreadHeader: View {
  let model: AppModel
  let store: ThreadStore
  let thread: OmniThread
  @State private var restoring = false

  var body: some View {
    let channel = store.channel?.name ?? thread.channelID
    HStack(spacing: z(12)) {
      ChannelAvatar(name: channel, conductor: thread.channelID == SidebarSections.conductorID, icon: store.channel?.icon)
      VStack(alignment: .leading, spacing: z(4)) {
        HStack(spacing: z(4)) {
          Button("#\(channel)") { model.route = .channel(id: thread.channelID) }
            .buttonStyle(.plain)
            .fixedSize()
          if let parent = store.parent {
            OmniIcon(name: "chevronRight", size: 10)
              .foregroundStyle(Tok.fg4)
            Button(parent.title) { model.route = .thread(id: parent.id) }
              .buttonStyle(.plain)
              .lineLimit(1)
              .truncationMode(.tail)
              .help("Delegated from \(parent.title)")
          }
          if let task = thread.taskID, !task.isEmpty {
            Text(task)
              .font(.omni(size: 10.5))
              .monospacedDigit()
              .foregroundStyle(Tok.fg4)
              .padding(.leading, z(4))
              .fixedSize()
          }
        }
        .font(.omni(size: 12))
        .foregroundStyle(Tok.fg3)
        Text(thread.title)
          .font(.omni(size: 17, weight: .medium))
          .foregroundStyle(Tok.fg)
          .lineLimit(1)
          .truncationMode(.tail)
          .help(thread.title)
          .textSelection(.enabled)
        ModStatusLines(mods: model.store.mods.filter { $0.threadID == thread.id })
        ContinueLinks(model: model, from: store.continuedFrom, continuedIn: store.continuedIn)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      // Packed tighter than the title, so the actions read as one cluster.
      HStack(spacing: z(4)) {
        if store.isReconnecting {
          HStack(spacing: z(6)) {
            GlyphView(glyph: .running, size: 6)
            Text("Reconnecting")
          }
          .font(.omni(size: 11))
          .foregroundStyle(Tok.fg3)
          .help("Reconnecting to the live stream")
          .accessibilityElement(children: .combine)
        }
        if ContextMeter.metered.contains(thread.harness) {
          ContextMeterButton(model: model, store: store, thread: thread)
        }
        if !thread.archived, ThreadStub(thread).canMarkDone {
          let done = thread.doneAt != nil
          Button {
            Task { await model.setThreadDone(thread.id, !done) }
          } label: {
            OmniIcon(name: "check", size: 15)
          }
          .buttonStyle(.icon(size: 28, active: done))
          .help(done ? "Marked done. Click to bring it back to Needs you." : "Mark as done: out of Needs you until something new happens here")
          .accessibilityLabel(done ? "Mark as not done" : "Mark as done")
          .accessibilityAddTraits(done ? .isSelected : [])
        }
        if thread.archived {
          // Opened from its channel's Archived list or a search: put it back in the lists.
          Button {
            Task {
              restoring = true
              await model.setThreadArchived(thread.id, false)
              restoring = false
            }
          } label: {
            HStack(spacing: z(6)) {
              if restoring { Loader(size: 12) } else { OmniIcon(name: "archive", size: 14) }
              Text("Restore")
            }
          }
          .buttonStyle(.pill(.secondary, height: 28))
          .disabled(restoring)
          .help("Archived. Restore it to its channel's thread list.")
        }
        if store.transcript.hasPendingQuestion {
          StatusPill(glyph: .needs, label: QuestionState.pending.label)
        } else {
          StatusPill(status: thread.status)
        }
        ThreadOverflowMenu(model: model, store: store, thread: thread)
      }
    }
    .padding(.horizontal, z(24))
    .padding(.top, z(12))
    .padding(.bottom, z(8))
  }
}

/// The thread header's ⋯: the thread's actions from packages/shared/thread-actions.ts, as the right-click lists them, so
/// pin, rename, move, archive, fork, reference, hand off and Send to Grok Bot are two clicks away at any window width.
private struct ThreadOverflowMenu: View {
  let model: AppModel
  let store: ThreadStore
  let thread: OmniThread
  @State private var prompts = ThreadActionPrompts()

  var body: some View {
    Menu {
      ThreadActionItems(model: model, threadID: thread.id, title: thread.title, stub: ThreadStub(thread), archived: thread.archived, prompts: prompts)
    } label: {
      OmniIcon(name: "more", size: 15)
    }
    .menuStyle(.button)
    .buttonStyle(.icon(size: 28))
    .menuIndicator(.hidden)
    .fixedSize()
    .help("Thread actions")
    .accessibilityLabel("Thread actions")
    .threadActionPrompts(prompts, model: model, threadID: thread.id, arrowEdge: .bottom)
    // Tailscale's view of the other Mac changes as it sleeps and wakes, so ask again while the thread could go: the
    // Machine chip lists a Mac only while one can take it.
    .task(id: store.canHandOff) {
      guard store.canHandOff else { return }
      while !Task.isCancelled {
        await model.devices.refresh()
        try? await Task.sleep(for: .seconds(30))
      }
    }
    #if DEBUG
    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { QAHandoffProbe.button = $0 }
    .onChange(of: model.devices.targets(store) != nil, initial: true) { _, ready in
      QAHandoffProbe.handOff = ready ? { [store] in await store.handOff(to: $0) } : nil
    }
    .onAppear {
      let picker = ThreadReferencePicker(threadID: thread.id, channelID: thread.channelID, api: model.client, draft: store.draftContext)
      let prompts = prompts
      ThreadReferenceProbe.current = ThreadReferenceProbe(picker: picker) { open in
        prompts.referencing = open ? ReferencePick(picker: picker) : nil
      }
    }
    .onDisappear {
      QAHandoffProbe.button = nil
      QAHandoffProbe.handOff = nil
      ThreadReferenceProbe.current = nil
    }
    #endif
  }
}

/// The auto scroll's state. Only whether the pill shows is observed, so a scroll does not lay the rows out again.
@MainActor @Observable
private final class PinState {
  @ObservationIgnored private var pin = ScrollPin()
  @ObservationIgnored private(set) var geometry: ScrollPin.Geometry?
  private(set) var showsJump = false

  func eventsChanged(_ tail: Int) -> Bool {
    defer { sync() }
    return pin.eventsChanged(tail: tail)
  }

  func release(tail: Int) {
    pin.release(tail: tail)
    sync()
  }

  var isPinned: Bool { pin.isPinned }

  func geometryChanged(_ g: ScrollPin.Geometry) -> Bool {
    geometry = g
    defer { sync() }
    return pin.geometryChanged(g)
  }

  func jump() {
    pin.jump()
    sync()
  }

  private func sync() {
    if showsJump != pin.showsJump { showsJump = pin.showsJump }
  }
}

/// The rows in a lazy stack that follows the bottom while Ben is near it, with the New activity pill when he
/// is not, as the transcript in Thread.tsx.
private struct TranscriptView: View {
  let model: AppModel
  let store: ThreadStore
  let ui: TranscriptUI
  let markdown: MarkdownCache<Int>
  @State private var pin = PinState()
  @State private var position = ScrollPosition(edge: .bottom)

  var body: some View {
    ScrollView {
      TranscriptRows(model: model, store: store, ui: ui, markdown: markdown)
        .frame(maxWidth: ThreadStyle.thread)
        .padding(.horizontal, z(24))
        .padding(.top, z(16))
        .padding(.bottom, z(40))
        .frame(maxWidth: .infinity)
        .foregroundStyle(Tok.fg)
    }
    .scrollPosition($position)
    .defaultScrollAnchor(.bottom, for: .initialOffset)
    .onScrollGeometryChange(for: ScrollPin.Geometry.self) { g in
      ScrollPin.Geometry(
        offset: g.contentOffset.y, contentHeight: g.contentSize.height + g.contentInsets.bottom,
        viewportHeight: g.containerSize.height)
    } action: { _, g in
      if pin.geometryChanged(g) { position.scrollTo(edge: .bottom) }
      #if DEBUG
      QAProbe.laidOut(store, g)
      #endif
    }
    .onChange(of: store.history.tailID, initial: true) { _, tail in
      if pin.eventsChanged(tail) { position.scrollTo(edge: .bottom) }
    }
    // Keyed on the store, so a view reused for another thread hands that store the pin too.
    .onChange(of: ObjectIdentifier(store), initial: true) { store.follows = { [pin] in pin.isPinned } }
    .overlay(alignment: .bottom) {
      NewActivityPill(pin: pin) {
        pin.jump()
        withAnimation(.smooth(duration: 0.3)) { position.scrollTo(edge: .bottom) }
      }
    }
    .modifier(ThreadLinks(model: model))
    .environment(\.linkScope, LinkScope(store: model.links, channel: store.thread?.channelID))
    .environment(\.threadStore, store)
    .environment(\.toolOutputAPI, model.client)
    .holdsTopRow(
      store: store, position: $position, following: { pin.isPinned }, viewport: { pin.geometry?.viewportHeight },
      release: { pin.release(tail: store.history.tailID) })
    #if DEBUG
    .onAppear {
      QAProbe.scroller = scroller
      QAProbe.store = store
    }
    .onDisappear {
      QAProbe.scroller = nil
      QAProbe.store = nil
    }
    #endif
  }

  #if DEBUG
  private var scroller: QAProbe.Scroller {
    QAProbe.Scroller(
      toTop: { position.scrollTo(edge: .top) },
      toBottom: {
        pin.jump()
        position.scrollTo(edge: .bottom)
      },
      pageUp: {
        guard let g = pin.geometry, g.offset > 0.5 else { return false }
        position.scrollTo(y: max(0, g.offset - g.viewportHeight / 2))
        return true
      },
      distanceFromBottom: { pin.geometry?.distanceFromBottom },
      viewportHeight: { pin.geometry?.viewportHeight },
      toItem: { id in
        pin.release(tail: store.history.tailID)
        position.scrollTo(id: id, anchor: .center)
      })
  }
  #endif
}

private struct NewActivityPill: View {
  let pin: PinState
  let jump: () -> Void

  var body: some View {
    if pin.showsJump {
      Button(action: jump) {
        HStack(spacing: z(6)) {
          OmniIcon(name: "chevronDown", size: 13)
          Text("New activity")
        }
        .font(.omni(size: 12, weight: .medium))
        .foregroundStyle(Tok.fg)
        .padding(.horizontal, z(14))
        .frame(height: z(32))
        .background(Tok.elev, in: Capsule())
        .menuShadow(16)
        .contentShape(Capsule())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("New activity")
      .padding(.bottom, z(16))
      .transition(.scale(scale: 0.9).combined(with: .opacity))
    }
  }
}

private struct TranscriptRows: View {
  let model: AppModel
  let store: ThreadStore
  let ui: TranscriptUI
  let markdown: MarkdownCache<Int>

  var body: some View {
    // Queued means waiting for a slot: nothing is working yet.
    let running = store.thread?.status == .running
    let cwd = store.cwd
    let transcript = store.transcript
    let agents = Set(model.store.tasks.filter { $0.threadID == store.id }.compactMap(\.toolUseID))
    let known = Dictionary((store.children + store.team).map { ($0.id, $0) }, uniquingKeysWith: { _, b in b })
    let members = Delegation.team(of: store.children)
    let pages = PublishedPage.byGroup(transcript.items)
    let reports = PendingMsg.reportNotes(store.pending)
    let first = transcript.items.first?.id
    let live: TranscriptItemID? =
      if case .tools(let g)? = transcript.last, transcript.isLive(g, running: running) { .event(g.eventID) } else { nil }
    let edges = store.history.edges(transcript.items.compactMap { if case .event(let k) = $0.id { k } else { nil } })
    let atStart = store.history.atStart
    LazyVStack(alignment: .leading, spacing: z(16)) {
      // The brief is in a page not loaded yet: the members go above it.
      if !atStart, !members.isEmpty {
        DelegationCard(delegation: Delegation(id: "team", lead: nil, branches: members), team: true, model: model, reports: reports)
      }
      if let first, case .event(let k) = first, let edge = edges[k], edge == .earlier {
        HistoryEdgeRow(store: store, edge: edge)
      }
      ForEach(transcript.items) { item in
        // One view per item, so a scroll to its id lands on what its frame reports.
        VStack(alignment: .leading, spacing: z(16)) {
          if case .event(let k) = item.id, let edge = edges[k], edge != .earlier {
            HistoryEdgeRow(store: store, edge: edge)
          }
          TranscriptRow(
            item: item, live: item.id == live, running: running, cwd: cwd, threadID: store.id, model: model, ui: ui,
            markdown: markdown, agents: agents, known: known, pages: pages, artifacts: store.artifacts, reports: reports
          )
          .copyMenu { TranscriptMarkdown.copyText(item, cwd: cwd) }
          .clippedNote(item)
          // A team lead's members, under its brief.
          if item.id == first, atStart, case .user = item, !members.isEmpty {
            DelegationCard(delegation: Delegation(id: "team", lead: nil, branches: members), team: true, model: model, reports: reports)
          }
        }
        .tracksTopRow(item.id)
      }
      if let edge = edges[-1] {
        HistoryEdgeRow(store: store, edge: edge)
      }
      if let line = store.workingLine {
        WorkingLine(text: line)
      }
      if let t = store.thread, SetupCard.shows(t, model: model) {
        SetupCard(model: model, store: store, thread: t)
      }
      if let t = store.thread, t.resumeBlocked != nil {
        StaleSessionCard(model: model, store: store, thread: t)
      }
      if let t = store.thread, t.limit != nil {
        LimitCard(model: model, store: store, thread: t)
      }
      if let h = store.handoff {
        HandoffCard(store: store, handoff: h)
      }
      if store.pending.contains(where: { !$0.isParked }) {
        QueuedMessagesView(
          store: store, client: model.client, items: store.pending.filter { !$0.isParked }, starting: store.betweenTurns, setup: store.thread?.setup,
          canSteer: store.thread.map { t in SendRules.canSteer(harness: t.harness, capabilities: model.store.harnesses.first { $0.id == t.harness }?.capabilities) } ?? false)
      }
      SendingMessagesView(store: store, client: model.client)
      if store.pending.contains(where: \.isParked) {
        ParkedMessagesView(store: store, client: model.client, items: store.pending.filter(\.isParked), setup: store.thread?.setup, sessionBlocked: store.thread?.resumeBlocked != nil)
      }
      if !store.edits.stale.isEmpty {
        StaleEditsView(store: store, client: model.client)
      }
      if store.pending.isEmpty, let t = store.thread, t.status == .done, let title = t.nextTitle, let prompt = t.nextPrompt {
        NextThreadCard(model: model, store: store, thread: t, title: title, prompt: prompt)
      }
    }
    .scrollTargetLayout()
  }
}

private struct TranscriptRow: View {
  let item: TranscriptItem
  let live: Bool
  let running: Bool
  let cwd: String?
  let threadID: String
  let model: AppModel
  let ui: TranscriptUI
  let markdown: MarkdownCache<Int>
  var agents: Set<String> = []
  /// Threads this one started and their team members, for the delegation cards.
  var known: [String: OmniThread] = [:]
  /// Pages the thread published, by the tool group that shows each one's card.
  var pages: [Int: [PublishedPage]] = [:]
  var artifacts: [Artifact] = []
  /// Crew reports the thread has not read yet, by the thread that reported, for the delegation cards.
  var reports: [String: String] = [:]

  var body: some View {
    switch item {
    case .user(let id, let at, let message):
      CopyableMessage(text: message.text, alignment: .trailing) {
        UserBubbleView(eventID: id, at: at, message: message, threadID: threadID, client: model.client, ui: ui)
      }
    case .text(let id, _, let text):
      CopyableMessage(text: text) {
        MarkdownView(document: markdown.document(for: id, text: text))
      }
    case .tools(let group):
      let cards = Delegation.of(group.calls).map { d in
        Delegation(id: d.id, lead: d.lead?.live(known), branches: d.branches.map { $0.live(known) })
      }
      // Sub-agents and the delegations that worked show as cards; the group keeps every other call.
      let (subagents, rest, agentsFirst) = Delegation.split(group.calls)
      VStack(alignment: .leading, spacing: z(16)) {
        if agentsFirst { subagentCard(subagents) }
        if !rest.isEmpty {
          let kept = group.keeping(rest)
          ToolGroupView(group: kept, live: live && kept.hasPending, running: running, cwd: cwd, ui: ui, agents: agents)
        }
        if !agentsFirst { subagentCard(subagents) }
        ForEach(cards) { DelegationCard(delegation: $0, model: model, reports: reports) }
        ForEach(pages[group.eventID] ?? []) { page in
          PublishedCard(page: page, threadID: threadID, artifact: artifacts.last { $0.url == page.url }, model: model)
        }
      }
    case .plan(let plan):
      PlanCard(plan: plan, threadId: threadID, client: model.client)
    case .result(_, let result):
      ResultLineView(result: result)
    case .error(_, let text):
      ErrorCallout(text: text)
    case .report(let id, _, let report):
      ReportCard(report: report, document: markdown.document(for: id, text: report.text.isEmpty ? "(no reply)" : report.text), model: model)
    case .mod(_, let lines):
      ModLogView(lines: lines)
    case .cloud(_, let state):
      CloudAgentCard(state: state)
    case .runSwitch(let row):
      SwitchLineView(row: row, running: running)
    case .question(let q):
      QuestionCard(question: q, threadID: threadID, client: model.client, ui: ui)
    }
  }

  @ViewBuilder private func subagentCard(_ calls: [ToolCall]) -> some View {
    if !calls.isEmpty {
      DelegationCard(
        delegation: Delegation(id: "agents", lead: nil, branches: []), model: model,
        agents: AgentRows(calls: calls, live: agents, running: running, cwd: cwd, ui: ui))
    }
  }
}

#if DEBUG
/// What the QA runner reads off the thread screen: which transcript is laid out and since when, and a way to
/// scroll it.
@MainActor
enum QAProbe {
  struct Scroller {
    let toTop: () -> Void
    let toBottom: () -> Void
    /// Up by half a screen. false once at the top.
    let pageUp: () -> Bool
    /// How far the view is from the bottom of the transcript, once it is laid out.
    let distanceFromBottom: () -> Double?
    let viewportHeight: () -> Double?
    let toItem: (TranscriptItemID) -> Void
  }

  static var shownThread: String?
  /// The artifact image preview's zoom, while one shows.
  static weak var imageZoom: ImageZoom?
  static var shownAt: ContinuousClock.Instant?
  static var scroller: Scroller?
  static var expand: (() -> Void)?
  static var openMeter: (() -> Void)?
  /// Opens the new-thread composer's model list with this in its search.
  static var openModelPicker: ((String) -> Void)?
  /// Presses the sidebar's collapse-all (or expand-all) button.
  static var foldAll: (() -> Void)?
  /// Opens the edit of the first editable unsent message with this text. false when there is none.
  static var editPending: ((String) -> Bool)?
  /// Opens the Set secret form of the webhook automation with this id. false when the page shows none.
  static var openWebhookSecret: ((String) -> Bool)?

  static func laidOut(_ store: ThreadStore, _ g: ScrollPin.Geometry) {
    guard shownThread != store.id, store.loadState == .loaded, g.contentHeight > 0 else { return }
    shownThread = store.id
    shownAt = .now
  }
}
#endif
