import Testing
import OmniKit

@Suite struct QuitTests {
  @Test func asksOnlyWhileTurnsRun() {
    #expect(QuitRules.decide(runningTurns: 2, serverStartedByApp: true) == .ask(runningTurns: 2))
    #expect(QuitRules.decide(runningTurns: 1, serverStartedByApp: false) == .ask(runningTurns: 1))
  }

  @Test func quietQuitStopsOnlyTheServerTheAppStarted() {
    #expect(QuitRules.decide(runningTurns: 0, serverStartedByApp: true) == .quit(stopServer: true))
    #expect(QuitRules.decide(runningTurns: 0, serverStartedByApp: false) == .quit(stopServer: false))
  }

  @Test func eachChoiceDoesWhatItSays() {
    #expect(QuitRules.action(for: .keepServerRunning, serverStartedByApp: true) == .quit(interruptTurns: false, stopServer: false))
    #expect(QuitRules.action(for: .stopAndQuit, serverStartedByApp: true) == .quit(interruptTurns: true, stopServer: true))
    #expect(QuitRules.action(for: .stopAndQuit, serverStartedByApp: false) == .quit(interruptTurns: true, stopServer: false))
    #expect(QuitRules.action(for: .cancel, serverStartedByApp: true) == .stayOpen)
  }
}
