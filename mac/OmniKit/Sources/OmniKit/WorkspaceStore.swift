import Foundation
import Observation

/// The REST calls the workspace store makes. `OmniClient` is one; tests pass a fake.
public protocol WorkspaceAPI: Sendable {
  func channels(archived: Bool) async throws(OmniAPIError) -> [ChannelWithRunning]
  func status() async throws(OmniAPIError) -> Status
  func crew() async throws(OmniAPIError) -> [CrewRole]
  func recent(limit: Int?) async throws(OmniAPIError) -> [OmniThread]
  func harnesses() async throws(OmniAPIError) -> [HarnessInfo]
}

extension OmniClient: WorkspaceAPI {}

/// What the sidebar and Home show of the whole workspace, kept current from the feed with the Web UI's
/// rules (web/src/store.tsx):
/// - `start()` loads everything.
/// - A thread event updates `recent` in place, and refetches channels and status 500ms after the first
///   event of a burst, so running counts follow. One that comes in while `recent` loads is laid over the
///   answer, unless the answer has a newer copy of the thread.
/// - Every feed open after the first refetches everything, since events were missed. So does the first
///   one when the start load failed: the server came up.
/// - After the app changes a channel itself, call `reloadChannels()`. The server sends no event for it.
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

    public func channel(_ id: String) -> ChannelWithRunning? { channels.first { $0.id == id } }
    public var sidebar: SidebarSections { SidebarSections(channels) }
  }

  public static let recentLimit = 60
  static let refreshDelay = Duration.milliseconds(500)

  public private(set) var channels: [ChannelWithRunning] = []
  public private(set) var status: Status?
  public private(set) var usage: [HarnessID: Usage] = [:]
  public private(set) var crew: [CrewRole] = []
  public private(set) var recent: [OmniThread] = []
  public private(set) var harnesses: [HarnessInfo] = []
  public private(set) var loadState = LoadState.loading
  public private(set) var connection = ConnectionState.connecting

  public var snapshot: Snapshot {
    Snapshot(channels: channels, status: status, usage: usage, crew: crew, recent: recent, harnesses: harnesses)
  }

  public var sidebar: SidebarSections { SidebarSections(channels) }
  public func channel(_ id: String) -> ChannelWithRunning? { channels.first { $0.id == id } }

  private enum Part: CaseIterable {
    case channels, status, crew, recent, harnesses
  }

  @ObservationIgnored private let api: any WorkspaceAPI
  @ObservationIgnored private let events: AsyncStream<SSEEvent<FeedEvent>>
  @ObservationIgnored private let ticker: Ticker
  @ObservationIgnored private var feedClient: SSEClient<FeedEvent>?
  @ObservationIgnored private var feedTask: Task<Void, Never>?
  @ObservationIgnored private var refreshTimer: Task<Void, Never>?
  @ObservationIgnored private var started = false
  @ObservationIgnored private var opened = false
  /// The latest load of each part. An answer to an older one is dropped.
  @ObservationIgnored private var tokens: [Part: Int] = [:]
  /// Feed threads that came in while `recent` loaded, by id. nil while no load is out.
  @ObservationIgnored private var recentSinceLoad: [String: OmniThread]?

  /// - Parameter feed: the feed's events, as `SSEClient.events` sends them.
  public init(api: any WorkspaceAPI, feed: AsyncStream<SSEEvent<FeedEvent>>, clock: any Clock<Duration> = ContinuousClock()) {
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
    feedTask = Task { [weak self, events] in
      for await e in events {
        guard let self else { return }
        self.handle(e)
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
    await load([.channels])
  }

  private func handle(_ e: SSEEvent<FeedEvent>) {
    switch e {
    case .state(let s):
      connection = s
      guard s == .open else { return }
      let again = opened
      opened = true
      if again || loadState.isFailed {
        Task { await refresh() }
      }
    case .message(.usage(let harness, let u)):
      usage[harness] = u
    case .message(.thread(let t)):
      upsertRecent(t)
      scheduleRefresh()
    case .message:
      break
    }
  }

  private func upsertRecent(_ t: OmniThread) {
    recentSinceLoad?[t.id] = t
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
      await self.load([.channels, .status])
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
        list = Self.upserting(t, into: list)
      }
      if recent != list { recent = list }
    case .harnesses:
      guard let list = try? await api.harnesses(), current(), harnesses != list else { return }
      harnesses = list
    }
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

  /// A channel's running and queued threads, newest first, at most `maxThreads`. The open thread, if it
  /// is in this channel, joins them and stays after it stops, so the highlight never jumps away.
  public static func threads(of channel: ChannelWithRunning, open: ThreadStub? = nil) -> ThreadLinks {
    let open = open?.channelID == channel.id ? open : nil
    var list = channel.active.filter { $0.id != open?.id }
    if let open { list.insert(open, at: 0) }
    list.sort { $0.createdAt > $1.createdAt }
    let shown = list.enumerated().filter { $0.offset < maxThreads || $0.element.id == open?.id }.map(\.element)
    return ThreadLinks(shown: shown, more: list.count - shown.count)
  }
}
