import Darwin
import Foundation
import Testing
import OmniKit

/// This checkout: the tests boot its server.
private let repoRoot = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent().deletingLastPathComponent()

private let loginPath = "/usr/bin:/bin:/usr/sbin:/sbin"

/// A throwaway setup for one supervisor test: its own port, data, log and record, the fake claude CLI, and an
/// app environment with a key in it that must never reach the server.
@MainActor
private struct Rig {
  var dir = TempDir("supervisor")
  var port = freePort()
  var repo = repoRoot
  var node: URL?
  var startTimeout: Duration = .seconds(40)

  var log: URL { dir.path("logs/server.log") }
  var record: URL { dir.path("support/server.json") }
  var dataDir: URL { dir.path("data") }

  var config: ServerConfig { ServerConfig(port: port, repo: repo, node: node) }

  var launcher: ServerLauncher {
    try? FileManager.default.createDirectory(at: dir.path("tmp"), withIntermediateDirectories: true)
    return ServerLauncher(
      loginShell: LoginShell(executable: fakeLoginShell(in: dir, path: loginPath)),
      appEnvironment: [
        "HOME": NSHomeDirectory(), "USER": NSUserName(), "LOGNAME": NSUserName(), "SHELL": "/bin/zsh",
        "TMPDIR": dir.path("tmp").path, "LANG": "en_GB.UTF-8", "PATH": "/usr/bin:/bin",
        "ANTHROPIC_API_KEY": "sk-ant-from-the-app", "XPC_SERVICE_NAME": "application.com.omni-os.mac",
      ],
      extraEnvironment: [
        "OMNI_DATA_DIR": dataDir.path,
        "OMNI_CLAUDE_BIN": repoRoot.appending(path: "tests/fixtures/fake-claude.mjs").path,
        "OMNI_CODEX_BIN": dir.path("none").path, "OMNI_CURSOR_BIN": dir.path("none").path,
        "OMNI_BRAIN_DIR": dir.path("brain").path, "OMNI_WEB_DIST": dir.path("none").path,
        "OMNI_BROWSER": "0", "OMNI_HOST": "127.0.0.1",
      ]
    )
  }

  func supervisor(record: URL? = nil) -> ServerSupervisor {
    let config = self.config
    return ServerSupervisor(
      config: { config },
      options: .init(
        launcher: launcher, logURL: log, recordURL: record ?? self.record, probeTimeout: .milliseconds(500),
        startTimeout: startTimeout
      )
    )
  }

  func starts() -> Int { dir.read("logs/server.log").components(separatedBy: "[omni-app]").count - 1 }

  /// The pid a fake server wrote to `fake.pid`, which is its pgid too.
  var fakePid: Int32? { Int32(dir.read("fake.pid").trimmingCharacters(in: .whitespacesAndNewlines)) }

  /// Kills what the app recorded and the fake in `fake.pid` if they still run, then removes the folder. The
  /// code under test clears the record, so a fake a broken stop left running is only found by its pid file.
  func cleanUp() {
    if let r = ServerRecord.load(from: record), processAlive(r.pid), getpgid(r.pid) == r.pgid { killGroup(r.pgid) }
    if let pid = fakePid, processAlive(pid), getpgid(pid) == pid { killGroup(pid) }
    dir.remove()
  }
}

/// The Node that runs the real server, for fakes that need a real one.
private func realNode() async throws -> URL {
  try await NodeResolver().resolve(path: loginPath).binary
}

/// A Node stand-in that serves /api/status the way servers before #76 did, with no `server` object.
private func oldServer(in dir: TempDir, node: URL) -> URL {
  let js = """
    require('http').createServer((q, s) => { s.setHeader('content-type', 'application/json'); \
    s.end(JSON.stringify({ usage: {}, slots: {}, running: 0, queued: 0, maxConcurrent: 4, maxUploadMb: 25 })) })\
    .listen(+process.env.OMNI_PORT, '127.0.0.1', () => console.log('old server up'))
    """
  return dir.script("old/node", """
    if [ "$1" = "-v" ]; then exec '\(node.path)' -v; fi
    exec '\(node.path)' -e "\(js.replacingOccurrences(of: "\"", with: "\\\""))"
    """)
}

private func portIsFree(_ port: Int) -> Bool {
  let fd = socket(AF_INET, SOCK_STREAM, 0)
  defer { close(fd) }
  var yes: Int32 = 1
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
  var addr = sockaddr_in()
  addr.sin_family = sa_family_t(AF_INET)
  addr.sin_addr.s_addr = inet_addr("127.0.0.1")
  addr.sin_port = in_port_t(UInt16(port).bigEndian)
  return withUnsafePointer(to: &addr) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0 }
  }
}

extension ServerSupervisor.State {
  fileprivate var running: (startedByApp: Bool, server: ServerInfo?)? {
    if case .running(let byApp, let server) = self { (byApp, server) } else { nil }
  }
}

/// Real processes: the server from this checkout on a free port, with the fake claude CLI and a throwaway
/// data folder. Set OMNI_SKIP_SUPERVISOR_TESTS=1 to leave them out.
@MainActor
@Suite(.serialized, .enabled(if: ProcessInfo.processInfo.environment["OMNI_SKIP_SUPERVISOR_TESTS"] == nil))
struct ServerSupervisorTests {
  @Test func startsTheServerWhenNothingAnswers() async throws {
    let rig = Rig()
    defer { rig.cleanUp() }
    let supervisor = rig.supervisor()
    #expect(supervisor.state == .unknown)
    await supervisor.refresh()
    #expect(supervisor.state == .notRunning)

    await supervisor.start()
    let running = try #require(supervisor.state.running, "\(supervisor.state)")
    #expect(running.startedByApp)
    let server = try #require(running.server)
    #expect(server.port == rig.port)
    #expect(server.root == rig.repo.path)
    #expect(realPath(URL(filePath: server.dataDir)) == realPath(rig.dataDir))

    let record = try #require(ServerRecord.load(from: rig.record))
    #expect(Int(record.pid) == server.pid)
    #expect(record.pgid == record.pid)
    #expect(getpgid(record.pid) == record.pid)
    #expect(record.port == rig.port)
    #expect(record.repo == rig.repo.path)
    #expect(abs(record.startedAt.timeIntervalSinceNow) < 60)
    #expect(rig.dir.read("logs/server.log").contains("[omni] listening on http://127.0.0.1:\(rig.port)"))
  }

  @Test func theServerGetsOnlyTheMinimalEnvironmentAndPath() async throws {
    let rig = Rig()
    defer { rig.cleanUp() }
    let supervisor = rig.supervisor()
    await supervisor.start()
    let server = try #require(supervisor.state.running?.server, "\(supervisor.state)")
    let node = try await realNode()

    let env = environmentOf(Int32(server.pid))
    #expect(env.contains("PATH=\(node.deletingLastPathComponent().path):\(loginPath) "))
    #expect(env.contains("NODE_ENV=production"))
    #expect(env.contains("OMNI_PORT=\(rig.port)"))
    #expect(env.contains("LANG=en_GB.UTF-8"))
    #expect(!env.contains("API_KEY"))
    #expect(!env.contains("sk-ant"))
    #expect(!env.contains("XPC_SERVICE_NAME"))
  }

  @Test func aSecondSupervisorAttachesInsteadOfStartingAnother() async throws {
    let rig = Rig()
    defer { rig.cleanUp() }
    let first = rig.supervisor()
    await first.start()
    let pid = try #require(first.state.running?.server?.pid, "\(first.state)")
    let record = try #require(ServerRecord.load(from: rig.record))

    // The app again, after a relaunch: same record.
    let again = rig.supervisor()
    await again.start()
    #expect(again.state.running?.startedByApp == true)
    #expect(again.state.running?.server?.pid == pid)
    #expect(ServerRecord.load(from: rig.record) == record)
    #expect(rig.starts() == 1)

    // Someone else's record: attached, not started by this app.
    let other = rig.supervisor(record: rig.dir.path("other/server.json"))
    await other.start()
    #expect(other.state.running?.startedByApp == false)
    #expect(other.state.running?.server?.pid == pid)
    #expect(rig.starts() == 1)
    #expect(ServerRecord.load(from: rig.dir.path("other/server.json")) == nil)
  }

  @Test func aServerLeftInTheBackgroundIsTheAppsOwnOnTheNextLaunch() async throws {
    let rig = Rig()
    defer { rig.cleanUp() }
    var first: ServerSupervisor? = rig.supervisor()
    await first?.start()
    let pid = try #require(first?.state.running?.server?.pid, "\(String(describing: first?.state))")
    // Quit with Keep server running: the app lets go and does nothing to the server.
    first = nil

    let next = rig.supervisor()
    await next.refresh()
    #expect(next.state.running?.startedByApp == true, "\(next.state)")
    #expect(next.state.running?.server?.pid == pid)
    #expect(next.canStop)
    #expect(rig.starts() == 1)

    // Quitting again with nothing running stops it, and the port is free.
    await next.stop()
    #expect(next.state == .notRunning)
    #expect(!processAlive(Int32(pid)))
  }

  @Test func twoStartsAtOnceStartOneServer() async throws {
    let rig = Rig()
    defer { rig.cleanUp() }
    let supervisor = rig.supervisor()
    async let a: Void = supervisor.start()
    async let b: Void = supervisor.start()
    _ = await (a, b)
    #expect(supervisor.state.running?.startedByApp == true, "\(supervisor.state)")
    #expect(rig.starts() == 1)
  }

  @Test func stopsWithSIGTERMAndFreesThePort() async throws {
    let rig = Rig()
    defer { rig.cleanUp() }
    let supervisor = rig.supervisor()
    await supervisor.start()
    let pid = try #require(supervisor.state.running?.server?.pid, "\(supervisor.state)")
    #expect(supervisor.canStop)

    let began = ContinuousClock.now
    await supervisor.stop()
    #expect(ContinuousClock.now - began < .seconds(8))
    #expect(supervisor.state == .notRunning)
    #expect(!processAlive(Int32(pid)))
    #expect(portIsFree(rig.port))
    #expect(ServerRecord.load(from: rig.record) == nil)
    #expect(rig.dir.read("logs/server.log").contains("SIGTERM, closing live sessions"))
  }

  @Test func stopsAServerItDidNotStart() async throws {
    let rig = Rig()
    defer { rig.cleanUp() }
    await rig.supervisor().start()
    let otherRecord = rig.dir.path("other/server.json")
    let other = rig.supervisor(record: otherRecord)
    await other.refresh()
    let pid = try #require(other.state.running?.server?.pid, "\(other.state)")
    #expect(other.state.running?.startedByApp == false)
    #expect(other.canStop)

    let began = ContinuousClock.now
    await other.stop()
    #expect(ContinuousClock.now - began < .seconds(8))
    #expect(other.state == .notRunning)
    #expect(!processAlive(Int32(pid)))
    #expect(portIsFree(rig.port))
    #expect(rig.dir.read("logs/server.log").contains("SIGTERM, closing live sessions"))
  }

  @Test func aStopForOwnServersOnlyLeavesAServerItDidNotStart() async throws {
    let rig = Rig()
    defer { rig.cleanUp() }
    await rig.supervisor().start()
    let other = rig.supervisor(record: rig.dir.path("other/server.json"))
    await other.refresh()
    let pid = try #require(other.state.running?.server?.pid, "\(other.state)")
    #expect(other.state.running?.startedByApp == false)

    await other.stop(ownOnly: true)
    #expect(processAlive(Int32(pid)))
    #expect(other.state.running?.startedByApp == false)
    #expect(!portIsFree(rig.port))
  }

  @Test func aPortHeldByAHungProgramFailsClearly() async throws {
    let listener = SilentListener()
    let rig = Rig(port: listener.port)
    defer {
      listener.close()
      rig.cleanUp()
    }
    let supervisor = rig.supervisor()
    await supervisor.start()
    #expect(supervisor.state == .failed(message: ServerStartError.portInUse(port: listener.port).message, logTail: []))
    #expect(ServerRecord.load(from: rig.record) == nil)
    #expect(rig.starts() == 0)
  }

  @Test func onlyTheFirstCheckShowsChecking() async throws {
    let listener = SilentListener()
    let rig = Rig(port: listener.port)
    defer {
      listener.close()
      rig.cleanUp()
    }
    let supervisor = rig.supervisor()
    let first = Task { await supervisor.refresh() }
    try await waitFor("checking") { supervisor.state == .checking }
    await first.value
    let failed = ServerSupervisor.State.failed(message: ServerStartError.portInUse(port: listener.port).message, logTail: [])
    #expect(supervisor.state == failed)

    // Coming back to the app checks again. What it shows stays while the probe waits out its timeout.
    let again = Task { await supervisor.refresh() }
    var seen: [ServerSupervisor.State] = []
    for _ in 0..<5 {
      try await Task.sleep(for: .milliseconds(50))
      seen.append(supervisor.state)
    }
    await again.value
    #expect(seen.allSatisfy { $0 == failed })
    #expect(supervisor.state == failed)
  }

  @Test func anotherProgramAnsweringOnThePortFailsClearly() async throws {
    let web = HTTPResponder(contentType: "text/html", body: "<html>hello</html>")
    let rig = Rig(port: web.port)
    defer {
      web.close()
      rig.cleanUp()
    }
    let supervisor = rig.supervisor()
    await supervisor.start()
    guard case .failed(let message, []) = supervisor.state else {
      Issue.record("not failed: \(supervisor.state)")
      return
    }
    #expect(message.hasPrefix("Port \(web.port) answers, but not as an Omni server"))
    #expect(rig.starts() == 0)
  }

  @Test func aServerThatExitsWhileStartingShowsTheEndOfTheLog() async throws {
    var rig = Rig()
    defer { rig.cleanUp() }
    rig.node = fakeNode(in: rig.dir, "bin/node", version: "v24.9.0", body: """
      i=1; while [ $i -le 50 ]; do echo "line $i"; i=$((i + 1)); done
      echo "boom" >&2
      exit 3
      """)
    let supervisor = rig.supervisor()
    await supervisor.start()
    let tail = (1...50).map { "line \($0)" }.suffix(39) + ["boom"]
    #expect(supervisor.state == .failed(message: ServerStartError.exited(code: 3).message, logTail: Array(tail)))
    #expect(ServerRecord.load(from: rig.record) == nil)
  }

  @Test func aServerThatNeverAnswersIsStoppedAtTheTimeout() async throws {
    var rig = Rig()
    defer { rig.cleanUp() }
    let pidFile = rig.dir.path("fake.pid").path
    rig.node = fakeNode(in: rig.dir, "bin/node", body: """
      echo $$ > '\(pidFile)'
      echo "warming up"
      trap '' TERM
      while :; do sleep 1; done
      """)
    rig.startTimeout = .seconds(2)
    let supervisor = rig.supervisor()
    await supervisor.start()
    #expect(supervisor.state == .failed(message: ServerStartError.noAnswer(seconds: 2).message, logTail: ["warming up"]))
    let pid = try #require(rig.fakePid)
    #expect(!processAlive(pid))
    #expect(ServerRecord.load(from: rig.record) == nil)
  }

  @Test func aServerThatIsStoppedWhileStartingIsStoppedAtTheTimeout() async throws {
    var rig = Rig()
    defer { rig.cleanUp() }
    let pidFile = rig.dir.path("fake.pid").path
    rig.node = fakeNode(in: rig.dir, "bin/node", body: """
      echo $$ > '\(pidFile)'
      echo "booting"
      kill -STOP $$
      """)
    rig.startTimeout = .seconds(2)
    // A stopped server must not read as exited: its reap would wait on the main actor until it runs again.
    // Should that happen, this ends the wait so the test fails instead of hanging.
    let watchdog = DispatchWorkItem { @Sendable [dir = rig.dir] in
      if let pid = Int32(dir.read("fake.pid").trimmingCharacters(in: .whitespacesAndNewlines)) { kill(pid, SIGKILL) }
    }
    DispatchQueue.global().asyncAfter(deadline: .now() + 10, execute: watchdog)
    defer { watchdog.cancel() }

    let supervisor = rig.supervisor()
    await supervisor.start()
    #expect(supervisor.state == .failed(message: ServerStartError.noAnswer(seconds: 2).message, logTail: ["booting"]))
    let pid = try #require(rig.fakePid)
    #expect(!processAlive(pid))
    #expect(ServerRecord.load(from: rig.record) == nil)
  }

  @Test func aRecordOfAServerThatIsGoneIsCleared() async throws {
    let rig = Rig()
    defer { rig.cleanUp() }
    // A pid from a process that already ended.
    let p = Process()
    p.executableURL = URL(filePath: "/usr/bin/true")
    try p.run()
    p.waitUntilExit()
    let stale = ServerRecord(pid: p.processIdentifier, pgid: p.processIdentifier, port: rig.port, startedAt: .now, repo: rig.repo.path)
    try stale.save(to: rig.record)

    let supervisor = rig.supervisor()
    await supervisor.refresh()
    #expect(supervisor.state == .notRunning)
    #expect(ServerRecord.load(from: rig.record) == nil)
  }

  @Test func noticesWhenTheServerDies() async throws {
    let rig = Rig()
    defer { rig.cleanUp() }
    let supervisor = rig.supervisor()
    await supervisor.start()
    let pid = try #require(supervisor.state.running?.server?.pid, "\(supervisor.state)")
    kill(Int32(pid), SIGKILL)
    try await waitFor("not running", within: .seconds(5)) { supervisor.state == .notRunning }
    #expect(ServerRecord.load(from: rig.record) == nil)
  }

  @Test func anOlderServerWithoutTheServerObjectStillCounts() async throws {
    let status = #"{"usage":{},"slots":{},"running":0,"queued":0,"maxConcurrent":4,"maxUploadMb":25}"#
    let old = HTTPResponder(contentType: "application/json", body: status)
    let rig = Rig(port: old.port)
    defer {
      old.close()
      rig.cleanUp()
    }
    let supervisor = rig.supervisor()
    await supervisor.start()
    #expect(supervisor.state == .running(startedByApp: false, server: nil))
    // Nothing says which process it is, so there is nothing to stop.
    #expect(!supervisor.canStop)
    await supervisor.stop()
    #expect(supervisor.state == .running(startedByApp: false, server: nil))
    #expect(rig.starts() == 0)
  }

  @Test func aPidThatCannotBeAProcessIsNotStopped() async throws {
    let server = #"{"version":"0.1.0","pid":4294967296,"root":"/x","dataDir":"/x/data","startedAt":"2026-09-28T10:00:00.000Z","port":1}"#
    let status = #"{"usage":{},"slots":{},"running":0,"queued":0,"maxConcurrent":4,"maxUploadMb":25,"server":\#(server)}"#
    let odd = HTTPResponder(contentType: "application/json", body: status)
    let rig = Rig(port: odd.port)
    defer {
      odd.close()
      rig.cleanUp()
    }
    let supervisor = rig.supervisor()
    await supervisor.start()
    #expect(supervisor.state.running?.startedByApp == false)
    #expect(supervisor.state.running?.server?.pid == 4_294_967_296)
    #expect(!supervisor.canStop)
    #expect(rig.starts() == 0)
  }

  @Test func anOlderServerTheAppStartedIsStillItsOwn() async throws {
    var rig = Rig()
    defer { rig.cleanUp() }
    rig.node = oldServer(in: rig.dir, node: try await realNode())
    let supervisor = rig.supervisor()
    await supervisor.start()
    #expect(supervisor.state == .running(startedByApp: true, server: nil))
    let record = try #require(ServerRecord.load(from: rig.record))

    let again = rig.supervisor()
    await again.refresh()
    #expect(again.state == .running(startedByApp: true, server: nil))

    #expect(again.canStop)
    await again.stop()
    #expect(again.state == .notRunning)
    #expect(!processAlive(record.pid))
    #expect(ServerRecord.load(from: rig.record) == nil)
  }

  @Test func doesNotStartASecondServerOnAnotherPort() async throws {
    var rig = Rig()
    let suite = "omnikit-supervisor-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer {
      defaults.removePersistentDomain(forName: suite)
      rig.cleanUp()
    }
    rig.node = oldServer(in: rig.dir, node: try await realNode())
    let settings = ServerSettings(defaults: defaults, arguments: [:])
    settings.port = rig.port
    settings.repoPath = rig.repo.path
    settings.nodePath = rig.node?.path ?? ""
    let supervisor = ServerSupervisor(
      settings: settings,
      options: .init(launcher: rig.launcher, logURL: rig.log, recordURL: rig.record, probeTimeout: .milliseconds(500))
    )
    await supervisor.start()
    #expect(supervisor.state == .running(startedByApp: true, server: nil))

    let other = freePort()
    settings.port = other
    await supervisor.start()
    #expect(supervisor.state == .failed(message: ServerStartError.startedElsewhere(port: rig.port).message, logTail: []))
    #expect(rig.starts() == 1)
    #expect(portIsFree(other))

    settings.port = rig.port
    await supervisor.stop()
    #expect(supervisor.state == .notRunning)
    #expect(ServerRecord.load(from: rig.record) == nil)
  }

  @Test func followsTheSettings() async throws {
    let status = #"{"usage":{},"slots":{},"running":0,"queued":0,"maxConcurrent":4,"maxUploadMb":25}"#
    let old = HTTPResponder(contentType: "application/json", body: status)
    let rig = Rig()
    let suite = "omnikit-supervisor-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer {
      old.close()
      defaults.removePersistentDomain(forName: suite)
      rig.cleanUp()
    }
    let settings = ServerSettings(defaults: defaults, arguments: [:])
    settings.port = rig.port
    settings.repoPath = rig.repo.path
    let supervisor = ServerSupervisor(
      settings: settings,
      options: .init(launcher: rig.launcher, logURL: rig.log, recordURL: rig.record, probeTimeout: .milliseconds(500))
    )
    await supervisor.refresh()
    #expect(supervisor.state == .notRunning)
    #expect(supervisor.port == rig.port)

    settings.port = old.port
    await supervisor.refresh()
    #expect(supervisor.state == .running(startedByApp: false, server: nil))
    #expect(supervisor.port == old.port)
  }
}
