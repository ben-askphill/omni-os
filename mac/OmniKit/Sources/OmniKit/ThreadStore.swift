import Foundation
import Observation

/// One thread, kept current from its stream with the Web UI's rules (web/src/pages/Thread.tsx):
/// - `start()` loads the thread, then streams its events from the last one loaded.
/// - Each event is kept once, in id order, however the stream sends it.
/// - A thread row replaces the one shown unless it is older. `pending` and `warm` come and go with it.
/// - Every stream open after the first loads the thread again and merges it in, since messages were
///   missed. Artifacts the stream sends while that load is out are laid over the answer, unless the
///   answer has a newer copy.
/// - Stream messages are applied in batches, one per `frame`.
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
  /// In id order, each once.
  public private(set) var events: [EventRow] = []
  public private(set) var transcript = Transcript()
  public private(set) var artifacts: [Artifact] = []
  /// Messages Ben sent that the agent has not read yet.
  public private(set) var pending: [PendingMsg] = []
  /// A CLI process is attached, so the next message starts at once. nil until the server says.
  public private(set) var warm: Bool?
  public private(set) var loadState = LoadState.loading
  /// The last load after the first failed. What loaded before stays.
  public private(set) var refreshError: OmniAPIError?
  public private(set) var connection = ConnectionState.connecting
  /// An interrupt was asked for and the turn has not ended yet.
  public private(set) var stopping = false
  /// The last interrupt failed.
  public private(set) var actionError: OmniAPIError?
  /// The newest HTML artifact the stream brought that was not there before, for the viewer to show.
  public private(set) var arrivedHTML: Artifact?
  /// See `StatusLine.label`.
  public private(set) var statusLabel: String?
  /// See `StatusLine.betweenTurns`.
  public private(set) var betweenTurns = true
  /// The last result event's id, 0 for none.
  public private(set) var lastResultID = 0
  private var sessionCwd: String?

  /// The folder the latest session started in, else the thread's. Paths in the transcript are shown from it.
  public var cwd: String? { sessionCwd.flatMap { $0.isEmpty ? nil : $0 } ?? thread?.cwd }
  /// Running or waiting for a slot.
  public var running: Bool { thread?.status.isActive ?? false }
  public var interrupting: Bool { stopping || pending.contains { $0.state == .sent && $0.mode == .interrupt } }
  /// The stream dropped and is not back yet.
  public var isReconnecting: Bool {
    guard loadState == .loaded, case .reconnecting = connection else { return false }
    return true
  }
  /// The line under the transcript while the agent works: the latest status, else "Working" when nothing
  /// has come back since the last message. A queued thread is not working yet.
  public var workingLine: String? {
    guard thread?.status == .running, transcript.showsWorking(running: true) || statusLabel != nil else { return nil }
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

  @ObservationIgnored private let api: any ThreadAPI
  @ObservationIgnored private let ticker: Ticker
  @ObservationIgnored private let frame: Duration
  @ObservationIgnored private let makeStream: @Sendable (_ after: Int) -> SSEClient<ThreadStreamMessage>
  @ObservationIgnored private var stream: SSEClient<ThreadStreamMessage>?
  @ObservationIgnored private var streamTask: Task<Void, Never>?
  @ObservationIgnored private var flushTask: Task<Void, Never>?
  @ObservationIgnored private var stopTimer: Task<Void, Never>?
  @ObservationIgnored private var inbox: [ThreadStreamMessage] = []
  @ObservationIgnored private var seen: Set<Int> = []
  @ObservationIgnored private var lastID = 0
  @ObservationIgnored private var artifactIDs: Set<Int> = []
  @ObservationIgnored private var started = false
  @ObservationIgnored private var ended = false
  @ObservationIgnored private var opened = false
  /// The latest load. An answer to an older one is dropped.
  @ObservationIgnored private var loadToken = 0
  /// Artifacts the stream sent while a load was out, by id. nil while none is.
  @ObservationIgnored private var artifactsSinceLoad: [Int: Artifact]?

  /// - Parameters:
  ///   - frame: how long stream messages gather before they are applied together.
  ///   - stream: opens the thread's stream from the event id given.
  public init(
    id: String, api: any ThreadAPI, clock: any Clock<Duration> = ContinuousClock(), frame: Duration = .milliseconds(16),
    stream: @escaping @Sendable (_ after: Int) -> SSEClient<ThreadStreamMessage>
  ) {
    self.id = id
    self.api = api
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

  /// Loads the thread again: the first load after it failed, else a refetch merged into what is shown.
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

  /// Keeps children, their team members and the parent current.
  public func apply(feed: FeedEvent) {
    guard case .thread(let t) = feed else { return }
    if t.parentID == id { Self.upsert(t, into: &children) }
    if t.source == .team, children.contains(where: { $0.id == t.parentID }) { Self.upsert(t, into: &team) }
    if let parent, parent.id == t.id { self.parent = t }
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

  // MARK: Loading

  private var isLoaded: Bool { loadState == .loaded }

  private func load() async {
    guard !ended else { return }
    loadToken += 1
    let token = loadToken
    artifactsSinceLoad = [:]
    let answer: Result<ThreadDetail, OmniAPIError>
    do {
      answer = .success(try await api.thread(id))
    } catch {
      answer = .failure(error)
    }
    guard token == loadToken else { return }

    switch answer {
    case .failure(.http(status: 404, _)):
      artifactsSinceLoad = nil
      loadState = .notFound
      closeStream()
    case .failure(let e):
      artifactsSinceLoad = nil
      if isLoaded {
        refreshError = e
      } else {
        loadState = .failed(e)
      }
    case .success(let d):
      if isLoaded {
        flush()
        take(d)
        add(d.events)
      } else {
        let rows = d.events.sorted { $0.id < $1.id }
        let laidOut = await Self.layout(rows)
        guard token == loadToken else { return }
        take(d)
        seen = Set(rows.map(\.id))
        lastID = rows.last?.id ?? 0
        events = rows
        transcript = laidOut
        eventsChanged()
        loadState = .loaded
        openStream()
      }
      refreshError = nil
    }
  }

  private nonisolated static func layout(_ rows: [EventRow]) async -> Transcript {
    Transcript(rows)
  }

  private func take(_ d: ThreadDetail) {
    merge(d.thread, pending: d.pending, live: d.live, isReply: false)
    channel = d.channel
    parent = d.parent
    children = d.children
    team = d.team
    var list = d.artifacts
    for a in (artifactsSinceLoad ?? [:]).values.sorted(by: { $0.id < $1.id }) {
      if let i = list.firstIndex(where: { $0.id == a.id }) {
        if list[i].updatedAt < a.updatedAt { list[i] = a }
      } else {
        list.append(a)
      }
    }
    artifactsSinceLoad = nil
    artifacts = list
    artifactIDs.formUnion(list.map(\.id))
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

  // MARK: Stream

  private func openStream() {
    guard stream == nil, !ended else { return }
    let s = makeStream(lastID)
    stream = s
    streamTask = Task { [weak self, events = s.events] in
      for await e in events {
        guard let self, !Task.isCancelled else { return }
        self.handle(e)
      }
    }
    s.start()
  }

  private func closeStream() {
    stream?.close()
    streamTask?.cancel()
    stream = nil
    streamTask = nil
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
      guard s == .open else { return }
      if opened { Task { await load() } }
      opened = true
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
      case .thread(let t, let p, let live): merge(t, pending: p, live: live, isReply: false)
      case .context, .unknown: break
      }
    }
    add(rows)
  }

  private func upsert(_ a: Artifact) {
    artifactsSinceLoad?[a.id] = a
    let isNew = artifactIDs.insert(a.id).inserted
    if let i = artifacts.firstIndex(where: { $0.id == a.id }) {
      artifacts[i] = a
    } else {
      artifacts.append(a)
    }
    if isNew && a.kind == "html" { arrivedHTML = a }
  }

  private func add(_ rows: [EventRow]) {
    let fresh = rows.filter { seen.insert($0.id).inserted }
    guard !fresh.isEmpty else { return }
    let inOrder = zip(fresh, fresh.dropFirst()).allSatisfy { $0.id < $1.id } && fresh[0].id > lastID
    lastID = max(lastID, fresh.map(\.id).max() ?? 0)
    var next = events + fresh
    if !inOrder { next.sort { $0.id < $1.id } }
    events = next
    transcript.update(next)
    eventsChanged()
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
    return store
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
    for store in all { store.stop() }
  }
}
