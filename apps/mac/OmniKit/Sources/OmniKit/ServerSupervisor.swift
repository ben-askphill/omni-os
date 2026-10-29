import Darwin
import Foundation

/// The server the app started last, kept so a later launch of the app knows it is its own.
public struct ServerRecord: Codable, Hashable, Sendable {
  public let pid: Int32
  public let pgid: Int32
  public let port: Int
  public let startedAt: Date
  public let repo: String

  public init(pid: Int32, pgid: Int32, port: Int, startedAt: Date, repo: String) {
    self.pid = pid
    self.pgid = pgid
    self.port = port
    self.startedAt = startedAt
    self.repo = repo
  }

  public static func load(from url: URL) -> ServerRecord? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? OmniJSON.decoder().decode(ServerRecord.self, from: data)
  }

  public func save(to url: URL) throws {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let e = OmniJSON.encoder()
    e.dateEncodingStrategy = .custom { date, encoder in
      var c = encoder.singleValueContainer()
      try c.encode(date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true)))
    }
    try e.encode(self).write(to: url, options: .atomic)
  }

  public static func clear(at url: URL) {
    try? FileManager.default.removeItem(at: url)
  }

  /// Its process still runs: same pid, same group, started when the record says. A pid the system gave
  /// to another program since does not pass.
  public var isRunning: Bool {
    guard ServerProcess.isAlive(pid), getpgid(pid) == pgid, let start = ServerProcess.startTime(pid) else { return false }
    return abs(start.timeIntervalSince(startedAt)) < 5
  }
}

/// Finds, starts and stops the Omni server on the port in the settings. It attaches to a server that
/// already answers there, whoever started it, once that server proves it holds this install's token, and never
/// starts a second one. A server it starts outlives the app, and the next launch knows it by its record.
/// With a remote server in the settings it only checks that one, with the token saved for it, and starts or
/// stops nothing.
@MainActor @Observable public final class ServerSupervisor {
  public enum State: Hashable, Sendable {
    case unknown
    case checking
    case notRunning
    case starting
    /// `server` is nil for servers older than #76, which do not say who they are.
    case running(startedByApp: Bool, server: ServerInfo?)
    /// An Omni on another machine answered with the token saved for it.
    case remote(host: String, server: ServerInfo?)
    case failed(message: String, logTail: [String])
    case stopping
  }

  public struct Options: Sendable {
    public static var defaultLog: URL { URL.libraryDirectory.appending(path: "Logs/Omni/server.log") }
    public static var defaultRecord: URL { URL.applicationSupportDirectory.appending(path: "Omni/server.json") }

    public var launcher: ServerLauncher
    public var logURL: URL
    public var recordURL: URL
    /// For each GET /api/status.
    public var probeTimeout: Duration
    public var startTimeout: Duration
    /// From SIGTERM to SIGKILL.
    public var stopTimeout: Duration
    /// nil for the file the server writes in its data dir (`ServerToken.file(repo:environment:)`).
    public var token: ServerToken?
    /// A remote server's token. The login Keychain by default.
    public var remoteToken: @Sendable (URL) -> String?
    /// For each GET /api/status to a remote server, which crosses the network.
    public var remoteTimeout: Duration

    public init(
      launcher: ServerLauncher = ServerLauncher(), logURL: URL = Self.defaultLog, recordURL: URL = Self.defaultRecord,
      probeTimeout: Duration = .milliseconds(1500), startTimeout: Duration = .seconds(20), stopTimeout: Duration = .seconds(8),
      token: ServerToken? = nil, remoteToken: @escaping @Sendable (URL) -> String? = { RemoteTokenStore().read($0) },
      remoteTimeout: Duration = .seconds(6)
    ) {
      self.token = token
      self.remoteToken = remoteToken
      self.remoteTimeout = remoteTimeout
      self.launcher = launcher
      self.logURL = logURL
      self.recordURL = recordURL
      self.probeTimeout = probeTimeout
      self.startTimeout = startTimeout
      self.stopTimeout = stopTimeout
    }
  }

  public private(set) var state = State.unknown
  /// The port of the last check.
  public private(set) var port: Int
  /// There is a process to stop: one the app started, or a server that says its pid.
  public private(set) var canStop = false

  public var isRunning: Bool {
    switch state {
    case .running, .remote: true
    default: false
    }
  }

  /// Where a server the app starts writes its output.
  public var logURL: URL { options.logURL }

  /// The token of the server on the configured repo and port, or the one saved for the remote server. Clients send
  /// it; the probe checks the server knows it.
  public nonisolated let token: ServerToken

  @ObservationIgnored private let config: @MainActor () -> ServerConfig
  @ObservationIgnored private let options: Options
  @ObservationIgnored private let session: URLSession
  @ObservationIgnored private let remoteSession: URLSession
  @ObservationIgnored private var target: Target?
  @ObservationIgnored private var queue: Task<Void, Never>?
  @ObservationIgnored private var watcher: (any DispatchSourceProcess)?
  @ObservationIgnored private var watched: Int32?
  @ObservationIgnored private let tokenFile: TokenLocation

  private enum Target {
    /// Started by the app: its whole group goes.
    case group(ServerRecord)
    /// Started some other way: only its own process is signalled.
    case process(Int32)
  }

  private enum Probe {
    case omni(Status)
    case nothing
    case busy(ServerStartError)
  }

  /// - Parameter config: read at each check, start and stop.
  public init(config: @escaping @MainActor () -> ServerConfig, options: Options = Options()) {
    self.config = config
    self.options = options
    port = config().port
    let location = TokenLocation()
    tokenFile = location
    location.current = Self.tokenSource(config(), options)
    let remoteToken = options.remoteToken
    token = options.token ?? ServerToken {
      switch location.current {
      case .file(let url)?: try? String(contentsOf: url, encoding: .utf8)
      case .remote(let origin)?: remoteToken(origin)
      case nil: nil
      }
    }
    session = Self.session(timeout: options.probeTimeout)
    remoteSession = Self.session(timeout: options.remoteTimeout)
  }

  private static func session(timeout: Duration) -> URLSession {
    let c = URLSessionConfiguration.ephemeral
    let seconds = Double(timeout.components.seconds) + Double(timeout.components.attoseconds) / 1e18
    c.timeoutIntervalForRequest = seconds
    c.timeoutIntervalForResource = seconds
    c.connectionProxyDictionary = [:]
    return URLSession(configuration: c)
  }

  private static func tokenSource(_ config: ServerConfig, _ options: Options) -> TokenLocation.Source {
    if let remote = config.remote { return .remote(remote) }
    return .file(ServerToken.file(repo: config.repo, environment: options.launcher.extraEnvironment))
  }

  public convenience init(settings: ServerSettings, options: Options = Options()) {
    self.init(config: { settings.config }, options: options)
  }

  isolated deinit {
    watcher?.cancel()
    session.invalidateAndCancel()
    remoteSession.invalidateAndCancel()
  }

  /// Checks what answers on the port. Only the first check shows `.checking`: after that what shows stays
  /// until the answer, so coming back to the app does not blank the screen.
  public func refresh() async {
    await serially {
      if case .unknown = self.state { self.state = .checking }
      await self.detect()
    }
  }

  /// Starts the server unless one already answers on the port.
  public func start() async {
    await serially { await self.startNow() }
  }

  /// SIGTERM, then SIGKILL after `stopTimeout`. A server the app started goes with its whole process group.
  /// - Parameter ownOnly: stop nothing but a server the app started, judged by a fresh check. For a stop the
  ///   user did not ask for on that server, like quitting: what ran when the window last looked may be gone,
  ///   and a server started by hand on the port since is not the app's to stop.
  public func stop(ownOnly: Bool = false) async {
    await serially { await self.stopNow(ownOnly: ownOnly) }
  }

  /// One operation at a time, in order.
  private func serially(_ work: @escaping @MainActor () async -> Void) async {
    let previous = queue
    let task = Task { @MainActor in
      await previous?.value
      await work()
    }
    queue = task
    await task.value
  }

  // MARK: Operations

  private func detect() async {
    let config = config()
    if let remote = config.remote { return await detectRemote(remote, port: config.port) }
    apply(await probe(config.port), port: config.port)
  }

  /// A remote server is never the app's to start or stop, so there is no target and no exit to watch.
  private func detectRemote(_ origin: URL, port: Int) async {
    tokenFile.current = .remote(origin)
    let host = origin.host() ?? origin.absoluteString
    let found = await probeRemote(origin, host: host)
    guard config().remote == origin else { return }
    self.port = port
    target = nil
    canStop = false
    watch(nil)
    switch found {
    case .success(let status): state = .remote(host: host, server: status.server)
    case .failure(let error): state = .failed(message: error.message, logTail: [])
    }
  }

  /// GET /api/status with the saved token, over TLS. No proof first: the certificate says who the host is, and
  /// the token is one Ben pasted for that host, not this Mac's own.
  private func probeRemote(_ origin: URL, host: String) async -> Result<Status, ServerStartError> {
    guard token.value != nil else { return .failure(.remoteNoToken(host: host)) }
    let client = OmniClient(baseURL: origin, token: token, transport: URLSessionTransport(session: remoteSession))
    do throws(OmniAPIError) {
      return .success(try await client.status())
    } catch {
      switch error {
      case .unreachable, .cancelled: return .failure(.remoteUnreachable(host: host))
      case .http(let status, _) where status == 401 || status == 403: return .failure(.remoteRejected(host: host))
      default: return .failure(.remoteNotOmni(host: host, detail: error.message))
      }
    }
  }

  private func apply(_ probe: Probe, port: Int) {
    self.port = port
    let record = liveRecord()
    let own = record?.port == port ? record : nil
    switch probe {
    case .omni(let status):
      let server = status.server
      if let own, server.map({ $0.pid == Int(own.pid) }) ?? true {
        state = .running(startedByApp: true, server: server)
        target = .group(own)
      } else {
        state = .running(startedByApp: false, server: server)
        target = server.flatMap { Int32(exactly: $0.pid) }.flatMap { ServerProcess.name($0)?.hasPrefix("node") == true ? .process($0) : nil }
      }
    case .nothing:
      if let own {
        state = .failed(message: ServerStartError.notAnswering(port: port).message, logTail: [])
        target = .group(own)
      } else {
        state = .notRunning
        target = nil
      }
    case .busy(let error):
      if let own, case .portInUse = error {
        state = .failed(message: ServerStartError.notAnswering(port: port).message, logTail: [])
        target = .group(own)
      } else {
        state = .failed(message: error.message, logTail: [])
        target = nil
      }
    }
    canStop = target != nil
    switch target {
    case .group(let r): watch(r.pid)
    case .process(let pid): watch(pid)
    case nil: watch(nil)
    }
  }

  private func startNow() async {
    if let remote = config().remote { return await detectRemote(remote, port: config().port) }
    if !isRunning { state = .starting }
    let config = config()
    let found = await probe(config.port)
    guard case .nothing = found else { return apply(found, port: config.port) }
    // One server per app: a second would fight the first for the data folder, and the record keeps one.
    if let record = liveRecord() {
      guard record.port != config.port else { return apply(found, port: config.port) }
      port = config.port
      return fail(.startedElsewhere(port: record.port))
    }
    port = config.port
    state = .starting

    let spawned: SpawnedServer
    do throws(ServerStartError) {
      spawned = try ServerProcess.spawn(try await options.launcher.prepare(config), log: options.logURL)
    } catch {
      return fail(error)
    }
    let record = ServerRecord(pid: spawned.pid, pgid: spawned.pgid, port: config.port, startedAt: .now, repo: config.repo.path)
    try? record.save(to: options.recordURL)

    let deadline = ContinuousClock.now + options.startTimeout
    while true {
      if Spawn.hasExited(spawned.pid) {
        let code = Spawn.reap(spawned.pid)
        ServerRecord.clear(at: options.recordURL)
        return fail(.exited(code: code), tail: ServerProcess.logTail(options.logURL, from: spawned.logOffset))
      }
      // A server that says who it is must be this one; an older one can't say.
      if case .omni(let status) = await probe(config.port), status.server.map({ $0.pid == Int(spawned.pid) }) ?? true {
        state = .running(startedByApp: true, server: status.server)
        target = .group(record)
        canStop = true
        watch(spawned.pid)
        return
      }
      if ContinuousClock.now >= deadline {
        await ServerProcess.stop(pid: spawned.pid, pgid: spawned.pgid, grace: .seconds(2))
        ServerRecord.clear(at: options.recordURL)
        let seconds = Int(options.startTimeout.components.seconds)
        return fail(.noAnswer(seconds: seconds), tail: ServerProcess.logTail(options.logURL, from: spawned.logOffset))
      }
      try? await Task.sleep(for: .milliseconds(200))
    }
  }

  private func stopNow(ownOnly: Bool) async {
    await detect()
    guard config().remote == nil else { return }
    guard let target else { return }
    if ownOnly, case .process = target { return }
    state = .stopping
    watch(nil)
    switch target {
    case .group(let r):
      await ServerProcess.stop(pid: r.pid, pgid: r.pgid, grace: options.stopTimeout)
      ServerRecord.clear(at: options.recordURL)
    case .process(let pid):
      kill(pid, SIGTERM)
      if !(await ServerProcess.waitForExit(pid, within: options.stopTimeout)) {
        kill(pid, SIGKILL)
        _ = await ServerProcess.waitForExit(pid, within: .seconds(2))
      }
    }
    self.target = nil
    await detect()
  }

  private func fail(_ error: ServerStartError, tail: [String] = []) {
    state = .failed(message: error.message, logTail: tail)
    target = nil
    canStop = false
    watch(nil)
  }

  // MARK: Checks

  /// The record, when its process still runs. A record of a process that is gone is removed.
  private func liveRecord() -> ServerRecord? {
    guard let record = ServerRecord.load(from: options.recordURL) else { return nil }
    guard record.isRunning else {
      ServerRecord.clear(at: options.recordURL)
      return nil
    }
    return record
  }

  /// Omni, once the listener proves it holds the token: the HMAC of a fresh nonce, so a program squatting on the
  /// port learns nothing it could use. Only then does the token go to it, for /api/status.
  private func probe(_ port: Int) async -> Probe {
    tokenFile.current = Self.tokenSource(config(), options)
    let anonymous = OmniClient(port: port, transport: URLSessionTransport(session: session))
    let client = OmniClient(port: port, token: token, transport: URLSessionTransport(session: session))
    do throws(OmniAPIError) {
      let nonce = ServerToken.nonce()
      let answer: ProofAnswer
      do throws(OmniAPIError) {
        answer = try await anonymous.send("GET", "/api/auth/proof", query: [("nonce", nonce)])
      } catch {
        switch error {
        case .unreachable, .cancelled: throw error
        default: return .busy(.notThisInstall(port: port))
        }
      }
      guard let t = token.value, answer.proof == ServerToken.proof(token: t, port: port, nonce: nonce) else { return .busy(.notThisInstall(port: port)) }
      return .omni(try await client.status())
    } catch {
      switch error {
      case .unreachable: return Self.portIsTaken(port) ? .busy(.portInUse(port: port)) : .nothing
      case .cancelled: return .nothing
      default: return .busy(.notOmni(port: port, detail: error.message))
      }
    }
  }

  private struct ProofAnswer: Decodable { let proof: String }

  /// Something holds the port on 127.0.0.1, the way the server would bind it.
  private static func portIsTaken(_ port: Int) -> Bool {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { return false }
    defer { close(fd) }
    var yes: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    addr.sin_port = in_port_t(UInt16(clamping: port).bigEndian)
    let rc = withUnsafePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
    }
    return rc != 0 && errno == EADDRINUSE
  }

  // MARK: Exit watch

  /// Checks again when the server's process ends.
  private func watch(_ pid: Int32?) {
    guard pid != watched else { return }
    watcher?.cancel()
    watcher = nil
    watched = pid
    guard let pid else { return }
    let source = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: .main)
    source.setEventHandler { [weak self] in
      MainActor.assumeIsolated { self?.exited(pid) }
    }
    source.resume()
    watcher = source
    if !ServerProcess.isAlive(pid) { exited(pid) }
  }

  private func exited(_ pid: Int32) {
    guard watched == pid else { return }
    watch(nil)
    Task { await self.refresh() }
  }
}
