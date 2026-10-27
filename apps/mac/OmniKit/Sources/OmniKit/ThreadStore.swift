import Foundation
import Observation

/// One thread, kept current from its stream with the Web UI's rules (apps/web/src/pages/Thread.tsx):
/// - `start()` loads the thread with its newest page of events, then streams its events from the last one loaded.
///   Older pages load on demand (`loadEarlier`, `loadLater`, `reveal`) into `history`.
/// - Each event is kept once, in id order, however the stream sends it.
/// - A thread row replaces the one shown unless it is older. `pending` and `warm` come and go with it.
/// - Every stream connect ends its catch-up with a `sync` (#224): the thread's state now, after the rows it
///   replayed. When the gap was too big to replay, the sync carries the newest page instead: the head held
///   becomes an island and the fresh head joins under it, so older pages stay reachable.
/// - Stream messages are applied in batches, one per `frame`, in the order they came.
///
/// Children and the parent change on the feed, not the thread's stream: pass feed events to `apply(feed:)`.
@MainActor @Observable
public final class ThreadStore {
  public enum LoadState: Hashable, Sendable {
    /// The first load has not come back yet.
    case loading
    case loaded
    /// The server has no such thread.
    case notFound
    /// The first load failed. `reload()` tries again.
    case failed(OmniAPIError)
  }

  public nonisolated let id: String
  public private(set) var thread: OmniThread?
  public private(set) var channel: Channel?
  public private(set) var parent: OmniThread?
  public private(set) var children: [OmniThread] = []
  /// Members of the teams among `children`.
  public private(set) var team: [OmniThread] = []
  /// The pages of the thread held so far, and the rows they carry.
  public private(set) var history = History()
  /// Every row held, in id order, each once: the spans' rows and the anchors around them.
  public var events: [EventRow] { history.rows }
  public private(set) var transcript = Transcript()
  /// Rows a page cut down to size, by event id. `showAll` loads one whole.
  public private(set) var clipped: [Int: Clipped] = [:]
  /// The clipped result row of each call, by tool_use id.
  public private(set) var clippedResults: [String: Int] = [:]
  /// Edges of the transcript with a page on the way. One at a time each.
  public private(set) var loadingEdges: Set<HistoryEdge> = []
  /// The last page asked for at an edge failed.
  public private(set) var edgeErrors: [HistoryEdge: OmniAPIError] = [:]
  /// Clipped rows being loaded whole, and the ones that failed.
  public private(set) var showingAll: Set<Int> = []
  public private(set) var showAllErrors: [Int: OmniAPIError] = [:]
  /// The row a reveal brought in, for the screen to scroll to once. `revealShown()` clears it.
  public private(set) var revealTarget: TranscriptItemID?
  /// Counts the layouts of rows that were not only new at the tail (a page, a whole row, a reconnect): rows above the
  /// one Ben reads may have changed, so the screen puts that row back where it was.
  public private(set) var pagesLaidOut = 0
  public private(set) var artifacts: [Artifact] = []
  /// Messages Ben sent that the agent has not read yet. Every new list is checked against the open edits.
  public private(set) var pending: [PendingMsg] = [] {
    didSet { if pending != oldValue { edits.reconcile(pending) } }
  }
  /// Open edits of unsent messages, and the actions on them.
  public let edits: PendingEditsModel
  /// Records waiting in the reply box, which the Changes tab adds to.
  public let draftContext: DraftContextModel
  /// A CLI process is attached, so the next message starts at once. nil until the server says.
  public private(set) var warm: Bool?
  public private(set) var loadState = LoadState.loading
  public private(set) var connection = ConnectionState.connecting
  /// An interrupt was asked for and the turn has not ended yet.
  public private(set) var stopping = false
  /// The last interrupt, handoff or cancel of one failed.
  public private(set) var actionError: OmniAPIError?
  /// Why a turn cannot start here, from the server. Nil when one can.
  public private(set) var blocked: String?
  /// A handoff of the thread to or from another Mac, kept current by its stream.
  public private(set) var handoff: HandoffView?
  /// A handoff or its cancel was asked for and the server has not answered yet.
  public private(set) var handingOff = false
  /// The thread this one continues on another harness, and the threads that continue it. Kept current by the feed.
  public private(set) var continuedFrom: ContinueLink?
  public private(set) var continuedIn: [ContinueLink] = []
  /// The newest HTML artifact the stream brought that was not there before, for the viewer to show.
  public private(set) var arrivedHTML: Artifact?
  /// See `StatusLine.label`.
  public private(set) var statusLabel: String?
  /// Mod toasts showing now, oldest first, each until its timeout or `dismissToast`. At most `maxToasts`.
  public private(set) var toasts: [ShownToast] = []
  /// See `StatusLine.betweenTurns`.
  public private(set) var betweenTurns = true
  /// The newest context reading the stream pushed, for the header's meter. nil until one comes.
  public private(set) var context: ContextUsage?
  /// The last result event's id, 0 for none.
  public private(set) var lastResultID = 0
  private var sessionCwd: String?

  /// The folder the latest session started in, else the thread's. Paths in the transcript are shown from it.
  public var cwd: String? { sessionCwd.flatMap { $0.isEmpty ? nil : $0 } ?? thread?.cwd }
  /// Running or waiting for a slot.
  public var running: Bool { thread?.status.isActive ?? false }
  /// Nothing blocks it here and nothing is moving it yet, so it can be handed to another: mid-turn, or between turns.
  public var canHandOff: Bool { thread != nil && blocked == nil && !(handoff?.inFlight ?? false) && !handingOff }
  public var interrupting: Bool { stopping || pending.contains { $0.state == .sent && $0.mode == .interrupt } }
  /// The stream dropped and is not back yet.
  public var isReconnecting: Bool {
    guard loadState == .loaded, case .reconnecting = connection else { return false }
    return true
  }
  /// The line under the transcript while the agent works: the latest status, else "Working" when nothing
  /// has come back since the last message. A queued thread is not working yet.
  public var workingLine: String? {
    guard thread?.status == .running, !transcript.waitsOnQuestion, transcript.showsWorking(running: true) || statusLabel != nil else { return nil }
    return statusLabel ?? "Working"
  }
  public var files: [Artifact] { artifacts.filter { $0.kind != "screenshot" } }
  public var screenshots: [Artifact] { artifacts.filter { $0.kind == "screenshot" } }

  /// The artifact to show when the thread opens: the newest HTML page, else the newest file.
  public static func defaultArtifact(_ artifacts: [Artifact]) -> Artifact? {
    let visible = artifacts.filter { $0.kind != "screenshot" }
    return visible.last { $0.kind == "html" } ?? visible.last
  }

  static let stopTimeout = Duration.seconds(15)
  public static let maxToasts = 3

  /// A mod toast on screen.
  public struct ShownToast: Identifiable, Hashable, Sendable {
    public let id: Int
    public let toast: ModToast
  }

  @ObservationIgnored private let api: any ThreadAPI
  @ObservationIgnored private let ticker: Ticker
  @ObservationIgnored private let frame: Duration
  @ObservationIgnored private let makeStream: @Sendable (_ after: Int) -> SSEClient<ThreadStreamMessage>
  @ObservationIgnored private var stream: SSEClient<ThreadStreamMessage>?
  @ObservationIgnored private var streamTask: Task<Void, Never>?
  @ObservationIgnored private var flushTask: Task<Void, Never>?
  @ObservationIgnored private var stopTimer: Task<Void, Never>?
  @ObservationIgnored private var inbox: [ThreadStreamMessage] = []
  @ObservationIgnored private var toastSeq = 0
  @ObservationIgnored private var artifactIDs: Set<Int> = []
  @ObservationIgnored private var started = false
  @ObservationIgnored private var ended = false
  /// The latest load. An answer to an older one is dropped.
  @ObservationIgnored private var loadToken = 0
  /// Layouts asked for, and the one `transcript` is. A layout that lands after a newer one was asked for is dropped.
  @ObservationIgnored private var layoutSeq = 0
  @ObservationIgnored private var laidSeq = 0
  @ObservationIgnored private var layoutTask: Task<Void, Never>?
  /// A row changed in place while a layout was out, so it must lay out again when it lands.
  @ObservationIgnored private var stale = false
  /// The event a reveal waits to show: until the first load, then until the page holding it is laid out.
  @ObservationIgnored private var revealing: Int?

  /// - Parameters:
  ///   - frame: how long stream messages gather before they are applied together.
  ///   - stream: opens the thread's stream from the event id given.
  public init(
    id: String, api: any ThreadAPI, clock: any Clock<Duration> = ContinuousClock(), frame: Duration = .milliseconds(16),
    drafts: DraftStore = .standard, stream: @escaping @Sendable (_ after: Int) -> SSEClient<ThreadStreamMessage>
  ) {
    self.id = id
    self.api = api
    self.edits = PendingEditsModel(threadID: id)
    self.draftContext = DraftContextModel(threadID: id, drafts: drafts)
    self.ticker = Ticker(clock)
    self.frame = frame
    self.makeStream = stream
  }

  public convenience init(
    id: String, client: OmniClient, transport: any SSETransport = URLSessionSSETransport.shared,
    clock: any Clock<Duration> = ContinuousClock()
  ) {
    self.init(id: id, api: client, clock: clock) { after in
      client.threadEvents(id, after: after, transport: transport, clock: clock)
    }
  }

  isolated deinit {
    stream?.close()
    flushTask?.cancel()
    stopTimer?.cancel()
    layoutTask?.cancel()
  }

  public func start() {
    guard !started else { return }
    started = true
    Task { await load() }
  }

  public func stop() {
    ended = true
    loadToken += 1
    stream?.close()
    streamTask?.cancel()
    flushTask?.cancel()
    stopTimer?.cancel()
    stream = nil
    streamTask = nil
    flushTask = nil
    stopTimer = nil
    inbox = []
    connection = .closed
  }

  /// Tries the first load again after it failed. Once loaded, the stream's sync keeps the thread current.
  public func reload() async {
    await load()
  }

  /// See `SSEClient.reconnectNow(ifQuietFor:)`.
  public func reconnectNow(ifQuietFor quiet: Duration? = nil) {
    stream?.reconnectNow(ifQuietFor: quiet)
  }

  /// Shows `t` unless the thread shown is newer. An answer to Ben's own request also loses a tie, since
  /// the stream may already have sent what came after it. Returns whether `t` is shown.
  @discardableResult
  public func merge(_ t: OmniThread, isReply: Bool = false) -> Bool {
    merge(t, pending: nil, live: nil, isReply: isReply)
  }

  /// What a resume, discard, cancel or reorder of unsent messages answered: the thread, and its pending list
  /// before the stream brings it.
  public func apply(recovery a: RecoveryAnswer) {
    guard a.thread.id == id else { return }
    merge(a.thread, pending: nil, live: nil, isReply: false)
    pending = a.pending
  }

  /// What a saved edit answered, as `apply(recovery:)`.
  public func apply(edit a: EditAnswer) {
    apply(recovery: RecoveryAnswer(thread: a.thread, pending: a.pending))
  }

  /// Keeps children, their team members, the parent and the continuation links current.
  public func apply(feed: FeedEvent) {
    guard case .thread(let t) = feed else { return }
    if t.parentID == id { Self.upsert(t, into: &children) }
    if t.source == .team, children.contains(where: { $0.id == t.parentID }) { Self.upsert(t, into: &team) }
    if let parent, parent.id == t.id { self.parent = t }
    if t.continuedFrom == id { ContinueLink.upsert(t, into: &continuedIn) }
    if let from = continuedFrom, from.id == t.id { continuedFrom = ContinueLink(t, carried: from.carried) }
  }

  private static func upsert(_ t: OmniThread, into list: inout [OmniThread]) {
    if let i = list.firstIndex(where: { $0.id == t.id }) {
      list[i] = t
    } else {
      list.append(t)
    }
  }

  /// Asks the server to stop the turn. `stopping` stays up until the turn ends, a new result comes, or
  /// 15s pass.
  public func interrupt() async {
    setStopping(true)
    actionError = nil
    do {
      _ = try await api.stopThread(id)
    } catch {
      actionError = error
      setStopping(false)
    }
  }

  /// Hands the thread to the Mac `device`. The banner follows the stream from the answer on.
  public func handOff(to device: String) async {
    await handoffCall { api, id throws(OmniAPIError) in try await api.handOff(id, to: device) }
  }

  /// Calls off a handoff this Mac started, while the other Mac has not taken it.
  public func cancelHandoff() async {
    await handoffCall { api, id throws(OmniAPIError) in try await api.cancelHandoff(id) }
  }

  private func handoffCall(_ call: (any ThreadAPI, String) async throws(OmniAPIError) -> HandoffAnswer) async {
    guard !handingOff else { return }
    handingOff = true
    actionError = nil
    defer { handingOff = false }
    do throws(OmniAPIError) {
      let a = try await call(api, id)
      merge(a.thread, isReply: true)
      handoff = a.handoff
    } catch {
      actionError = error
    }
  }

  // MARK: Loading

  private var isLoaded: Bool { loadState == .loaded }

  private func load() async {
    guard !ended, !isLoaded else { return }
    loadToken += 1
    let token = loadToken
    let answer: Result<ThreadDetail, OmniAPIError>
    do {
      answer = .success(try await api.threadOpen(id))
    } catch {
      answer = .failure(error)
    }
    guard token == loadToken else { return }

    switch answer {
    case .failure(.http(status: 404, _)):
      loadState = .notFound
    case .failure(let e):
      loadState = .failed(e)
    case .success(let d):
      // A server without bounded history sends every row.
      let h = History(open: d.events, head: d.history ?? .whole)
      let laidOut = await Self.layout(h.rows, h.spans)
      guard token == loadToken else { return }
      take(d)
      history = h
      layoutSeq += 1
      laidSeq = layoutSeq
      transcript = laidOut
      clippedChanged()
      eventsChanged()
      loadState = .loaded
      openStream()
      if let at = revealing { await reveal(at) }
    }
  }

  private nonisolated static func layout(_ rows: [EventRow], _ spans: [HistorySpan]) async -> Transcript {
    Transcript(rows, spans: spans)
  }

  private func take(_ d: ThreadDetail) {
    merge(d.thread, pending: d.pending, live: d.live, isReply: false)
    blocked = d.blocked
    handoff = d.handoff
    channel = d.channel
    parent = d.parent
    continuedFrom = d.continuedFrom
    continuedIn = d.continuedIn
    children = d.children
    team = d.team
    artifacts = d.artifacts
    artifactIDs.formUnion(d.artifacts.map(\.id))
  }

  @discardableResult
  private func merge(_ t: OmniThread, pending p: [PendingMsg]?, live: Bool?, isReply: Bool) -> Bool {
    guard t.id == id else { return false }
    if let prev = thread, prev.updatedAt > t.updatedAt || (isReply && prev.updatedAt == t.updatedAt) { return false }
    let wasRunning = running
    thread = t
    if let p { pending = p }
    if let live { warm = live }
    if wasRunning && !running { setStopping(false) }
    return true
  }

  // MARK: History

  /// Loads the page above span `span` (the first by default): "Earlier messages", or a gap's "Show earlier".
  public func loadEarlier(_ span: Int = 0) async {
    guard let cursor = history.earlier(span) else { return }
    await loadPage(cursor, at: span == 0 ? .earlier : .gap(after: span - 1))
  }

  /// Loads the page under span `span + 1`, filling the gap up from span `span`: a gap's "Show later".
  public func loadLater(after span: Int) async {
    guard let cursor = history.later(span) else { return }
    await loadPage(cursor, at: .gap(after: span))
  }

  /// Brings event `eventID` (a search hit) into the transcript, loading the page that holds it, then points
  /// `revealTarget` at its row. Before the first load it waits for it.
  public func reveal(_ eventID: Int) async {
    revealing = eventID
    guard isLoaded else { return }
    if let cursor = history.reveal(eventID), !(await loadPage(cursor, at: nil)) {
      if revealing == eventID { revealing = nil }
      return
    }
    settleReveal()
  }

  public func revealShown() {
    revealTarget = nil
  }

  /// Loads a clipped row whole and shows it in place of its copy.
  public func showAll(_ eventID: Int) async {
    guard isLoaded, clipped[eventID] != nil, !showingAll.contains(eventID) else { return }
    showingAll.insert(eventID)
    showAllErrors[eventID] = nil
    defer { showingAll.remove(eventID) }
    do {
      let row = try await api.threadEvent(id, eventID: eventID)
      guard !ended, history.replace(row) else { return }
      clippedChanged()
      historyChanged(force: true)
      await layingOut()
    } catch {
      if error != .cancelled { showAllErrors[eventID] = error }
    }
  }

  /// Loads one page into `history`. `edge`: the control that asked, which shows it loading or failed.
  /// Returns once the page is laid out.
  @discardableResult
  private func loadPage(_ cursor: HistoryCursor, at edge: HistoryEdge?) async -> Bool {
    guard isLoaded, !ended else { return false }
    if let edge {
      guard !loadingEdges.contains(edge) else { return false }
      loadingEdges.insert(edge)
      edgeErrors[edge] = nil
    }
    defer { if let edge { loadingEdges.remove(edge) } }
    do {
      let page = try await api.threadHistory(id, cursor)
      guard !ended else { return false }
      history.apply(page)
      clippedChanged()
      historyChanged()
      await layingOut()
      return true
    } catch {
      if let edge, error != .cancelled { edgeErrors[edge] = error }
      return false
    }
  }

  /// After `history` changed: the transcript follows, in place when only the tail grew, else laid out again off the
  /// main actor, as the first load does.
  private func historyChanged(force: Bool = false) {
    eventsChanged()
    guard laidSeq == layoutSeq else {
      if force { stale = true }
      return
    }
    if !force && transcript.extends(history.rows, spans: history.spans) {
      transcript.update(history.rows, spans: history.spans)
      settleReveal()
    } else {
      relayout()
    }
  }

  private func relayout() {
    layoutSeq += 1
    let seq = layoutSeq
    let (rows, spans) = (history.rows, history.spans)
    layoutTask = Task {
      let laidOut = await Self.layout(rows, spans)
      guard seq == layoutSeq, !ended else { return }
      laidSeq = seq
      transcript = laidOut
      pagesLaidOut += 1
      // Rows that came while it was out: the tail, else everything again.
      if !stale && laidOut.extends(history.rows, spans: history.spans) {
        transcript.update(history.rows, spans: history.spans)
        settleReveal()
      } else {
        stale = false
        relayout()
      }
    }
  }

  /// Waits for the layouts asked for so far.
  private func layingOut() async {
    while laidSeq != layoutSeq, !ended, let task = layoutTask { await task.value }
  }

  private func settleReveal() {
    guard let at = revealing, laidSeq == layoutSeq, history.spanIndex(at) != nil else { return }
    revealing = nil
    revealTarget = transcript.itemID(holding: at)
  }

  private func clippedChanged() {
    var rows: [Int: Clipped] = [:]
    var results: [String: Int] = [:]
    for r in history.rows {
      guard let c = r.clipped else { continue }
      rows[r.id] = c
      if case .toolResult(let t) = r.content { results[t.toolUseID] = r.id }
    }
    if clipped != rows { clipped = rows }
    if clippedResults != results { clippedResults = results }
  }

  // MARK: Stream

  private func openStream() {
    guard stream == nil, !ended else { return }
    let s = makeStream(history.tailID)
    stream = s
    streamTask = Task { [weak self, events = s.events] in
      for await e in events {
        guard let self, !Task.isCancelled else { return }
        self.handle(e)
      }
    }
    s.start()
  }

  private func handle(_ e: SSEEvent<ThreadStreamMessage>) {
    switch e {
    case .message(let m):
      inbox.append(m)
      if frame <= .zero {
        flush()
      } else if flushTask == nil {
        let deadline = ticker.now() + frame
        flushTask = Task { [weak self, ticker] in
          do {
            try await ticker.sleep(deadline)
          } catch {
            return
          }
          guard let self, !Task.isCancelled else { return }
          self.flush()
        }
      }
    case .state(let s):
      flush()
      connection = s
    }
  }

  private func flush() {
    flushTask?.cancel()
    flushTask = nil
    guard !inbox.isEmpty else { return }
    let batch = inbox
    inbox = []
    var rows: [EventRow] = []
    for m in batch {
      switch m {
      case .event(let e): rows.append(e)
      case .artifact(let a): upsert(a)
      case .thread(let t, let p, let live, let blocked, let handoff):
        if merge(t, pending: p, live: live, isReply: false) {
          self.blocked = blocked
          self.handoff = handoff
        }
      case .modToast(let t): show(t)
      case .context(let c): context = c
      case .sync(let d, let snapshot):
        add(rows)
        rows = []
        sync(d, snapshot: snapshot)
      case .unknown: break
      }
    }
    add(rows)
  }

  /// The thread's state as the stream connected. A snapshot's page becomes the head, and the head held closes into
  /// an island.
  private func sync(_ d: ThreadDetail, snapshot: Bool) {
    take(d)
    guard snapshot, let head = d.history else { return }
    history.detachHead()
    history.apply(head: d.events, head)
    clippedChanged()
    historyChanged()
  }

  private func show(_ t: ModToast) {
    toastSeq += 1
    let id = toastSeq
    toasts = Array((toasts + [ShownToast(id: id, toast: t)]).suffix(Self.maxToasts))
    let deadline = ticker.now() + t.shownFor
    Task { [weak self, ticker] in
      try? await ticker.sleep(deadline)
      self?.dismissToast(id)
    }
  }

  public func dismissToast(_ id: Int) {
    toasts.removeAll { $0.id == id }
  }

  private func upsert(_ a: Artifact) {
    let isNew = artifactIDs.insert(a.id).inserted
    if let i = artifacts.firstIndex(where: { $0.id == a.id }) {
      artifacts[i] = a
    } else {
      artifacts.append(a)
    }
    if isNew && a.kind == "html" { arrivedHTML = a }
  }

  private func add(_ rows: [EventRow]) {
    guard history.append(live: rows) else { return }
    if rows.contains(where: { $0.clipped != nil }) { clippedChanged() }
    historyChanged()
  }

  private func eventsChanged() {
    let label = StatusLine.label(events)
    if statusLabel != label { statusLabel = label }
    let between = StatusLine.betweenTurns(events)
    if betweenTurns != between { betweenTurns = between }
    let started = events.last { $0.kind == "init" }.flatMap { if case .sessionInit(let s) = $0.content { s.cwd } else { nil } }
    if sessionCwd != started { sessionCwd = started }
    let result = events.last { $0.kind == "result" }?.id ?? 0
    if result != lastResultID {
      lastResultID = result
      setStopping(false)
    }
  }

  // MARK: Interrupting

  private func setStopping(_ on: Bool) {
    guard on != stopping else { return }
    stopping = on
    stopTimer?.cancel()
    stopTimer = nil
    guard on else { return }
    let deadline = ticker.now() + Self.stopTimeout
    stopTimer = Task { [weak self, ticker] in
      do {
        try await ticker.sleep(deadline)
      } catch {
        return
      }
      guard let self, !Task.isCancelled else { return }
      self.stopTimer = nil
      self.stopping = false
    }
  }
}

/// One `ThreadStore` per open thread, shared by every view that shows it and stopped when the last one
/// lets it go.
@MainActor @Observable
public final class ThreadStoreRegistry {
  @ObservationIgnored private let make: (String) -> ThreadStore
  private var stores: [String: (store: ThreadStore, holds: Int)] = [:]
  /// Reveals asked for threads with no store yet, handed over on `acquire`.
  @ObservationIgnored private var reveals: [String: Int] = [:]

  public init(make: @escaping (String) -> ThreadStore) {
    self.make = make
  }

  public convenience init(client: OmniClient, transport: any SSETransport = URLSessionSSETransport.shared) {
    self.init { id in ThreadStore(id: id, client: client, transport: transport) }
  }

  /// The thread's store, started. Pair each call with a `release`.
  public func acquire(_ id: String) -> ThreadStore {
    if let held = stores[id] {
      stores[id] = (held.store, held.holds + 1)
      return held.store
    }
    let store = make(id)
    stores[id] = (store, 1)
    store.start()
    if let at = reveals.removeValue(forKey: id) { Task { await store.reveal(at) } }
    return store
  }

  /// Opens the thread on event `eventID` (a search hit): its store loads the page holding it and scrolls there. A
  /// thread not open yet takes it when it is.
  public func reveal(_ id: String, at eventID: Int) {
    if let store = stores[id]?.store {
      Task { await store.reveal(eventID) }
    } else {
      reveals[id] = eventID
    }
  }

  public func release(_ id: String) {
    guard let held = stores[id] else { return }
    if held.holds > 1 {
      stores[id] = (held.store, held.holds - 1)
    } else {
      stores[id] = nil
      held.store.stop()
    }
  }

  public func store(_ id: String) -> ThreadStore? { stores[id]?.store }

  public func apply(feed: FeedEvent) {
    for (store, _) in stores.values { store.apply(feed: feed) }
  }

  /// Retries every open thread's stream now (wake, foreground, network change).
  public func reconnectNow(ifQuietFor quiet: Duration? = nil) {
    for (store, _) in stores.values { store.reconnectNow(ifQuietFor: quiet) }
  }

  /// Stops every store and forgets them, for a registry that is being replaced.
  public func stopAll() {
    let all = stores.values.map(\.store)
    stores = [:]
    reveals = [:]
    for store in all { store.stop() }
  }
}
