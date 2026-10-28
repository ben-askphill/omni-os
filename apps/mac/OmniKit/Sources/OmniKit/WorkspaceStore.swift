import Foundation
import Observation

/// The REST calls the workspace store makes. `OmniClient` is one; tests pass a fake.
public protocol WorkspaceAPI: Sendable {
  func channels(archived: Bool) async throws(OmniAPIError) -> [ChannelWithRunning]
  func status() async throws(OmniAPIError) -> Status
  func crew() async throws(OmniAPIError) -> [CrewRole]
  func recent(limit: Int?) async throws(OmniAPIError) -> [OmniThread]
  func harnesses() async throws(OmniAPIError) -> [HarnessInfo]
  /// Every sub-agent running now, oldest first. `GET /api/tasks`.
  func tasks() async throws(OmniAPIError) -> [BackgroundTask]
  /// Every mod status line pinned now. `GET /api/mods`.
  func mods() async throws(OmniAPIError) -> [ModStatus]
  /// Unread results and blockers. `GET /api/needs-you`.
  func needsYou() async throws(OmniAPIError) -> NeedsYou
  /// Ben saw this result. `POST /api/needs-you/read`.
  func readResult(_ uid: String) async throws(OmniAPIError) -> NeedsYouRead
  /// The sidebar's Pinned section, the latest pin first. `GET /api/pinned`.
  func pinned() async throws(OmniAPIError) -> [ThreadStub]
}

extension WorkspaceAPI {
  /// None, for a fake that does not model mods.
  public func mods() async throws(OmniAPIError) -> [ModStatus] { [] }
  /// Nothing, for a fake that does not model Needs you.
  public func needsYou() async throws(OmniAPIError) -> NeedsYou { .empty }
  public func readResult(_ uid: String) async throws(OmniAPIError) -> NeedsYouRead { throw .unreachable("no Needs you") }
  /// Nothing pinned, for a fake that does not model pins.
  public func pinned() async throws(OmniAPIError) -> [ThreadStub] { [] }
}

extension OmniClient: WorkspaceAPI {}

/// What the sidebar and Home show of the whole workspace, kept current from the feed with the Web UI's
/// rules (apps/web/src/store.tsx):
/// - `start()` loads everything, including the agents running now (`GET /api/tasks`).
/// - A thread event updates `recent` in place, and refetches channels and status 500ms after the first
///   event of a burst, so running counts follow. One that comes in while `recent` loads is laid over the
///   answer, unless the answer has a newer copy of the thread.
/// - A `tasks` event replaces the agent list. The server sends every agent still running. A `mods` event
///   does the same for the mod status lines.
/// - Every feed open after the first refetches everything, since events were missed. So does the first
///   one when the start load failed: the server came up. That refetch is immediate. The Web UI debounces
///   channels and status and lets each list reload itself (see apps/mac/NOTES.md).
/// - After the app changes a channel itself, call `reloadChannels()`. The server sends no event for it.
/// - Pinned threads (`pinned`) name threads in any channel, so they load whenever the channels do.
/// - Needs you (`needsYou`) reloads with channels and status after thread events, and at once on a `needs_you`
///   event (a read or a result on another client, or from the other Mac's sync). Those come in bursts when a sync
///   applies many: one load runs at a time, and one more after it if events came meanwhile. `readResult(_:)`
///   drops the result at once and tells the server; a load that started before it is dropped, so it cannot put
///   the result back.
///
/// `init(client:)` opens a feed of its own, for a store used on its own. `AppModel` owns the app's one
/// feed and pushes it in with `apply(_:)`.
///
/// Each piece is its own observed property, so a view reading `channels` does not redraw for `recent`.
@MainActor @Observable
public final class WorkspaceStore {
  public enum LoadState: Hashable, Sendable {
    /// The first channel list has not come back yet.
    case loading
    case loaded
    /// The last channel load failed. Whatever loaded before stays.
    case failed(OmniAPIError)
  }

  public struct Snapshot: Hashable, Sendable {
    public let channels: [ChannelWithRunning]
    /// Counts and slots. Read usage from `usage`, which the feed keeps fresher.
    public let status: Status?
    public let usage: [HarnessID: Usage]
    public let crew: [CrewRole]
    /// Most recently updated first, at most `recentLimit`.
    public let recent: [OmniThread]
    public let harnesses: [HarnessInfo]
    /// Sub-agents running now, in the order the server sent them.
    public let tasks: [BackgroundTask]

    public func channel(_ id: String) -> ChannelWithRunning? { channels.first { $0.id == id } }
    public var sidebar: SidebarSections { SidebarSections(channels) }
  }

  public static let recentLimit = 60
  static let refreshDelay = Duration.milliseconds(500)

  public private(set) var channels: [ChannelWithRunning] = []
  /// The sidebar's Pinned section, the latest pin first. Empty hides it.
  public private(set) var pinned: [ThreadStub] = []
  public private(set) var status: Status?
  public private(set) var usage: [HarnessID: Usage] = [:]
  public private(set) var crew: [CrewRole] = []
  public private(set) var recent: [OmniThread] = []
  public private(set) var harnesses: [HarnessInfo] = []
  /// Sub-agents running now. Empty shows nothing in the sidebar.
  public private(set) var tasks: [BackgroundTask] = []
  /// Mod status lines pinned now, oldest first. One per plugin per thread.
  public private(set) var mods: [ModStatus] = []
  /// Unread results and blockers across every thread. Nil until the first load.
  public private(set) var needsYou: NeedsYou?
  /// Bumps when the feed archives a thread or shows one that is not in `recent`, which a restore does. A channel's
  /// lists refetch on it, since `recent` holds no archived threads to lay over them.
  public private(set) var archiveEpoch = 0
  public private(set) var loadState = LoadState.loading
  public private(set) var connection = ConnectionState.connecting
  /// How many times the feed has opened. The first is the initial connection; each later one is a reconnect.
  public private(set) var feedOpens = 0
  /// Each feed message as it comes, for the thread stores that follow it.
  @ObservationIgnored public var onFeed: ((FeedEvent) -> Void)?

  public var snapshot: Snapshot {
    Snapshot(channels: channels, status: status, usage: usage, crew: crew, recent: recent, harnesses: harnesses, tasks: tasks)
  }

  public var sidebar: SidebarSections { SidebarSections(channels) }
  public func channel(_ id: String) -> ChannelWithRunning? { channels.first { $0.id == id } }

  private enum Part: CaseIterable {
    case channels, pinned, status, crew, recent, harnesses, tasks, mods, needsYou
  }

  @ObservationIgnored private let api: any WorkspaceAPI
  @ObservationIgnored private let events: AsyncStream<SSEEvent<FeedEvent>>?
  @ObservationIgnored private let ticker: Ticker
  @ObservationIgnored private var feedClient: SSEClient<FeedEvent>?
  @ObservationIgnored private var feedTask: Task<Void, Never>?
  @ObservationIgnored private var refreshTimer: Task<Void, Never>?
  @ObservationIgnored private var started = false
  @ObservationIgnored private var opened = false
  /// The latest load of each part. An answer to an older one is dropped.
  @ObservationIgnored private var tokens: [Part: Int] = [:]
  /// A `needs_you` load is out, and whether events came in since it started.
  @ObservationIgnored private var needsYouLoading = false
  @ObservationIgnored private var needsYouAgain = false
  /// Feed threads that came in while `recent` loaded, by id. nil while no load is out.
  @ObservationIgnored private var recentSinceLoad: [String: OmniThread]?
  /// Bumps on each `tasks` event, so a list fetch that started earlier cannot overwrite it.
  @ObservationIgnored private var tasksEpoch = 0
  /// The same for `mods` events.
  @ObservationIgnored private var modsEpoch = 0

  /// - Parameter feed: the feed's events, as `SSEClient.events` sends them. Nil when something else, the
  ///   app's `AppFeed`, pushes events with `apply(_:)`.
  public init(api: any WorkspaceAPI, feed: AsyncStream<SSEEvent<FeedEvent>>? = nil, clock: any Clock<Duration> = ContinuousClock()) {
    self.api = api
    self.events = feed
    self.ticker = Ticker(clock)
  }

  /// Reads the server's feed with an `SSEClient` of its own, started and closed with the store.
  public convenience init(
    client: OmniClient, transport: any SSETransport = URLSessionSSETransport.shared, clock: any Clock<Duration> = ContinuousClock()
  ) {
    let feed = client.feedEvents(transport: transport, clock: clock)
    self.init(api: client, feed: feed.events, clock: clock)
    feedClient = feed
  }

  public func start() {
    guard !started else { return }
    started = true
    if let events {
      feedTask = Task { [weak self, events] in
        for await e in events {
          guard let self else { return }
          self.apply(e)
        }
      }
    }
    feedClient?.start()
    Task { await refresh() }
  }

  public func stop() {
    feedClient?.close()
    feedTask?.cancel()
    feedTask = nil
    refreshTimer?.cancel()
    refreshTimer = nil
    connection = .closed
  }

  /// See `SSEClient.reconnectNow(ifQuietFor:)`. Only for a store made with `init(client:)`.
  public func reconnectNow(ifQuietFor quiet: Duration? = nil) {
    feedClient?.reconnectNow(ifQuietFor: quiet)
  }

  /// Loads everything again. Returns when every part has answered.
  public func refresh() async {
    refreshTimer?.cancel()
    refreshTimer = nil
    await load(Part.allCases)
  }

  public func reloadChannels() async {
    await load([.channels, .pinned])
  }

  /// A pin or unpin the app shows before the server has it. A pinned load already out is dropped, so it cannot put
  /// back the list from before; the next load is the server's answer.
  func editPinned(_ thread: ThreadStub, on: Bool) {
    tokens[.pinned, default: 0] += 1
    let rest = pinned.filter { $0.id != thread.id }
    pinned = on ? (pinned.contains { $0.id == thread.id } ? pinned : [thread] + rest) : rest
  }

  /// An edit the app shows before the server has it (`FolderModel`). A channel load already out is dropped, so it
  /// cannot put back the list from before the edit.
  func editChannel(_ id: String, _ edit: (ChannelWithRunning) -> ChannelWithRunning) {
    tokens[.channels, default: 0] += 1
    channels = channels.map { $0.id == id ? edit($0) : $0 }
  }

  /// The list from before an edit the server refused.
  func restoreChannels(_ list: [ChannelWithRunning]) {
    tokens[.channels, default: 0] += 1
    if channels != list { channels = list }
  }

  /// One event from the app's feed. A store that reads `feed` itself calls this too.
  func apply(_ e: SSEEvent<FeedEvent>) {
    if case .message(let m) = e { onFeed?(m) }
    switch e {
    case .state(let s):
      connection = s
      guard s == .open else { return }
      let again = opened
      opened = true
      feedOpens += 1
      // Immediate, and it includes recent, harnesses and tasks. The Web UI debounces channels and status
      // and lets each list reload itself (apps/mac/NOTES.md).
      if again || loadState.isFailed {
        Task { await refresh() }
      }
    case .message(.usage(let harness, let u)):
      usage[harness] = u
    case .message(.thread(let t)):
      upsertRecent(t)
      scheduleRefresh()
    case .message(.channel(_)):
      scheduleRefresh()
    case .message(.tasks(let list)):
      tasksEpoch += 1
      // A thread stays listed while its agents run past its turn: the channels change when the set of hosts does.
      if Set(tasks.map(\.hostID)) != Set(list.map(\.hostID)) { scheduleRefresh() }
      if tasks != list { tasks = list }
    case .message(.mods(let list)):
      modsEpoch += 1
      if mods != list { mods = list }
    case .message(.needsYou(_)):
      needsYouChanged()
    case .message(.artifact(_)), .message(.automationDelivery(_)), .message(.unknown(_)):
      break
    }
  }

  /// One load at a time for `needs_you` events, and one more after it when more came while it was out.
  private func needsYouChanged() {
    guard !needsYouLoading else {
      needsYouAgain = true
      return
    }
    needsYouLoading = true
    Task {
      repeat {
        needsYouAgain = false
        await load(.needsYou)
      } while needsYouAgain
      needsYouLoading = false
    }
  }

  /// Ben saw this result: it leaves Needs you at once, and the server keeps it read. The inbox loads again after,
  /// since a newer result may have come in meanwhile.
  /// A thread marked done leaves Needs you at once; a Needs you load already out is dropped, so it cannot put it back.
  /// The next load is the server's answer, which also brings a reopened thread back.
  public func editDone(_ threadID: String, on: Bool) {
    guard on else { return }
    tokens[.needsYou, default: 0] += 1
    if let n = needsYou { needsYou = n.withoutThread(threadID) }
  }

  public func reloadNeedsYou() async {
    await load([.needsYou])
  }

  public func readResult(_ uid: String) async {
    tokens[.needsYou, default: 0] += 1
    if let n = needsYou { needsYou = n.withoutResult(uid) }
    _ = try? await api.readResult(uid)
    await load([.needsYou])
  }

  private func upsertRecent(_ t: OmniThread) {
    recentSinceLoad?[t.id] = t
    if t.archived || !recent.contains(where: { $0.id == t.id }) { archiveEpoch += 1 }
    if t.archived {
      recent.removeAll { $0.id == t.id }
      return
    }
    recent = Self.upserting(t, into: recent)
  }

  private static func upserting(_ t: OmniThread, into list: [OmniThread]) -> [OmniThread] {
    var list = list.filter { $0.id != t.id }
    list.insert(t, at: list.firstIndex { $0.updatedAt < t.updatedAt } ?? list.endIndex)
    return Array(list.prefix(recentLimit))
  }

  private func scheduleRefresh() {
    guard refreshTimer == nil else { return }
    let deadline = ticker.now() + Self.refreshDelay
    refreshTimer = Task { [weak self, ticker] in
      do {
        try await ticker.sleep(deadline)
      } catch {
        return
      }
      guard let self else { return }
      self.refreshTimer = nil
      await self.load([.channels, .pinned, .status, .needsYou])
    }
  }

  private func load(_ parts: [Part]) async {
    await withDiscardingTaskGroup { group in
      for p in parts {
        group.addTask { await self.load(p) }
      }
    }
  }

  private func load(_ part: Part) async {
    let token = tokens[part, default: 0] + 1
    tokens[part] = token
    let current = { self.tokens[part] == token }
    switch part {
    case .channels:
      do {
        let list = try await api.channels(archived: false)
        guard current() else { return }
        if channels != list { channels = list }
        loadState = .loaded
      } catch {
        guard current(), error != .cancelled else { return }
        loadState = .failed(error)
      }
    case .pinned:
      guard let list = try? await api.pinned(), current(), pinned != list else { return }
      pinned = list
    case .status:
      guard let s = try? await api.status(), current() else { return }
      if status != s { status = s }
      let merged = usage.merging(s.usage) { $1 }
      if usage != merged { usage = merged }
    case .crew:
      guard let list = try? await api.crew(), current(), crew != list else { return }
      crew = list
    case .recent:
      recentSinceLoad = [:]
      let answer = try? await api.recent(limit: Self.recentLimit)
      guard current() else { return }
      let since = recentSinceLoad ?? [:]
      recentSinceLoad = nil
      guard var list = answer else { return }
      // The answer can predate an event read while it was out. A newer copy in the answer wins.
      for t in since.values where list.first(where: { $0.id == t.id }).map({ $0.updatedAt <= t.updatedAt }) ?? true {
        if t.archived {
          list.removeAll { $0.id == t.id }
        } else {
          list = Self.upserting(t, into: list)
        }
      }
      if recent != list { recent = list }
    case .harnesses:
      guard let list = try? await api.harnesses(), current(), harnesses != list else { return }
      harnesses = list
    case .tasks:
      let epoch = tasksEpoch
      guard let list = try? await api.tasks(), current(), tasksEpoch == epoch else { return }
      if tasks != list { tasks = list }
    case .mods:
      let epoch = modsEpoch
      guard let list = try? await api.mods(), current(), modsEpoch == epoch else { return }
      if mods != list { mods = list }
    case .needsYou:
      guard let n = try? await api.needsYou(), current(), needsYou != n else { return }
      needsYou = n
    }
  }
}

extension OmniClient {
  public func tasks() async throws(OmniAPIError) -> [BackgroundTask] {
    try await send("GET", "/api/tasks")
  }

  public func mods() async throws(OmniAPIError) -> [ModStatus] {
    try await send("GET", "/api/mods")
  }
}

extension WorkspaceStore.LoadState {
  var isFailed: Bool {
    if case .failed = self { true } else { false }
  }
}

/// The sidebar's channels, laid out like Sidebar.tsx: Conductor on top, then Clients, Internal and
/// Personal, leaving out an empty group, then channels of any other kind. Server order within each.
public struct SidebarSections: Hashable, Sendable {
  public struct Group: Hashable, Sendable, Identifiable {
    public let kind: ChannelKind
    public let label: String
    public let channels: [ChannelWithRunning]
    public var id: ChannelKind { kind }
  }

  public struct ThreadLinks: Hashable, Sendable {
    public let shown: [ThreadStub]
    /// How many more there are, for "N more".
    public let more: Int
    /// The highlighted channel links to all its threads instead of "N more".
    public let seeAll: Bool
  }

  public struct ThreadRowGroup: Hashable, Sendable, Identifiable {
    public let thread: ThreadStub
    public let children: [ThreadStub]
    public var id: String { thread.id }

    public init(thread: ThreadStub, children: [ThreadStub]) {
      self.thread = thread
      self.children = children
    }
  }

  public static let conductorID = "conductor"
  public static let maxThreads = 5
  private static let kinds: [(kind: ChannelKind, label: String)] = [(.client, "Clients"), (.internal, "Internal"), (.personal, "Personal")]

  public let conductor: ChannelWithRunning?
  public let groups: [Group]
  public let other: [ChannelWithRunning]

  public init(_ channels: [ChannelWithRunning]) {
    conductor = channels.first { $0.id == Self.conductorID }
    let rest = channels.filter { $0.id != Self.conductorID }
    groups = Self.kinds.compactMap { g in
      let list = rest.filter { $0.kind == g.kind }
      return list.isEmpty ? nil : Group(kind: g.kind, label: g.label, channels: list)
    }
    other = rest.filter { c in !Self.kinds.contains { $0.kind == c.kind } }
  }

  public struct FolderLinks: Hashable, Sendable {
    public let shown: [ThreadStub]
    /// How many more it lists, for "N more".
    public let more: Int
    /// An open folder with no threads says "No threads yet".
    public let empty: Bool
  }

  /// Past this many threads an open folder shows "N more".
  public static let maxFolderThreads = 8

  /// What the sidebar's fold-all button does, as foldAllAction in apps/web/src/sidebar-fold.ts: true while any channel
  /// is open (it closes them all), false once every one is closed (it opens them).
  public static func collapsesAll(_ channels: [ChannelWithRunning], collapsed: Set<String>) -> Bool {
    channels.contains { !collapsed.contains($0.id) }
  }

  /// The open folders a collapse-all closes too. A folder the server has not saved yet is left alone.
  public static func openFolderIDs(_ channels: [ChannelWithRunning]) -> [String] {
    channels.flatMap { $0.folders.filter { !$0.collapsed && !$0.isStandIn }.map(\.id) }
  }

  /// The folder a thread sits in, as the list knows it now: a move shows before the open thread's own copy hears of it.
  public static func folder(of thread: ThreadStub, in channel: ChannelWithRunning) -> String? {
    if let f = channel.folders.first(where: { f in f.threads.contains { $0.id == thread.id } }) { return f.id }
    let stub = (channel.active + channel.recent).first { $0.id == thread.id } ?? thread
    guard let id = stub.folderID, channel.folders.contains(where: { $0.id == id }) else { return nil }
    return id
  }

  /// The Pinned section's rows, as pinnedRows in apps/web/src/pins.ts: the open thread's fresher copy in its own
  /// place, so its status follows the thread screen without a refetch. Never adds a thread that is not pinned.
  public static func pinned(_ list: [ThreadStub], open: ThreadStub?) -> [ThreadStub] {
    guard let open else { return list }
    return list.map { $0.id == open.id ? open : $0 }
  }

  /// How many threads Recent threads lists, as RECENT_THREADS in apps/web/src/sidebar-lists.ts. The server sends each
  /// channel's 5 latest, so the 5 latest overall are among them.
  public static let recentThreads = 5

  /// Newest first; a tie goes to the lower id, so the order never flickers between reloads.
  private static func newer(_ a: ThreadStub, _ b: ThreadStub) -> Bool {
    a.createdAt != b.createdAt ? a.createdAt > b.createdAt : a.id < b.id
  }

  /// Every list once, keeping a thread's first copy.
  private static func unique(_ lists: [[ThreadStub]]) -> [ThreadStub] {
    var seen = Set<String>()
    return lists.joined().filter { seen.insert($0.id).inserted }
  }

  /// The Running section, as runningThreads in apps/web/src/sidebar-lists.ts: every thread at work in any channel,
  /// newest first. That is what each channel's running badge counts (running and queued) plus a thread whose
  /// sub-agents still run after its turn ended. Empty when nothing runs, which hides it. The open thread's fresher
  /// copy shows in its own place.
  public static func running(_ channels: [ChannelWithRunning], open: ThreadStub? = nil) -> [ThreadStub] {
    pinned(unique(channels.map(\.active)), open: open).sorted(by: newer)
  }

  /// The Recent threads section, as recentThreads in apps/web/src/sidebar-lists.ts: the `limit` threads with the
  /// latest activity in any channel, whatever their status, pinned or running. Ties go to the newer thread, then the
  /// lower id. The open thread's fresher copy shows in its own place.
  public static func recent(_ channels: [ChannelWithRunning], open: ThreadStub? = nil, limit: Int = recentThreads) -> [ThreadStub] {
    let list = unique(channels.map(\.recent)).sorted { a, b in
      let (x, y) = (a.updatedAt ?? a.createdAt, b.updatedAt ?? b.createdAt)
      return x != y ? x > y : newer(a, b)
    }
    return pinned(Array(list.prefix(limit)), open: open)
  }

  /// Running rows grouped under Conductor jobs. An active child keeps its parent visible after the parent stops.
  public static func runningGroups(_ channels: [ChannelWithRunning], open: ThreadStub? = nil) -> [ThreadRowGroup] {
    let candidates = running(channels, open: open)
    let byID = Dictionary(candidates.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    let handoffs = channels.first(where: { $0.id == conductorID })?.handoffs ?? []
    let childIDs = Set(handoffs.flatMap { $0.children.map(\.id) })
    var groups = Dictionary(uniqueKeysWithValues: candidates.filter { !childIDs.contains($0.id) }.map { ($0.id, ThreadRowGroup(thread: $0, children: [])) })
    for handoff in handoffs {
      let children = handoff.children.filter { byID[$0.id] != nil && $0.status.isActive }
      guard !children.isEmpty else { continue }
      let parent = byID[handoff.parent.id] ?? handoff.parent
      groups[parent.id] = ThreadRowGroup(thread: parent, children: children)
    }
    return groups.values.sorted { a, b in
      a.thread.createdAt != b.thread.createdAt ? a.thread.createdAt > b.thread.createdAt : a.thread.id < b.thread.id
    }
  }

  /// The five latest jobs and threads by activity, with their Conductor children nested under the parent.
  public static func recentGroups(_ channels: [ChannelWithRunning], open: ThreadStub? = nil, limit: Int = recentThreads) -> [ThreadRowGroup] {
    let candidates = unique(channels.map(\.recent)).sorted { a, b in
      let (x, y) = (a.updatedAt ?? a.createdAt, b.updatedAt ?? b.createdAt)
      return x != y ? x > y : newer(a, b)
    }
    let all = pinned(candidates, open: open)
    let byID = Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    let handoffs = channels.first(where: { $0.id == conductorID })?.handoffs ?? []
    let childIDs = Set(handoffs.flatMap { $0.children.map(\.id) })
    var groups = Dictionary(uniqueKeysWithValues: all.filter { !childIDs.contains($0.id) }.map { ($0.id, ThreadRowGroup(thread: $0, children: [])) })
    var activity: [String: Date] = [:]
    for handoff in handoffs {
      let present = handoff.children.compactMap { byID[$0.id] }
      guard byID[handoff.parent.id] != nil || !present.isEmpty else { continue }
      let parent = byID[handoff.parent.id] ?? handoff.parent
      groups[parent.id] = ThreadRowGroup(thread: parent, children: handoff.children)
      activity[parent.id] = ([parent] + present).compactMap { $0.updatedAt ?? $0.createdAt }.max()
    }
    return groups.values.sorted { a, b in
      let x = activity[a.thread.id] ?? a.thread.updatedAt ?? a.thread.createdAt
      let y = activity[b.thread.id] ?? b.thread.updatedAt ?? b.thread.createdAt
      return x != y ? x > y : newer(a.thread, b.thread)
    }.prefix(limit).map { $0 }
  }

  /// The channel's folders in order, with the open thread under its own folder even past the listed ones.
  public static func folders(of channel: ChannelWithRunning, open: ThreadStub? = nil) -> [FolderWithThreads] {
    guard let open, open.channelID == channel.id, let home = folder(of: open, in: channel) else { return channel.folders }
    return channel.folders.map { f in
      guard f.id == home, !f.threads.contains(where: { $0.id == open.id }) else { return f }
      var f = f
      var t = open
      t.folderID = f.id
      f.threads.insert(t, at: 0)
      return f
    }
  }

  /// A folder's rows: its threads while open, at most `maxFolderThreads` unless `all`, past which it still shows
  /// the open thread and any in `busy` (running sub-agents). Closed, it still shows the open thread, so the
  /// highlight never vanishes into it.
  public static func threads(in folder: FolderWithThreads, openID: String?, all: Bool = false, busy: Set<String> = []) -> FolderLinks {
    let list = folder.collapsed ? folder.threads.filter { $0.id == openID } : folder.threads
    let shown = all ? list : list.enumerated().filter { $0.offset < maxFolderThreads || $0.element.id == openID || busy.contains($0.element.id) }.map(\.element)
    return FolderLinks(shown: shown, more: folder.collapsed ? 0 : list.count - shown.count, empty: !folder.collapsed && folder.count == 0)
  }

  /// A channel's running and queued threads, newest first, at most `maxThreads`. The open thread, if it
  /// is in this channel, joins them and stays after it stops, so the highlight never jumps away. The
  /// highlighted channel also lists its latest threads of any status, so finished ones stay findable. Threads in a
  /// folder are listed under the folder instead. Past `maxThreads` it still shows any in `busy` (running sub-agents).
  public static func threads(of channel: ChannelWithRunning, open: ThreadStub? = nil, focused: Bool = false, busy: Set<String> = []) -> ThreadLinks {
    let open = open?.channelID == channel.id ? open : nil
    var seen: Set<String> = open.map { [$0.id] } ?? []
    var list = (channel.active + (focused ? channel.recent : [])).filter { seen.insert($0.id).inserted }
    if let open { list.insert(open, at: 0) }
    list.removeAll { folder(of: $0, in: channel) != nil }
    list.sort { $0.createdAt > $1.createdAt }
    let shown = list.enumerated().filter { $0.offset < maxThreads || $0.element.id == open?.id || busy.contains($0.element.id) }.map(\.element)
    return ThreadLinks(shown: shown, more: focused ? 0 : list.count - shown.count, seeAll: focused)
  }
}
