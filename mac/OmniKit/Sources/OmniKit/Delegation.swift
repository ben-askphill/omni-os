import Foundation

/// One delegated thread as a delegation card row, as `Branch` in web/src/transcript/delegation.ts.
public struct DelegationBranch: Hashable, Sendable, Identifiable {
  public let id: String
  public var title: String
  public var role: String?
  public var channel: String
  public var harness: HarnessID
  public var taskID: String?
  public var status: ThreadStatus
  public var updatedAt: Date?

  public init(
    id: String, title: String, role: String?, channel: String, harness: HarnessID, taskID: String?, status: ThreadStatus,
    updatedAt: Date? = nil
  ) {
    self.id = id
    self.title = title
    self.role = role
    self.channel = channel
    self.harness = harness
    self.taskID = taskID
    self.status = status
    self.updatedAt = updatedAt
  }

  public init(_ t: OmniThread) {
    self.init(
      id: t.id, title: t.title, role: t.role, channel: t.channelID, harness: t.harness, taskID: t.taskID, status: t.status,
      updatedAt: t.updatedAt)
  }

  /// Fresh state from the thread it started, when the client has it.
  public func live(_ known: [String: OmniThread]) -> Self {
    known[id].map(Self.init) ?? self
  }
}

/// A card: the Conductor's delegate calls in one tool group, or one delegate_team call with its lead.
public struct Delegation: Hashable, Sendable, Identifiable {
  public let id: String
  public var lead: DelegationBranch?
  public var branches: [DelegationBranch]

  public init(id: String, lead: DelegationBranch?, branches: [DelegationBranch]) {
    self.id = id
    self.lead = lead
    self.branches = branches
  }

  public static func isDelegation(_ name: String) -> Bool {
    name == "mcp__omni__delegate" || name == "mcp__omni__delegate_team"
  }

  /// The delegations among a group's calls, consecutive delegate calls folded into one card. Failed calls are left out.
  public static func of(_ calls: [ToolCall]) -> [Delegation] {
    var out: [Delegation] = []
    var solo: Int?
    for c in calls where isDelegation(c.name) {
      guard let result = c.result, !result.isError else { continue }
      let r = JSONValue.parse(result.text)
      let input = c.use.input
      if c.name == "mcp__omni__delegate_team" {
        solo = nil
        guard let lead = branch(r["lead"], fallback: input) else { continue }
        var members: [DelegationBranch] = []
        if case .array(let list)? = r["members"] { members = list.compactMap { branch($0, fallback: input, ownTitle: true) } }
        out.append(Delegation(id: c.callID, lead: lead, branches: members))
        continue
      }
      guard let b = branch(r, fallback: input) else { continue }
      if let i = solo {
        out[i].branches.append(b)
      } else {
        solo = out.count
        out.append(Delegation(id: c.callID, lead: nil, branches: [b]))
      }
    }
    return out
  }

  /// A delegate result: `{thread_id, task_id, title, channel, role, harness, status}`. `ownTitle`: a member names its own.
  static func branch(_ r: JSONValue?, fallback input: JSONValue, ownTitle: Bool = false) -> DelegationBranch? {
    guard let r, let id = r["thread_id"]?.stringValue else { return nil }
    let title = r["title"]?.stringValue ?? (ownTitle ? nil : input["title"]?.stringValue)
    return DelegationBranch(
      id: id,
      title: title ?? "Delegated task",
      role: r["role"]?.stringValue ?? (ownTitle ? nil : input["role"]?.stringValue),
      channel: r["channel"]?.stringValue ?? input["channel"]?.stringValue ?? "",
      harness: HarnessID(rawValue: r["harness"]?.stringValue ?? "claude-code"),
      taskID: r["task_id"]?.stringValue,
      status: ThreadStatus(rawValue: r["status"]?.stringValue ?? "queued"))
  }

  /// A lead's members, straight from its children.
  public static func team(of children: [OmniThread]) -> [DelegationBranch] {
    children.filter { $0.source == .team }.map(DelegationBranch.init)
  }
}
