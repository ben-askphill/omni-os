import Darwin
import Foundation
import Observation

/// Runs a program to its end with its output appended to a log. Its own session, so it outlives the app.
enum ToolRun {
  struct Result: Sendable {
    /// nil when a signal ended it, or it timed out.
    let code: Int32?
    let tail: [String]
  }

  static func run(
    _ executable: String, _ arguments: [String], environment: [String: String], directory: URL, log: URL, timeout: Duration
  ) async -> Result? {
    try? FileManager.default.createDirectory(at: log.deletingLastPathComponent(), withIntermediateDirectories: true)
    let size = ((try? FileManager.default.attributesOfItem(atPath: log.path)[.size]) as? NSNumber)?.uint64Value ?? 0
    let pid: pid_t
    do {
      pid = try Spawn.run(
        executable, arguments, environment: environment, directory: directory.path, stdout: .append(log.path), stderr: .stdout
      )
    } catch {
      return nil
    }
    let deadline = ContinuousClock.now + timeout
    while !Spawn.hasExited(pid) {
      if ContinuousClock.now >= deadline {
        killpg(pid, SIGKILL)
        Spawn.reap(pid)
        return Result(code: nil, tail: ServerProcess.logTail(log, from: size, lines: 12))
      }
      try? await Task.sleep(for: .milliseconds(100))
    }
    return Result(code: Spawn.reap(pid), tail: ServerProcess.logTail(log, from: size, lines: 12))
  }
}

public enum AppRebuild: Hashable, Sendable {
  case idle
  case building
  case failed(String)
}

/// Notices that the server or the app is behind main, and the two things Ben can click about it. Nothing
/// here runs without a click.
@MainActor @Observable
public final class Updater {
  public private(set) var notices = UpdateNotices()
  public private(set) var rebuild = AppRebuild.idle
  @ObservationIgnored public private(set) var restart: ServerRestart!

  public static var webBuildLog: URL { URL.libraryDirectory.appending(path: "Logs/Omni/web-build.log") }
  public static var appRebuildLog: URL { URL.libraryDirectory.appending(path: "Logs/Omni/app-rebuild.log") }

  @ObservationIgnored private let model: AppModel
  @ObservationIgnored private let appCommit: String?
  @ObservationIgnored private var watcher: Task<Void, Never>?

  public init(model: AppModel, appCommit: String? = AppBuild.commit) {
    self.model = model
    self.appCommit = appCommit
    restart = ServerRestart(host: Host(model: model))
  }

  isolated deinit {
    watcher?.cancel()
  }

  /// Checks now and again whenever the server's state changes (a restart shows the new commit).
  public func start() {
    guard watcher == nil else { return }
    watcher = Task { [weak self] in
      guard let supervisor = self?.model.supervisor else { return }
      for await _ in Observations({ supervisor.state }) {
        guard let self else { return }
        await self.check()
      }
    }
  }

  public func check() async {
    let repo = model.settings.config.repo
    let main = await RepoHead.main(repo: repo)
    var server: String?
    if case .running(_, let info) = model.supervisor.state { server = info?.gitHead }
    notices = UpdateCheck.notices(serverHead: server, appCommit: appCommit, mainHead: main)
  }

  /// Restart stops a server that was started outside the app: the window says so before the click counts.
  public var restartStopsOutsideServer: Bool {
    if case .running(false, _) = model.supervisor.state { true } else { false }
  }

  public func restartServer() async {
    await restart.run()
    await check()
  }

  public func dismissRebuildFailure() {
    if case .failed = rebuild { rebuild = .idle }
  }

  /// Runs `scripts/build-mac.sh` from the repo. It quits the installed app, replaces it and opens the new one,
  /// so when this app is the installed copy the script ends it. Otherwise the new copy opens beside it.
  public func rebuildApp() async {
    guard rebuild != .building else { return }
    let repo = model.settings.config.repo
    let script = repo.appending(path: "scripts/build-mac.sh")
    guard FileManager.default.fileExists(atPath: script.path) else {
      return rebuild = .failed("There is no scripts/build-mac.sh in \(repo.path).")
    }
    rebuild = .building
    let path = await LoginShell().path() ?? ServerEnvironment.fallbackPath()
    var env = ServerEnvironment.minimal(ProcessInfo.processInfo.environment)
    env["PATH"] = path
    let run = await ToolRun.run(
      "/bin/bash", [script.path], environment: env, directory: repo, log: Self.appRebuildLog, timeout: .seconds(30 * 60)
    )
    guard let run, run.code == 0 else {
      let line = run?.tail.last { $0.hasPrefix("build-mac:") } ?? run?.tail.last { !$0.isEmpty }
      return rebuild = .failed("The rebuild failed. " + (line ?? "See the log."))
    }
    rebuild = .idle
    await check()
  }

  @MainActor
  private final class Host: RestartHost {
    weak var model: AppModel?

    init(model: AppModel) { self.model = model }

    private var viteBinary: URL? {
      model?.settings.config.repo.appending(path: "node_modules/vite/bin/vite.js")
    }

    func problemBeforeRestart() -> String? {
      guard let model else { return "The app is closing." }
      guard model.supervisor.canStop else { return "This server can't be stopped from the app." }
      guard let vite = viteBinary, FileManager.default.fileExists(atPath: vite.path) else {
        return "The Web UI can't be built. Run npm install in the repo first."
      }
      return nil
    }

    func runningTurns() async -> Int {
      guard let model else { return 0 }
      if let status = try? await model.client.status() { return status.running }
      return model.store.status?.running ?? 0
    }

    func buildWeb() async -> String? {
      guard let model, let vite = viteBinary else { return "The app is closing." }
      let launch: ServerLaunch
      do throws(ServerStartError) {
        launch = try await ServerLauncher().prepare(model.settings.config)
      } catch {
        return error.message
      }
      let run = await ToolRun.run(
        launch.executable.path, [vite.path, "build"], environment: launch.environment, directory: launch.directory,
        log: Updater.webBuildLog, timeout: .seconds(300)
      )
      if let run, run.code == 0 { return nil }
      let line = run?.tail.last { !$0.isEmpty }
      return "The Web UI build failed." + (line.map { " \($0)" } ?? "")
    }

    func stopServer() async -> String? {
      guard let model else { return "The app is closing." }
      await model.stopServer()
      if case .notRunning = model.supervisor.state { return nil }
      return "The server did not stop."
    }

    func startServer() async -> String? {
      guard let model else { return "The app is closing." }
      await model.startServer()
      if model.supervisor.isRunning { return nil }
      return model.startFailure?.message ?? "The server did not start."
    }
  }
}

// MARK: Quit

extension AppModel {
  public var serverStartedByApp: Bool {
    if case .running(true, _) = supervisor.state { true } else { false }
  }

  /// Ask or quit, from a fresh count of running turns. The count comes from the server, so it is current even
  /// when the feed is late; a server that does not answer in 3s falls back to the last count the feed gave.
  public func quitDecision() async -> QuitRules.Decision {
    var running = 0
    if supervisor.isRunning {
      let client = client
      let fresh = await withTaskGroup(of: Int?.self) { group in
        group.addTask { try? await client.status().running }
        group.addTask {
          try? await Task.sleep(for: .seconds(3))
          return nil
        }
        let first = await group.next() ?? nil
        group.cancelAll()
        return first
      }
      running = fresh ?? store.status?.running ?? 0
    }
    return QuitRules.decide(runningTurns: running, serverStartedByApp: serverStartedByApp)
  }

  /// Interrupts the turns (queued first, so none starts in between), then stops the server.
  public func prepareToQuit(interruptTurns: Bool, stopServer: Bool) async {
    if interruptTurns {
      let client = client
      var ids: [String] = []
      for status in [ThreadStatus.queued, .running] {
        ids += ((try? await client.threads(status: status, limit: 200)) ?? []).map(\.id)
      }
      await withTaskGroup(of: Void.self) { group in
        for id in ids { group.addTask { _ = try? await client.stopThread(id) } }
      }
    }
    if stopServer { await self.stopServer() }
  }
}
