import Foundation

/// How a reply is sent, from what the harness can do and whether the thread is busy
/// (`SteerButton` and `ReplyComposer` in web/src/components/Composer.tsx).
public enum SendRules {
  /// The harness's own answer when it is known, else every harness but Cursor steers.
  public static func canSteer(harness: HarnessID, capabilities: HarnessCapabilities?) -> Bool {
    capabilities?.steer ?? (harness != .cursor)
  }

  /// The modes the split button offers, in order.
  public static func options(canSteer: Bool) -> [SendMode] {
    canSteer ? [.steer, .queue, .interrupt] : [.queue, .interrupt]
  }

  /// What the button's main half and Cmd-Return do on a busy thread.
  public static func primary(canSteer: Bool) -> SendMode {
    canSteer ? .steer : .queue
  }

  /// The mode a send key asks for. nil while idle: the server just starts the next turn.
  public static func mode(busy: Bool, canSteer: Bool, shift: Bool) -> SendMode? {
    guard busy else { return nil }
    return shift ? .interrupt : primary(canSteer: canSteer)
  }

  public static func title(_ mode: SendMode) -> String {
    switch mode {
    case .steer: "Steer now"
    case .queue: "Queue for after this turn"
    case .interrupt: "Interrupt and send"
    default: mode.rawValue
    }
  }

  public static func hint(_ mode: SendMode) -> String {
    switch mode {
    case .steer: "The agent reads it at its next step"
    case .queue: "Runs when the current turn ends"
    case .interrupt: "Stops the current step, then runs this"
    default: ""
    }
  }

  /// The main half of the button: "Steer" or, where steering isn't supported, "Queue".
  public static func buttonTitle(canSteer: Bool) -> String { canSteer ? "Steer" : "Queue" }

  public static func placeholder(busy: Bool) -> String {
    busy ? "Steer the agent. It reads this at its next step." : "Reply"
  }
}

/// What Esc needs to know to decide whether it interrupts the turn.
public struct EscapeContext: Hashable, Sendable {
  public var running: Bool
  public var interrupting = false
  /// An input method has marked text: Esc belongs to it.
  public var composing = false
  public var isRepeat = false
  /// Command, Control, Option or Shift is down.
  public var hasModifiers = false
  /// A menu, popover or sheet is open and keeps Esc for itself.
  public var menuOrSheetOpen = false
  public var slashMenuOpen = false

  public init(running: Bool) { self.running = running }
}

public enum EscapeGate {
  /// The Web UI's rule: Esc interrupts a busy thread, unless it is already stopping or something else
  /// wants the key.
  public static func interrupts(_ c: EscapeContext) -> Bool {
    c.running && !c.interrupting && !c.composing && !c.isRepeat && !c.hasModifiers && !c.menuOrSheetOpen && !c.slashMenuOpen
  }
}
