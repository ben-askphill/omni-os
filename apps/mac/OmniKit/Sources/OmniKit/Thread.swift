import Foundation

public struct ThreadStatus: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let queued: Self = "queued"
  public static let running: Self = "running"
  public static let done: Self = "done"
  public static let failed: Self = "failed"
  public static let stopped: Self = "stopped"
  public static let imported: Self = "imported"

  /// Queued or running: the sidebar lists it under its channel.
  public var isActive: Bool { self == .queued || self == .running }

  /// What the status pill says, as STATUS_LABEL in apps/web/src/components/ui.tsx.
  public var label: String {
    switch self {
    case .queued: "Queued"
    case .running: "Running"
    case .done: "Done"
    case .failed: "Failed"
    case .stopped: "Stopped"
    case .imported: "Imported"
    default: rawValue
    }
  }
}

public struct ThreadSource: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let manual: Self = "manual"
  public static let automation: Self = "automation"
  public static let conductor: Self = "conductor"
  public static let `import`: Self = "import"
  public static let capture: Self = "capture"
  /// A member of a team, run under its lead thread and listed only there.
  public static let team: Self = "team"
}

/// A worktree thread's preparation (apps/server/runner/setup.ts). Nil on the thread once its worktree is ready.
public struct ThreadSetup: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  /// Omni is making and checking the worktree. Nothing runs yet.
  public static let preparing: Self = "preparing"
  /// It could not: `setupError` says why, and Retry tries again on the same thread, branch and session.
  public static let failed: Self = "failed"
}

/// A turn the harness stopped at the plan's usage limit (apps/server/runner/limits.ts). Nil once anything moves the thread on.
public struct ThreadLimit: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  /// Stopped; Ben resumes it now, or at the reset time when the harness gave one.
  public static let limited: Self = "limited"
  /// Omni continues it once, at the reset time.
  public static let scheduled: Self = "scheduled"
}

/// A thread row. Field names follow `Thread` in apps/server/db.ts; named OmniThread so it never clashes with Foundation.Thread.
public struct OmniThread: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  public let channelID: String
  public let title: String
  public let status: ThreadStatus
  public let role: String?
  public let model: String?
  public let harness: HarnessID
  /// nil means the model's default (the server stores an empty string).
  public let effort: String?
  /// Why Auto picked the harness, model and effort above (apps/server/harness/auto.ts). Nil when the thread was not
  /// on Auto, and from older servers.
  public let autoReason: String?
  /// The run Ben picked while a turn ran, which the thread switches to once it ends (apps/server/runner/switch.ts).
  /// Nil when none waits, and from older servers. An empty model or effort is the default, as above.
  public let queuedHarness: HarnessID?
  public let queuedModel: String?
  public let queuedEffort: String?
  public let sessionID: String?
  public let hasRun: Bool
  public let cwd: String?
  public let branch: String?
  public let parentID: String?
  public let taskID: String?
  public let source: ThreadSource
  public let automation: String?
  public let lastText: String?
  /// The server's guess at Ben's next reply once a turn is done: the reply box's placeholder, Tab takes it.
  public let suggestion: String?
  /// A follow-up thread the server proposed once a turn was done: the card under the transcript. Start runs it.
  public let nextTitle: String?
  public let nextPrompt: String?
  /// Archived by Ben: out of the lists, still reachable by search and by its link.
  public let archived: Bool
  /// The sidebar folder it sits in, nil for the channel's ungrouped list.
  public let folderID: String?
  /// When Ben pinned it to the sidebar's Pinned section, nil when it is not pinned. Older servers leave it out.
  public let pinnedAt: Date?
  /// When Ben marked it done, out of Needs you until something new happens in it. Older servers leave it out.
  public let doneAt: Date?
  /// Nil once its folder is ready, which is always for a thread that needs no worktree. Older servers leave it out.
  public let setup: ThreadSetup?
  /// Why the worktree could not be prepared, while `setup` is failed.
  public let setupError: String?
  /// Its last turn stopped at the usage limit, on either Mac (it syncs). Older servers leave it out.
  public let limit: ThreadLimit?
  /// When the harness said that limit resets. Nil when it did not say: only Resume now is offered.
  public let limitResetsAt: Date?
  /// The stop is the other Mac's: shown here, resumed or scheduled there.
  public let limitElsewhere: Bool
  public let createdAt: Date
  public let updatedAt: Date

  enum CodingKeys: String, CodingKey {
    case id, title, status, role, model, harness, effort, cwd, branch, source, automation, suggestion, archived, setup
    case autoReason = "auto_reason"
    case queuedHarness = "queued_harness"
    case queuedModel = "queued_model"
    case queuedEffort = "queued_effort"
    case setupError = "setup_error"
    case limit = "limit_state"
    case limitResetsAt = "limit_resets_at"
    case limitElsewhere = "limit_elsewhere"
    case folderID = "folder_id"
    case pinnedAt = "pinned_at"
    case doneAt = "done_at"
    case nextTitle = "next_title"
    case nextPrompt = "next_prompt"
    case channelID = "channel_id"
    case sessionID = "session_id"
    case hasRun = "has_run"
    case parentID = "parent_id"
    case taskID = "task_id"
    case lastText = "last_text"
    case createdAt = "created_at"
    case updatedAt = "updated_at"
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    channelID = try c.decode(String.self, forKey: .channelID)
    title = try c.decode(String.self, forKey: .title)
    status = try c.decode(ThreadStatus.self, forKey: .status)
    role = try c.decodeIfPresent(String.self, forKey: .role)
    model = try c.decodeIfPresent(String.self, forKey: .model)
    harness = try c.decodeIfPresent(HarnessID.self, forKey: .harness) ?? .claudeCode
    effort = try c.decodeEffort(.effort)
    autoReason = try c.decodeIfPresent(String.self, forKey: .autoReason)
    queuedHarness = try c.decodeIfPresent(HarnessID.self, forKey: .queuedHarness)
    queuedModel = try c.decodeIfPresent(String.self, forKey: .queuedModel)
    queuedEffort = try c.decodeIfPresent(String.self, forKey: .queuedEffort)
    sessionID = try c.decodeIfPresent(String.self, forKey: .sessionID)
    hasRun = try c.decodeFlag(.hasRun)
    cwd = try c.decodeIfPresent(String.self, forKey: .cwd)
    branch = try c.decodeIfPresent(String.self, forKey: .branch)
    parentID = try c.decodeIfPresent(String.self, forKey: .parentID)
    taskID = try c.decodeIfPresent(String.self, forKey: .taskID)
    source = try c.decode(ThreadSource.self, forKey: .source)
    automation = try c.decodeIfPresent(String.self, forKey: .automation)
    lastText = try c.decodeIfPresent(String.self, forKey: .lastText)
    suggestion = try c.decodeIfPresent(String.self, forKey: .suggestion)
    nextTitle = try c.decodeIfPresent(String.self, forKey: .nextTitle)
    nextPrompt = try c.decodeIfPresent(String.self, forKey: .nextPrompt)
    archived = (try? c.decodeFlag(.archived)) ?? false
    folderID = try c.decodeIfPresent(String.self, forKey: .folderID)
    pinnedAt = try c.decodeIfPresent(Date.self, forKey: .pinnedAt)
    doneAt = try c.decodeIfPresent(Date.self, forKey: .doneAt)
    setup = try c.decodeIfPresent(ThreadSetup.self, forKey: .setup)
    setupError = try c.decodeIfPresent(String.self, forKey: .setupError)
    limit = try c.decodeIfPresent(ThreadLimit.self, forKey: .limit)
    limitResetsAt = try c.decodeIfPresent(Date.self, forKey: .limitResetsAt)
    limitElsewhere = (try? c.decodeFlag(.limitElsewhere)) ?? false
    createdAt = try c.decode(Date.self, forKey: .createdAt)
    updatedAt = try c.decode(Date.self, forKey: .updatedAt)
  }
}

/// How a message reaches a busy thread: read at its next step, run after the turn, or interrupt then run.
public struct SendMode: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let steer: Self = "steer"
  public static let queue: Self = "queue"
  public static let interrupt: Self = "interrupt"
}

public struct PendingState: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  /// No free slot yet.
  public static let waiting: Self = "waiting"
  /// Written to the CLI, read at its next step.
  public static let sent: Self = "sent"
  /// Runs after this turn.
  public static let held: Self = "held"
}

/// Where a message sent through the API is, as the server's saved copy says (apps/server/db/repos/requests.ts).
public struct DeliveryState: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let accepted: Self = "accepted"
  public static let waiting: Self = "waiting"
  public static let held: Self = "held"
  public static let sent: Self = "sent"
  public static let delivered: Self = "delivered"
  public static let dropped: Self = "dropped"
  public static let discarded: Self = "discarded"
  /// Ben removed it from the queue before it was sent. The row is the record; the transcript never shows it.
  public static let cancelled: Self = "cancelled"
  /// Accepted before a restart and never reached a harness: waits for Resume.
  public static let recovered: Self = "recovered"
  /// Written to a harness before a restart, so it may have been read: sent again only when Ben says so.
  public static let uncertain: Self = "uncertain"
}

/// A message the agent has not seen yet. It enters the transcript when the CLI replays it.
public struct PendingMsg: Decodable, Hashable, Sendable, Identifiable {
  public let uuid: String
  /// `user` or `crew_report`.
  public let kind: String
  public let text: String
  public let source: String?
  public let mode: SendMode
  public let state: PendingState
  public let taskID: String?
  public let role: String?
  /// A crew report: the thread that reported. Older servers leave it out.
  public let threadID: String?
  public let attachments: [Attachment]?
  /// Sent through the API: the client's request id. Older servers leave it out.
  public let requestID: String?
  /// Where the server's saved copy is. `recovered` and `uncertain` come with `state` held and wait on Ben.
  public let delivery: DeliveryState?

  public var id: String { uuid }

  /// Accepted before a restart and waiting on Ben's decision.
  public var isParked: Bool { delivery == .recovered || delivery == .uncertain }

  enum CodingKeys: String, CodingKey {
    case uuid, kind, text, source, mode, state, role, attachments, delivery
    case taskID = "task_id"
    case threadID = "thread_id"
    case requestID = "request_id"
  }
}

/// GET /api/threads/:id.
public struct ThreadDetail: Decodable, Hashable, Sendable {
  public let thread: OmniThread
  public let channel: Channel?
  public let events: [EventRow]
  public let artifacts: [Artifact]
  public let children: [OmniThread]
  /// Members of the teams among `children`, for the delegation cards. Older servers leave it out.
  public let team: [OmniThread]
  public let parent: OmniThread?
  public let pending: [PendingMsg]
  /// A warm CLI process is attached, so the next message starts at once.
  public let live: Bool
  /// Why a turn cannot start here (a synced thread running on the other Mac, a worktree not ready), for the
  /// composer to show. Nil when one can.
  public let blocked: String?
  /// A handoff of the thread to or from another Mac. Older servers leave it out; a phase this app does not know is nil.
  public let handoff: HandoffView?
  /// Set when `events` is the newest page only (`?history=recent`). Nil means every row came.
  public let history: HistoryHead?

  enum CodingKeys: String, CodingKey {
    case thread, channel, events, artifacts, children, team, parent, pending, live, blocked, handoff, history
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    thread = try c.decode(OmniThread.self, forKey: .thread)
    channel = try c.decodeIfPresent(Channel.self, forKey: .channel)
    events = try c.decode([EventRow].self, forKey: .events)
    artifacts = try c.decodeIfPresent([Artifact].self, forKey: .artifacts) ?? []
    children = try c.decodeIfPresent([OmniThread].self, forKey: .children) ?? []
    team = try c.decodeIfPresent([OmniThread].self, forKey: .team) ?? []
    parent = try c.decodeIfPresent(OmniThread.self, forKey: .parent)
    pending = try c.decodeIfPresent([PendingMsg].self, forKey: .pending) ?? []
    live = try c.decodeIfPresent(Bool.self, forKey: .live) ?? false
    blocked = try c.decodeIfPresent(String.self, forKey: .blocked)
    handoff = (try? c.decodeIfPresent(HandoffView.self, forKey: .handoff)) ?? nil
    history = try c.decodeIfPresent(HistoryHead.self, forKey: .history)
  }
}
