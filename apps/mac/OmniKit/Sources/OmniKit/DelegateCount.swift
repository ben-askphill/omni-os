import Foundation

// The delegate count on a Conductor thread's sidebar row, as @omni/shared/delegate-count.ts: how many threads it
// delegated and the one state the count wears. Delegated threads get no sidebar row of their own, so this count is
// where a stuck one shows.

public struct DelegateSummary: Hashable, Sendable {
  /// needs: a delegated thread waits on Ben. failed: one failed and Ben has not seen it. working: one runs or queues.
  /// settled: none of those. The order is the priority.
  public enum State: String, Sendable {
    case needs, failed, working, settled
  }

  /// Every delegated thread, active or finished, so a finished parent still shows its count.
  public let total: Int
  /// The ones working, waiting on Ben or failed unseen.
  public let active: Int
  public let needs: Int
  public let failed: Int
  public let state: State

  /// What the inbox says about one thread: it waits on Ben (`blocked`), or its newest unread result failed.
  public struct Needs: Hashable, Sendable {
    public let blocked: Bool
    public let failed: Bool

    public init(blocked: Bool, failed: Bool) {
      self.blocked = blocked
      self.failed = failed
    }
  }

  /// The count for one Conductor thread's delegated threads, or nil when it delegated none. A thread Ben marked done
  /// never needs him. Without the inbox (`needs` nil), a failed status that is not marked done counts as failed.
  public static func of(_ children: [ThreadStub], needs: ((String) -> Needs?)? = nil) -> DelegateSummary? {
    guard !children.isEmpty else { return nil }
    var nNeeds = 0, nFailed = 0, active = 0
    var working = false
    for c in children {
      let inbox = c.doneAt != nil ? nil : needs?(c.id)
      let blocked = inbox?.blocked ?? false
      let failed = !blocked && c.doneAt == nil && (inbox.map(\.failed) ?? (needs == nil && c.status == .failed))
      let busy = c.status.isActive
      if blocked { nNeeds += 1 }
      if failed { nFailed += 1 }
      if busy { working = true }
      if blocked || failed || busy { active += 1 }
    }
    let state: State = nNeeds > 0 ? .needs : nFailed > 0 ? .failed : working ? .working : .settled
    return DelegateSummary(total: children.count, active: active, needs: nNeeds, failed: nFailed, state: state)
  }

  /// The count read against the needs-you inbox, nil before it loads.
  public static func of(_ children: [ThreadStub], inbox: NeedsYou?) -> DelegateSummary? {
    guard let inbox else { return of(children) }
    let byID = Dictionary(
      inbox.items.map { ($0.thread.id, Needs(blocked: !$0.blockers.isEmpty, failed: $0.result?.status == .failed)) },
      uniquingKeysWith: { a, _ in a })
    return of(children) { byID[$0] }
  }

  /// The tooltip and accessible label: "3 delegated threads, 2 active", with what needs Ben after it.
  public var label: String {
    var parts = ["\(total) delegated \(total == 1 ? "thread" : "threads")", "\(active) active"]
    if needs > 0 { parts.append("\(needs) \(needs == 1 ? "needs" : "need") you") }
    if failed > 0 { parts.append("\(failed) failed") }
    return parts.joined(separator: ", ")
  }

  /// The diamond shows while one waits on Ben or failed.
  public var flagged: Bool { state == .needs || state == .failed }
}

extension SidebarSections {
  /// Every thread a Conductor job delegated: these get no sidebar row of their own.
  public static func delegatedIDs(_ channels: [ChannelWithRunning]) -> Set<String> {
    Set((channels.first { $0.id == conductorID }?.handoffs ?? []).flatMap { $0.children.map(\.id) })
  }

  /// The threads each Conductor job delegated, keyed by the job's id.
  public static func delegates(_ channels: [ChannelWithRunning]) -> [String: [ThreadStub]] {
    Dictionary(
      (channels.first { $0.id == conductorID }?.handoffs ?? []).map { ($0.parent.id, $0.children) },
      uniquingKeysWith: { a, _ in a })
  }
}
