import Testing
import OmniKit

@MainActor
private final class FakeHost: RestartHost {
  var calls: [String] = []
  var turns: [Int]
  var problem: String?
  var buildError: String?
  var stopError: String?
  var startError: String?
  var onBuild: (() -> Void)?
  var onTurns: ((Int) -> Void)?

  init(turns: [Int]) { self.turns = turns }

  func problemBeforeRestart() -> String? { problem }
  func runningTurns() async -> Int {
    let n = turns.count > 1 ? turns.removeFirst() : (turns.first ?? 0)
    calls.append("turns \(n)")
    onTurns?(n)
    return n
  }
  func buildWeb() async -> String? { calls.append("build"); onBuild?(); return buildError }
  func stopServer() async -> String? { calls.append("stop"); return stopError }
  func startServer() async -> String? { calls.append("start"); return startError }
}

@MainActor @Suite struct ServerRestartTests {
  @Test func waitsForIdleThenBuildsStopsAndStarts() async throws {
    let host = FakeHost(turns: [2, 1, 0, 0])
    let clock = TestClock()
    let restart = ServerRestart(host: host, clock: clock, pollEvery: .seconds(2))
    let done = Task { await restart.run() }

    try await waitFor("waiting") { restart.step == .waitingForIdle(running: 2) }
    #expect(!host.calls.contains("build"))
    clock.advance(by: .seconds(2))
    try await waitFor("still waiting") { restart.step == .waitingForIdle(running: 1) }
    #expect(!host.calls.contains("build"))
    clock.advance(by: .seconds(2))
    await done.value

    #expect(host.calls == ["turns 2", "turns 1", "turns 0", "build", "turns 0", "stop", "start"])
    #expect(restart.step == .idle)
  }

  @Test func waitsAgainWhenATurnStartedDuringTheBuild() async throws {
    let host = FakeHost(turns: [0, 1, 1, 0, 0])
    let clock = TestClock()
    let restart = ServerRestart(host: host, clock: clock)
    let done = Task { await restart.run() }
    try await waitFor("second wait") { restart.step == .waitingForIdle(running: 1) }
    #expect(!host.calls.contains("stop"))
    clock.advance(by: .seconds(2))
    await done.value
    #expect(host.calls.filter { $0 == "build" }.count == 2)
    #expect(host.calls.suffix(2) == ["stop", "start"])
  }

  @Test func aFailedBuildLeavesTheServerRunning() async {
    let host = FakeHost(turns: [0])
    host.buildError = "The Web UI build failed."
    let restart = ServerRestart(host: host, clock: TestClock())
    await restart.run()
    #expect(restart.step == .failed("The Web UI build failed."))
    #expect(!host.calls.contains("stop"))
  }

  @Test func aFailedStartShowsTheError() async {
    let host = FakeHost(turns: [0])
    host.startError = "Port 4747 is in use."
    let restart = ServerRestart(host: host, clock: TestClock())
    await restart.run()
    #expect(restart.step == .failed("Port 4747 is in use."))
  }

  @Test func aServerItCannotStopFailsBeforeAnythingRuns() async {
    let host = FakeHost(turns: [0])
    host.problem = "This server can't be stopped from the app."
    let restart = ServerRestart(host: host, clock: TestClock())
    await restart.run()
    #expect(restart.step == .failed("This server can't be stopped from the app."))
    #expect(host.calls.isEmpty)
  }

  @Test func cancelEndsTheWaitWithoutBuilding() async throws {
    let host = FakeHost(turns: [3])
    let restart = ServerRestart(host: host, clock: TestClock())
    let done = Task { await restart.run() }
    try await waitFor("waiting") { restart.step == .waitingForIdle(running: 3) }
    restart.cancel()
    await done.value
    #expect(restart.step == .idle)
    #expect(!host.calls.contains("build"))
  }

  @Test func aCancelWhileTheCountIsBeingReadStillCancels() async throws {
    let host = FakeHost(turns: [1, 0])
    let clock = TestClock()
    let restart = ServerRestart(host: host, clock: clock)
    host.onTurns = { n in if n == 0 { restart.cancel() } }
    let done = Task { await restart.run() }
    try await waitFor("waiting") { restart.step == .waitingForIdle(running: 1) }
    clock.advance(by: .seconds(2))
    await done.value
    #expect(restart.step == .idle)
    #expect(!host.calls.contains("build"))
    #expect(!host.calls.contains("stop"))
  }
}
