/// One line of a delivery's detail (`DeliveryStage` in packages/shared/automation-triggers.ts).
public struct DeliveryStage: Hashable, Sendable {
  public enum Name: String, Hashable, Sendable { case trigger = "Trigger", run = "Run", execution = "Execution" }
  /// done: went through. needs: went wrong. live: in progress. quiet: will not happen. plain: waiting.
  public enum Tone: String, Hashable, Sendable { case done, needs, live, quiet, plain }
  public let name: Name
  public let label: String
  public let tone: Tone
  /// More on the label: the reason, or why it waits.
  public let note: String?
}

/// What a thread's status says about the Execution stage (`EXECUTION` in packages/shared/automation-triggers.ts).
/// A status not listed shows as the server spells it.
private let executionByStatus: [ThreadStatus: (label: String, tone: DeliveryStage.Tone)] = [
  .queued: ("Queued", .plain),
  .running: ("Running", .live),
  .done: ("Finished", .done),
  .failed: ("Failed", .needs),
  .stopped: ("Stopped", .quiet),
]

extension TriggerDelivery {
  /// The three things a delivery went through, in order: Trigger, Run and Execution. Ports `deliveryStages` in
  /// packages/shared/automation-triggers.ts. A delivery whose thread exists is never called a failure of the run,
  /// whatever it reported: its thread says, and a `started` one keeps what went wrong as the Run note. A `failed` one
  /// with a thread only older builds saved.
  public var stages: [DeliveryStage] {
    // `deliveryStages` tests thread_id for truthiness, so an empty id is no thread.
    let hasThread = !(threadID ?? "").isEmpty
    let trigger: DeliveryStage =
      switch state {
      case .received: DeliveryStage(name: .trigger, label: "Received", tone: .plain, note: nil)
      case .queued: DeliveryStage(name: .trigger, label: "Held for owner", tone: .plain, note: nil)
      case .skipped: DeliveryStage(name: .trigger, label: "Skipped", tone: .quiet, note: reason)
      default: DeliveryStage(name: .trigger, label: "Accepted", tone: .done, note: nil)
      }
    let run: DeliveryStage =
      switch state {
      case _ where state.isPending:
        DeliveryStage(name: .run, label: "Waiting to start", tone: .plain, note: waiting)
      case .started:
        DeliveryStage(name: .run, label: "Thread created", tone: .done, note: reason)
      case .failed:
        DeliveryStage(
          name: .run, label: hasThread ? "Started, then reported an error" : "Could not start", tone: .needs, note: reason)
      default:
        DeliveryStage(name: .run, label: "Never started", tone: .quiet, note: nil)
      }
    let execution: DeliveryStage
    if hasThread {
      let seen = threadStatus.flatMap { executionByStatus[$0] }
      execution = DeliveryStage(
        name: .execution, label: seen?.label ?? threadStatus?.rawValue ?? "Thread removed", tone: seen?.tone ?? .quiet, note: nil)
    } else {
      execution = DeliveryStage(name: .execution, label: "No run", tone: .quiet, note: nil)
    }
    return [trigger, run, execution]
  }
}
