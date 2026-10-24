import Foundation

// Switching a thread's harness, model or effort between turns: packages/shared/run-switch.ts. The strings must stay
// the same as there; RunSwitchTests pins them.

/// What a thread runs on: the POST /api/threads/:id/run body. An empty model is the harness default; an empty effort
/// is the model's default.
public struct Run: Codable, Hashable, Sendable {
  public var harness: HarnessID
  public var model: String
  public var effort: String

  public init(harness: HarnessID, model: String, effort: String) {
    self.harness = harness
    self.model = model
    self.effort = effort
  }
}

/// A run with the names the catalog gave it when the switch happened, so the transcript reads the same later.
public struct RunName: Codable, Hashable, Sendable {
  public let harness: String
  public let model: String
  public let effort: String
  public let harnessName: String
  public let modelLabel: String

  public init(harness: String, model: String, effort: String, harnessName: String, modelLabel: String) {
    self.harness = harness
    self.model = model
    self.effort = effort
    self.harnessName = harnessName
    self.modelLabel = modelLabel
  }
}

/// How a switch reaches the next turn. `settings`: same harness, its own session resumes. `handover`: another harness
/// reads the thread's history before Ben's next message. `back`: back to the harness a pending handover came from,
/// before anything ran elsewhere.
public enum SwitchMode: String, Codable, Hashable, Sendable {
  case settings, handover, back
}

/// kind `switch`: Ben changed the thread's run between turns.
public struct SwitchP: Codable, Hashable, Sendable {
  public let from: RunName
  public let to: RunName
  public let mode: SwitchMode

  public init(from: RunName, to: RunName, mode: SwitchMode) {
    self.from = from
    self.to = to
    self.mode = mode
  }
}

/// kind `handover`: the next turn's session started with the handover ahead of Ben's message.
public struct HandoverP: Codable, Hashable, Sendable {
  public enum Session: String, Codable, Hashable, Sendable { case fresh, resumed }
  public let to: RunName
  public let session: Session
  /// Transcript entries the handover carried, and the ones cut to fit.
  public let entries: Int
  public let omitted: Int
  public let chars: Int

  public init(to: RunName, session: Session, entries: Int, omitted: Int, chars: Int) {
    self.to = to
    self.session = session
    self.entries = entries
    self.omitted = omitted
    self.chars = chars
  }
}

public enum RunSwitch {
  private static func effortText(_ r: RunName) -> String { r.effort.isEmpty ? "default effort" : "effort \(r.effort)" }
  private static func named(_ r: RunName) -> String { "\(r.harnessName) (\(r.modelLabel))" }

  /// The switch row's line.
  public static func switchText(_ p: SwitchP) -> String {
    switch p.mode {
    case .settings:
      // A harness change on a thread that never ran has no session to hand over, so it reads as a plain switch.
      p.from.harness != p.to.harness
        ? "Switched to \(named(p.to)), \(effortText(p.to))"
        : p.from.model == p.to.model ? "Switched to \(effortText(p.to))" : "Switched to \(p.to.modelLabel), \(effortText(p.to))"
    case .handover:
      "Handing over from \(named(p.from)) to \(named(p.to))"
    case .back:
      "Switched back to \(named(p.to)), which continues its own session"
    }
  }

  /// The quiet line under a handover row, before and after the next turn picks it up.
  public static func handoverNote(_ p: SwitchP, done: HandoverP?, superseded: Bool) -> String? {
    guard p.mode == .handover else { return nil }
    if let done {
      let what = done.session == .fresh ? "a new session" : "its earlier session"
      let cut = done.omitted != 0 ? ", \(done.omitted) older left out" : ""
      return "Handover complete. \(done.to.harnessName) read \(done.entries) \(done.entries == 1 ? "entry" : "entries") into \(what)\(cut)."
    }
    if superseded { return "Replaced by a later switch." }
    return "\(p.to.harnessName) reads the thread so far with your next message."
  }

  /// The run a thread is on, as the switch request sends it.
  public static func current(_ t: OmniThread) -> Run {
    Run(harness: t.harness, model: t.model ?? "", effort: t.effort ?? "")
  }

  /// The run Ben picked while a turn ran, which the thread switches to once it ends. Nil when none waits.
  public static func queued(_ t: OmniThread) -> Run? {
    t.queuedHarness.map { Run(harness: $0, model: t.queuedModel ?? "", effort: t.queuedEffort ?? "") }
  }

  /// The run the pickers show and pick from: the one queued for after this turn, else the one the thread is on.
  public static func shown(_ t: OmniThread) -> Run {
    queued(t) ?? current(t)
  }

  /// A run's model and effort as the pickers name them, for example "Sonnet 5.5, Default (high)".
  public static func describe(_ run: Run, harnesses: [HarnessInfo]) -> String {
    let m = EffortRules.model(harness: run.harness, model: run.model, in: harnesses)
    let effort = EffortRules.options(for: m).first { $0.value == run.effort }?.label ?? (run.effort.isEmpty ? "default effort" : run.effort)
    return "\(m?.label ?? (run.model.isEmpty ? "default model" : run.model)), \(effort)"
  }

  /// The model the list marks: the run's, or the harness default's when it has none.
  public static func shownModel(_ run: Run, harnesses: [HarnessInfo]) -> String {
    run.model.isEmpty ? EffortRules.model(harness: run.harness, model: "", in: harnesses)?.id ?? "" : run.model
  }

  /// The run after a pick in the model list, or nil when it is the one shown. A new model starts on its default effort.
  public static func picking(harness: HarnessID, model: String, from current: Run, harnesses: [HarnessInfo]) -> Run? {
    guard harness != current.harness || model != shownModel(current, harnesses: harnesses) else { return nil }
    return Run(harness: harness, model: model, effort: "")
  }

  /// The run after a pick in the effort list, or nil when it is the one shown.
  public static func picking(effort: String, from current: Run) -> Run? {
    guard effort != current.effort else { return nil }
    var r = current
    r.effort = effort
    return r
  }
}

/// One switch row in the transcript, with what became of it.
public struct SwitchRow: Hashable, Sendable {
  /// The `switch` event's id.
  public let eventID: Int
  public let at: Date
  public let p: SwitchP
  /// The `handover` event once the next turn's session read the handover.
  public internal(set) var done: HandoverP?
  /// A later handover or back switch replaced this handover before it ran.
  public internal(set) var superseded = false

  public var text: String { RunSwitch.switchText(p) }
  public var note: String? { RunSwitch.handoverNote(p, done: done, superseded: superseded) }
  /// A handover the next turn has not picked up yet.
  public var isPending: Bool { p.mode == .handover && done == nil && !superseded }
}

extension OmniClient {
  /// Switches the thread's harness, model or effort. While a turn runs the switch waits for it (`queuedHarness`), and
  /// the current run sent again drops it. 400 for a run the catalog does not have, a move to or from Hermes or Cursor Cloud, or a model change on Cursor Cloud.
  public func switchRun(_ id: String, to run: Run) async throws(OmniAPIError) -> OmniThread {
    try await send("POST", "/api/threads/\(uriComponent(id))/run", body: run)
  }
}
