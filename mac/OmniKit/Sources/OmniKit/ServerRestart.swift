import Foundation
import Observation

/// What a restart needs from the outside. Fakes stand in for it in tests.
@MainActor
public protocol RestartHost: AnyObject {
  /// Why a restart can't work at all, checked before anything runs. nil when it can.
  func problemBeforeRestart() -> String?
  func runningTurns() async -> Int
  /// Rebuilds the Web UI. Returns an error message, nil on success.
  func buildWeb() async -> String?
  /// Returns an error message, nil once the server is stopped.
  func stopServer() async -> String?
  /// Returns an error message, nil once the server runs again.
  func startServer() async -> String?
}

/// Restart Server: wait until no turns run, rebuild the Web UI, stop the server, start it. It never starts
/// by itself. The wait ends only with the run, or a cancel; once the build starts it runs to the end.
@MainActor @Observable
public final class ServerRestart {
  public enum Step: Hashable, Sendable {
    case idle
    case waitingForIdle(running: Int)
    case building
    case stopping
    case starting
    case failed(String)

    public var isActive: Bool {
      switch self {
      case .idle, .failed: false
      default: true
      }
    }

    /// The line the window shows.
    public var label: String? {
      switch self {
      case .idle: nil
      case .waitingForIdle(let n): n == 1 ? "Waiting for 1 running turn to finish" : "Waiting for \(n) running turns to finish"
      case .building: "Building the Web UI"
      case .stopping: "Stopping the server"
      case .starting: "Starting the server"
      case .failed(let message): message
      }
    }
  }

  public private(set) var step = Step.idle

  @ObservationIgnored private let host: any RestartHost
  @ObservationIgnored private let ticker: Ticker
  @ObservationIgnored private let pollEvery: Duration
  @ObservationIgnored private var task: Task<Void, Never>?

  public init(host: any RestartHost, clock: any Clock<Duration> = ContinuousClock(), pollEvery: Duration = .seconds(2)) {
    self.host = host
    ticker = Ticker(clock)
    self.pollEvery = pollEvery
  }

  /// Runs to the end. A second call while one runs waits for that one.
  public func run() async {
    if let task { return await task.value }
    let task = Task { await self.sequence() }
    self.task = task
    await task.value
    self.task = nil
  }

  /// Ends the wait for idle. Does nothing once the build has started.
  public func cancel() {
    if case .waitingForIdle = step { task?.cancel() }
  }

  public func dismissFailure() {
    if case .failed = step { step = .idle }
  }

  private func sequence() async {
    if let problem = host.problemBeforeRestart() { return step = .failed(problem) }
    do {
      while true {
        try await waitForIdle()
        step = .building
        if let error = await host.buildWeb() { return step = .failed(error) }
        // The build takes a while: a turn may have started.
        if await host.runningTurns() == 0 { break }
      }
    } catch {
      return step = .idle
    }
    step = .stopping
    if let error = await host.stopServer() { return step = .failed(error) }
    step = .starting
    if let error = await host.startServer() { return step = .failed(error) }
    step = .idle
  }

  private func waitForIdle() async throws {
    while true {
      let running = await host.runningTurns()
      if running == 0 { return }
      step = .waitingForIdle(running: running)
      try await ticker.sleep(ticker.now() + pollEvery)
    }
  }
}
