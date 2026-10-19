import Testing
import OmniKit

@Suite struct ServerScreenTests {
  private let failure = StartFailure(message: "No Omni checkout at /x.", logTail: ["boom"])

  private func screen(
    _ state: ServerSupervisor.State, _ connection: ConnectionState = .reconnecting(attempt: 1, nextDelay: .seconds(1)),
    failure: StartFailure? = nil
  ) -> ServerScreen? {
    ServerScreen(state: state, connection: connection, startFailure: failure, port: 4757, repo: "~/omni-os")
  }

  @Test func aRunningServerShowsTheRoute() {
    #expect(screen(.running(startedByApp: true, server: nil)) == nil)
    #expect(screen(.running(startedByApp: false, server: nil), .open) == nil)
  }

  @Test func theFirstCheckShowsLooking() {
    #expect(screen(.unknown, .connecting) == .looking(port: 4757))
    #expect(screen(.checking, .connecting) == .looking(port: 4757))
  }

  @Test func nothingOnThePortOffersStart() {
    #expect(screen(.notRunning) == .notRunning(port: 4757, repo: "~/omni-os"))
  }

  @Test func aFailedStartStaysAfterACheckFindsNothing() {
    #expect(screen(.notRunning, failure: failure) == .failed(message: failure.message, logTail: ["boom"]))
  }

  @Test func aFailureFromTheSupervisorShowsItsMessageAndTail() {
    #expect(screen(.failed(message: "Port 4757 is in use.", logTail: ["a", "b"])) == .failed(message: "Port 4757 is in use.", logTail: ["a", "b"]))
  }

  @Test func startingAndStoppingShowProgress() {
    #expect(screen(.starting) == .starting(port: 4757))
    #expect(screen(.stopping) == .stopping(port: 4757))
    #expect(screen(.stopping, .open) == .stopping(port: 4757))
  }

  @Test func anOpenFeedShowsTheRouteWhateverTheLastCheckSaid() {
    #expect(screen(.checking, .open) == nil)
    #expect(screen(.notRunning, .open) == nil)
    #expect(screen(.failed(message: "Port 4757 is in use.", logTail: []), .open, failure: failure) == nil)
    #expect(screen(.starting, .open) == nil)
  }

  @Test func statesHaveShortLabels() {
    #expect(ServerSupervisor.State.running(startedByApp: true, server: nil).label == "Started by the app")
    #expect(ServerSupervisor.State.running(startedByApp: false, server: nil).label == "Started outside the app")
    #expect(ServerSupervisor.State.notRunning.label == "Not running")
    #expect(ServerSupervisor.State.failed(message: "x", logTail: []).label == "Not running")
    #expect(ServerSupervisor.State.starting.label == "Starting")
    #expect(ServerSupervisor.State.stopping.label == "Stopping")
    #expect(ServerSupervisor.State.checking.label == "Checking")
    #expect(ServerSupervisor.State.unknown.label == "Checking")
  }

  @Test func startIsOfferedOnlyWhenNothingRunsOrStarts() {
    #expect(ServerSupervisor.State.notRunning.canStart)
    #expect(ServerSupervisor.State.failed(message: "x", logTail: []).canStart)
    #expect(!ServerSupervisor.State.running(startedByApp: true, server: nil).canStart)
    #expect(!ServerSupervisor.State.starting.canStart)
    #expect(!ServerSupervisor.State.stopping.canStart)
    #expect(!ServerSupervisor.State.checking.canStart)
    #expect(!ServerSupervisor.State.unknown.canStart)
  }
}
