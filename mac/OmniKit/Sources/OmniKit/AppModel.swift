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

/// The app's one connection to Omni: settings, the supervisor, and a client and workspace store for the
/// port in the settings. A port change swaps the client and store; any settings change checks again.
/// The feed dropping or opening checks the server again, so the window follows a server that was killed
/// or started somewhere else.
@MainActor @Observable
public final class AppModel {
  public struct Connection {
    public let client: OmniClient
    public let store: WorkspaceStore
    public let threads: ThreadStoreRegistry

    /// - Parameter threads: the stores for open threads, on `client` by default.
    @MainActor public init(client: OmniClient, store: WorkspaceStore, threads: ThreadStoreRegistry? = nil) {
      self.client = client
      self.store = store
      self.threads = threads ?? ThreadStoreRegistry(client: client)
    }
  }

  public let settings: ServerSettings
  public let supervisor: ServerSupervisor
  public private(set) var client: OmniClient
  public private(set) var store: WorkspaceStore
  /// The open threads' stores, fed from `store`'s feed. Swapped with it on a port change.
  public private(set) var threads: ThreadStoreRegistry
  public var route = Route.home {
    didSet { shell.history.visit(route) }
  }
  /// History, the Go to palette and composer focus.
  public let shell = ShellState()
  /// The tab the Settings window shows.
  public var settingsTab = SettingsTab.connection
  /// The last start that failed, until the server runs, Start is pressed again or the settings change.
  public private(set) var startFailure: StartFailure?

  @ObservationIgnored private let connect: @MainActor (_ port: Int) -> Connection
  @ObservationIgnored private var config: ServerConfig
  @ObservationIgnored private var lastConnection = ConnectionState.connecting
  @ObservationIgnored private var watchers: [Task<Void, Never>] = []
  @ObservationIgnored private var launched = false

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
    threads = c.threads
    follow(c)
  }

  isolated deinit {
    for w in watchers { w.cancel() }
    store.stop()
  }

  /// A client with its own ephemeral session, so nothing is cached or proxied, and a store on its feed.
  public static func liveConnection(port: Int) -> Connection {
    let c = URLSessionConfiguration.ephemeral
    c.requestCachePolicy = .reloadIgnoringLocalCacheData
    c.connectionProxyDictionary = [:]
    let client = OmniClient(port: port, transport: URLSessionTransport(session: URLSession(configuration: c)))
    return Connection(client: client, store: WorkspaceStore(client: client))
  }

  /// Opens the feed, checks the server and starts following the settings. Once.
  public func launch() {
    guard !launched else { return }
    launched = true
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

  /// The window title: the thread's own on a thread, else the route's.
  public var title: String {
    guard serverScreen == nil else { return "Omni" }
    if case .thread(let id, _) = route, let t = threads.store(id)?.thread { return t.title }
    return route.title { store.channel($0)?.name }
  }

  /// The thread on screen as Markdown, for Copy Thread as Markdown. nil until it loads.
  public var openThreadMarkdown: String? {
    guard case .thread(let id, _) = route, let s = threads.store(id), let t = s.thread, s.loadState == .loaded else { return nil }
    return TranscriptMarkdown.thread(title: t.title, items: s.transcript.items, cwd: s.cwd)
  }

  // MARK: Actions

  /// Starts the server, or attaches to one that answers, then reconnects the feed without waiting out its backoff.
  public func startServer() async {
    startFailure = nil
    await supervisor.start()
    switch supervisor.state {
    case .failed(let message, let tail): startFailure = StartFailure(message: message, logTail: tail)
    case .running: store.reconnectNow()
    default: break
    }
  }

  public func stopServer() async {
    await supervisor.stop()
  }

  /// Checks the port again and retries the feed now.
  public func checkAgain() async {
    store.reconnectNow()
    await refreshServer()
  }

  /// The app came to the front: a feed quiet for longer than the server's ping interval is likely dead.
  public func didBecomeActive() {
    store.reconnectNow(ifQuietFor: .seconds(25))
    checkServer()
  }

  /// The Mac woke from sleep. Connections from before rarely survive it.
  public func didWake() {
    store.reconnectNow()
    checkServer()
  }

  public func networkChanged() {
    store.reconnectNow()
  }

  // MARK: Following changes

  private func follow(_ c: Connection) {
    c.store.onFeed = { [threads = c.threads] in threads.apply(feed: $0) }
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
      store.stop()
      let c = connect(new.port)
      client = c.client
      store = c.store
      threads = c.threads
      follow(c)
      lastConnection = .connecting
      store.start()
    }
    checkServer()
  }

  private func connectionChanged(_ state: ConnectionState) {
    let previous = lastConnection
    lastConnection = state
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
