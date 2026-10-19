import Foundation

/// What quitting does, from the turns that run and who started the server. Pure, so the rules are tested
/// without an app.
public enum QuitRules {
  public enum Decision: Hashable, Sendable {
    /// Nothing to ask. `stopServer` when the app started the server and no turn depends on it.
    case quit(stopServer: Bool)
    /// Turns run: ask Keep server running, Stop them and quit, or Cancel.
    case ask(runningTurns: Int)
  }

  public enum Choice: Hashable, Sendable {
    case keepServerRunning
    case stopAndQuit
    case cancel
  }

  public enum Action: Hashable, Sendable {
    case stayOpen
    /// Interrupt the turns first, then stop the server if `stopServer`.
    case quit(interruptTurns: Bool, stopServer: Bool)
  }

  /// - Parameters:
  ///   - runningTurns: turns running on the server. 0 when no server runs.
  ///   - serverStartedByApp: the server runs and the app started it. A server started by hand is never stopped.
  public static func decide(runningTurns: Int, serverStartedByApp: Bool) -> Decision {
    runningTurns > 0 ? .ask(runningTurns: runningTurns) : .quit(stopServer: serverStartedByApp)
  }

  public static func action(for choice: Choice, serverStartedByApp: Bool) -> Action {
    switch choice {
    case .keepServerRunning: .quit(interruptTurns: false, stopServer: false)
    case .stopAndQuit: .quit(interruptTurns: true, stopServer: serverStartedByApp)
    case .cancel: .stayOpen
    }
  }
}
