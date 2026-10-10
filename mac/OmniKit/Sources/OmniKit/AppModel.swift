import Foundation
import Observation

/// A start that failed, kept on screen after a later check finds nothing on the port.
public struct StartFailure: Hashable, Sendable {
  public let message: String
  public let logTail: [String]

  public init(message: String, logTail: [String]) {
    self.message = message
    self.logTail = logTail
  }
}

/// What the window shows in place of the route while there is no server to talk to.
public enum ServerScreen: Hashable, Sendable {
  /// The first check has not answered yet.
  case looking(port: Int)
  case notRunning(port: Int, repo: String)
  case starting(port: Int)
  case stopping(port: Int)
  case failed(message: String, logTail: [String])

  /// nil when the route should show: the server runs, or the feed is open whatever the last check said.
  public init?(state: ServerSupervisor.State, connection: ConnectionState, startFailure: StartFailure?, port: Int, repo: String) {
    if connection == .open, state != .stopping { return nil }
    switch state {
    case .running: return nil
    case .unknown, .checking: self = .looking(port: port)
    case .notRunning:
      if let startFailure {
        self = .failed(message: startFailure.message, logTail: startFailure.logTail)
      } else {
        self = .notRunning(port: port, repo: repo)
      }
    case .starting: self = .starting(port: port)
    case .stopping: self = .stopping(port: port)
    case .failed(let message, let tail): self = .failed(message: message, logTail: tail)
    }
  }
}

extension ServerSupervisor.State {
  /// A few words for the status line.
  public var label: String {
    switch self {
    case .running(true, _): "Started by the app"
    case .running(false, _): "Started outside the app"
    case .notRunning, .failed: "Not running"
    case .starting: "Starting"
    case .stopping: "Stopping"
    case .unknown, .checking: "Checking"
    }
  }

  /// Nothing runs on the port and nothing is starting or stopping: Start makes sense.
  public var canStart: Bool {
    switch self {
    case .notRunning, .failed: true
    default: false
    }
  }
}

/// The app's one connection to Omni: settings, the supervisor, and a client, workspace store and feed for
/// the port in the settings. A port change swaps them; any settings change checks again.
/// The feed dropping or opening checks the server again, so the window follows a server that was killed
/// or started somewhere else. There is one `/api/feed`. The workspace, the open threads, artifacts and
/// automations all read it.
@MainActor @Observable
public final class AppModel {
  public struct Connection {
    public let client: OmniClient
    public let store: WorkspaceStore
    public let threads: ThreadStoreRegistry
    /// The one `/api/feed` for this port.
    public let feed: AppFeed

    /// - Parameter threads: the stores for open threads, on `client` by default.
    @MainActor public init(client: OmniClient, store: WorkspaceStore, threads: ThreadStoreRegistry? = nil, feed: AppFeed) {
      self.client = client
      self.store = store
      self.threads = threads ?? ThreadStoreRegistry(client: client)
      self.feed = feed
    }
  }

  public let settings: ServerSettings
  public let supervisor: ServerSupervisor
  public private(set) var client: OmniClient
  public private(set) var store: WorkspaceStore
  /// The open threads' stores. Feed thread events are passed to `apply(feed:)`. Swapped on a port change.
  public private(set) var threads: ThreadStoreRegistry
  /// The one `/api/feed`. Swapped with the client on a port change.
  public private(set) var feed: AppFeed
  public var route = Route.home {
    // A route that lives in Settings is put back at once, so it is no stop in the history.
    didSet { if route.settingsTab == nil { shell.history.visit(route) } }
  }
  /// History, the Go to palette and composer focus.
  public let shell = ShellState()
  /// The tab the Settings window shows.
  public var settingsTab = SettingsTab.connection
  /// The last start that failed, until the server runs, Start is pressed again or the settings change.
  public private(set) var startFailure: StartFailure?
  /// Banners for threads that finish, fail or stop. The window shows them.
  public let banners = BannerCenter()
  /// Sidebar folders: their edits, the name being typed and the delete being confirmed. Follows the connection.
  public let folders = FolderModel()

  @ObservationIgnored private let connect: @MainActor (_ port: Int) -> Connection
  @ObservationIgnored private var config: ServerConfig
  @ObservationIgnored private var lastConnection = ConnectionState.connecting
  @ObservationIgnored private var watchers: [Task<Void, Never>] = []
  @ObservationIgnored private var launched = false
  /// The workspace's subscription on `feed`. Dropped before the feed is replaced.
  @ObservationIgnored private var feedTicket: UUID?

  /// - Parameter connect: makes the client and store for a port. `liveConnection` by default.
  public init(
    settings: ServerSettings, supervisor: ServerSupervisor? = nil,
    connect: @escaping @MainActor (_ port: Int) -> Connection = AppModel.liveConnection
  ) {
    self.settings = settings
    self.supervisor = supervisor ?? ServerSupervisor(settings: settings)
    self.connect = connect
    config = settings.config
    let c = connect(settings.port)
    client = c.client
    store = c.store
    folders.connect(store: c.store, api: c.client)
    threads = c.threads
    feed = c.feed
    follow(c)
  }

  isolated deinit {
    for w in watchers { w.cancel() }
    unfollow()
    feed.stop()
    store.stop()
  }

  /// A client with its own ephemeral session, so nothing is cached or proxied, and the one feed.
  public static func liveConnection(port: Int) -> Connection {
    let c = URLSessionConfiguration.ephemeral
    c.requestCachePolicy = .reloadIgnoringLocalCacheData
    c.connectionProxyDictionary = [:]
    let client = OmniClient(port: port, transport: URLSessionTransport(session: URLSession(configuration: c)))
    let feed = AppFeed(source: client.feedEvents())
    return Connection(client: client, store: WorkspaceStore(api: client), feed: feed)
  }

  /// Opens the feed, checks the server and starts following the settings. Once.
  public func launch() {
    guard !launched else { return }
    launched = true
    feed.start()
    store.start()
    checkServer()
    watchers.append(Task { [weak self, settings] in
      for await config in Observations({ settings.config }) {
        guard let self else { return }
        self.settingsChanged(config)
      }
    })
    watchers.append(Task { [weak self] in
      let states = Observations.untilFinished { [weak self] () -> Observations<ConnectionState, Never>.Iteration in
        guard let self else { return .finish }
        return .next(self.store.connection)
      }
      for await state in states {
        self?.connectionChanged(state)
      }
    })
  }

  // MARK: What the window shows

  public var serverScreen: ServerScreen? {
    ServerScreen(
      state: supervisor.state, connection: store.connection, startFailure: startFailure, port: settings.port,
      repo: settings.effectiveRepoPath
    )
  }

  /// Shown while the feed retries, so the window says its data may be stale.
  public var connectionNotice: String? {
    if case .reconnecting = store.connection { "Reconnecting" } else { nil }
  }

  public var logURL: URL { supervisor.logURL }

  /// The thread the route shows, once its store has it, for the sidebar to keep in view.
  public var openThread: ThreadStub? {
    guard case .thread(let id, _) = route, let t = threads.store(id)?.thread else { return nil }
    return ThreadStub(t)
  }

  /// The highlighted channel in the sidebar: the one open, or the open thread's.
  public var focusedChannel: String? {
    if case .channel(let id, _, _) = route { return id }
    return openThread?.channelID
  }

  /// The window title: the thread's own on a thread, else the route's.
  public var title: String {
    guard serverScreen == nil else { return "Omni" }
    if case .thread(let id, _) = route, let t = threads.store(id)?.thread { return t.title }
    return route.title { store.channel($0)?.name }
  }

  /// The thread on screen as Markdown, for Copy Thread as Markdown. nil until it loads.
  public var openThreadMarkdown: String? {
    guard case .thread(let id, _) = route else { return nil }
    return threadMarkdown(id)
  }

  /// A thread as Markdown, once its store has it. For the window that has focus, whichever it is.
  public func threadMarkdown(_ id: String) -> String? {
    guard let s = threads.store(id), let t = s.thread, s.loadState == .loaded else { return nil }
    return TranscriptMarkdown.thread(title: t.title, items: s.transcript.items, cwd: s.cwd)
  }

  // MARK: Actions

  /// Renames a thread from a right-click. A blank title or a failed call leaves it as it was.
  public func renameThread(_ id: String, to title: String) async {
    let title = title.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    guard !title.isEmpty, (try? await client.renameThread(id, title: title)) != nil else { return }
    await store.reloadChannels()
  }

  /// Archives a thread (or brings it back) from a right-click, then refreshes the lists. Archiving the
  /// thread on screen moves to its channel.
  public func setThreadArchived(_ id: String, _ archived: Bool) async {
    // A failed call leaves the thread where it is, which is the answer.
    guard let t = try? await client.archiveThread(id, archived: archived) else { return }
    await store.reloadChannels()
    if archived, case .thread(let open, _) = route, open == id { route = .channel(id: t.channelID) }
  }


  /// Starts the server, or attaches to one that answers, then reconnects the feed without waiting out its backoff.
  public func startServer() async {
    startFailure = nil
    await supervisor.start()
    switch supervisor.state {
    case .failed(let message, let tail): startFailure = StartFailure(message: message, logTail: tail)
    case .running: reconnectStreams()
    default: break
    }
  }

  /// - Parameter ownOnly: see `ServerSupervisor.stop(ownOnly:)`.
  public func stopServer(ownOnly: Bool = false) async {
    await supervisor.stop(ownOnly: ownOnly)
  }

  /// Checks the port again and retries the feed now.
  public func checkAgain() async {
    reconnectStreams()
    await refreshServer()
  }

  /// The app came to the front: a feed quiet for longer than the server's ping interval is likely dead.
  public func didBecomeActive() {
    reconnectStreams(ifQuietFor: .seconds(25))
    checkServer()
  }

  /// The Mac woke from sleep. Connections from before rarely survive it, and the other Mac may have moved on.
  public func didWake() {
    reconnectStreams()
    checkServer()
    requestSync()
  }

  public func networkChanged() {
    reconnectStreams()
    requestSync()
  }

  /// Asks the server to sync with the other Mac now rather than on its timer. Sync off (409) or the relay
  /// down (502) is nothing to show here: the server keeps trying on its own.
  private func requestSync() {
    let client = client
    Task { try? await client.syncNow() }
  }

  private func reconnectStreams(ifQuietFor quiet: Duration? = nil) {
    feed.reconnectNow(ifQuietFor: quiet)
    threads.reconnectNow(ifQuietFor: quiet)
  }

  /// Calls `handler` with each feed event until `unsubscribeFeed`.
  @discardableResult
  public func subscribeFeed(_ handler: @escaping @MainActor (SSEEvent<FeedEvent>) -> Void) -> UUID {
    feed.subscribe(handler)
  }

  public func unsubscribeFeed(_ id: UUID) {
    feed.unsubscribe(id)
  }

  // MARK: Following changes

  private func follow(_ c: Connection) {
    c.store.onFeed = { [threads = c.threads, weak self] event in
      threads.apply(feed: event)
      self?.feedArrived(event)
    }
    feedTicket = c.feed.subscribe { [store = c.store] event in
      store.apply(event)
    }
    FeedDirectory.register(c.feed, for: c.client.baseURL)
  }

  private func unfollow() {
    if let feedTicket {
      feed.unsubscribe(feedTicket)
      self.feedTicket = nil
    }
    FeedDirectory.unregister(feed)
  }

  private func checkServer() {
    Task { await refreshServer() }
  }

  private func refreshServer() async {
    await supervisor.refresh()
    if supervisor.isRunning { startFailure = nil }
  }

  private func settingsChanged(_ new: ServerConfig) {
    guard new != config else { return }
    let portChanged = new.port != config.port
    config = new
    startFailure = nil
    if portChanged {
      unfollow()
      feed.stop()
      store.stop()
      threads.stopAll()
      let c = connect(new.port)
      client = c.client
      store = c.store
      folders.connect(store: c.store, api: c.client)
      threads = c.threads
      feed = c.feed
      follow(c)
      lastConnection = .connecting
      feed.start()
      store.start()
    }
    checkServer()
  }

  private func feedArrived(_ event: FeedEvent) {
    var viewing: String?
    if case .thread(let id, _) = route { viewing = id }
    banners.handle(event, viewing: viewing)
  }

  /// Threads in flight when the feed opens, so their end gets a banner too.
  private func seedBanners() async {
    let client = client
    for status in [ThreadStatus.running, .queued] {
      if let list = try? await client.threads(status: status, limit: 100) { banners.seed(list) }
    }
  }

  private func connectionChanged(_ state: ConnectionState) {
    let previous = lastConnection
    lastConnection = state
    if state == .open { Task { await seedBanners() } }
    switch state {
    case .open where !supervisor.isRunning:
      checkServer()
    case .reconnecting where previous == .open:
      checkServer()
    default:
      break
    }
  }
}

/// The app's one `/api/feed`. `AppModel` starts and closes it. The workspace, artifacts, automations and the
/// open threads subscribe; none of them opens a second connection.
@MainActor
public final class AppFeed {
  private let source: SSEClient<FeedEvent>
  private let events: AsyncStream<SSEEvent<FeedEvent>>
  private var listeners: [UUID: @MainActor (SSEEvent<FeedEvent>) -> Void] = [:]
  private var task: Task<Void, Never>?
  /// True once the feed has been `.open`, including when it has since dropped.
  private(set) var hasOpened = false

  public init(source: SSEClient<FeedEvent>) {
    self.source = source
    events = source.events
  }

  public func start() {
    guard task == nil else { return }
    source.start()
    task = Task { [weak self, events] in
      for await event in events {
        self?.receive(event)
      }
    }
  }

  public func stop() {
    source.close()
    task?.cancel()
    task = nil
  }

  /// See `SSEClient.reconnectNow(ifQuietFor:)`.
  public func reconnectNow(ifQuietFor quiet: Duration? = nil) {
    source.reconnectNow(ifQuietFor: quiet)
  }

  @discardableResult
  func subscribe(_ handler: @escaping @MainActor (SSEEvent<FeedEvent>) -> Void) -> UUID {
    let id = UUID()
    listeners[id] = handler
    return id
  }

  func unsubscribe(_ id: UUID) {
    listeners[id] = nil
  }

  private func receive(_ event: SSEEvent<FeedEvent>) {
    if case .state(.open) = event { hasOpened = true }
    for listener in Array(listeners.values) {
      listener(event)
    }
  }
}

/// The live feed for a server, so a screen that only has the client can read the one `AppModel` opened.
@MainActor
enum FeedDirectory {
  private static var feeds: [URL: AppFeed] = [:]

  static func register(_ feed: AppFeed, for baseURL: URL) {
    feeds[baseURL] = feed
  }

  static func unregister(_ feed: AppFeed) {
    feeds = feeds.filter { $0.value !== feed }
  }

  static func feed(for baseURL: URL) -> AppFeed? {
    feeds[baseURL]
  }
}
