import Darwin
import Foundation

/// The activity monitor (`prototypes/activity-monitor/sampler.mjs`): a small local server that samples token
/// throughput and system resources and serves a dashboard. The app starts it with the Omni server and opens the
/// dashboard in the browser.
@MainActor @Observable public final class ActivityMonitor {
  public enum State: Hashable, Sendable {
    case off
    case starting
    /// `startedByApp` is false when something already answered on the port, like a monitor started by hand.
    case running(startedByApp: Bool)
    case failed(String)
  }

  public static let defaultPort = 4791
  nonisolated static let script = "prototypes/activity-monitor/sampler.mjs"
  /// The page's `<title>`: how a probe tells the monitor from another program on the port.
  nonisolated static let title = "Omni Activity"

  public private(set) var state = State.off
  public let port: Int

  public var url: URL { URL(string: "http://127.0.0.1:\(port)/")! }
  public var isRunning: Bool {
    if case .running = state { true } else { false }
  }

  /// Where a monitor the app starts writes its output.
  public var logURL: URL { options.logURL }

  public struct Options: Sendable {
    public var launcher: ServerLauncher
    public var logURL: URL
    public var probeTimeout: Duration
    public var startTimeout: Duration
    public var stopTimeout: Duration

    public init(
      launcher: ServerLauncher = ServerLauncher(), logURL: URL = URL.libraryDirectory.appending(path: "Logs/Omni/monitor.log"),
      probeTimeout: Duration = .milliseconds(1500), startTimeout: Duration = .seconds(10), stopTimeout: Duration = .seconds(3)
    ) {
      self.launcher = launcher
      self.logURL = logURL
      self.probeTimeout = probeTimeout
      self.startTimeout = startTimeout
      self.stopTimeout = stopTimeout
    }
  }

  @ObservationIgnored private let config: @MainActor () -> ServerConfig
  @ObservationIgnored private let options: Options
  @ObservationIgnored private let session: URLSession
  @ObservationIgnored private var spawned: SpawnedServer?
  @ObservationIgnored private var task: Task<Void, Never>?

  /// - Parameter config: read at each start, for the checkout the script lives in.
  public init(port: Int = ActivityMonitor.defaultPort, config: @escaping @MainActor () -> ServerConfig, options: Options = Options()) {
    self.port = port
    self.config = config
    self.options = options
    let c = URLSessionConfiguration.ephemeral
    c.requestCachePolicy = .reloadIgnoringLocalCacheData
    c.connectionProxyDictionary = [:]
    c.timeoutIntervalForRequest = Double(options.probeTimeout.components.seconds) + Double(options.probeTimeout.components.attoseconds) / 1e18
    session = URLSession(configuration: c)
  }

  /// Attaches to a monitor that answers, else starts one. Does nothing while one is starting or running.
  public func start() {
    switch state {
    case .starting, .running: return
    case .off, .failed: break
    }
    state = .starting
    task = Task { [weak self] in await self?.run() }
  }

  /// Stops a monitor the app started. One that was already there is left alone.
  public func stop() async {
    task?.cancel()
    task = nil
    if let spawned {
      self.spawned = nil
      await ServerProcess.stop(pid: spawned.pid, pgid: spawned.pgid, grace: options.stopTimeout)
    }
    state = .off
  }

  private func run() async {
    if await answers() {
      state = .running(startedByApp: false)
      return
    }
    do {
      let launch = try await options.launcher.prepareScript(config(), script: Self.script, extra: ["MONITOR_PORT": String(port)])
      let server = try ServerProcess.spawn(launch, log: options.logURL)
      spawned = server
      let end = ContinuousClock.now + options.startTimeout
      while ContinuousClock.now < end {
        guard !Task.isCancelled else { return }
        if await answers() {
          state = .running(startedByApp: true)
          return
        }
        guard ServerProcess.isAlive(server.pid) else {
          spawned = nil
          state = .failed(Self.failure(log: options.logURL, from: server.logOffset))
          return
        }
        try? await Task.sleep(for: .milliseconds(200))
      }
      state = .failed("The activity monitor did not answer on port \(port) within \(options.startTimeout.components.seconds) seconds.")
    } catch let error as ServerStartError {
      state = .failed(error.message)
    } catch {
      state = .failed(error.localizedDescription)
    }
  }

  /// The monitor's page answers on the port.
  private func answers() async -> Bool {
    guard let (data, response) = try? await session.data(from: url), (response as? HTTPURLResponse)?.statusCode == 200 else { return false }
    return String(decoding: data.prefix(2048), as: UTF8.self).contains("<title>\(Self.title)</title>")
  }

  nonisolated static func failure(log: URL, from offset: UInt64) -> String {
    let last = ServerProcess.logTail(log, from: offset, lines: 1).first
    return "The activity monitor stopped while starting." + (last.map { " \($0)" } ?? "")
  }
}
