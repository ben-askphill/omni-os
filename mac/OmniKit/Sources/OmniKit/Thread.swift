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

  /// What the status pill says, as STATUS_LABEL in web/src/components/ui.tsx.
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

/// A thread row. Field names follow `Thread` in server/db.ts; named OmniThread so it never clashes with Foundation.Thread.
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
  public let createdAt: Date
  public let updatedAt: Date

  enum CodingKeys: String, CodingKey {
    case id, title, status, role, model, harness, effort, cwd, branch, source, automation, suggestion, archived
    case folderID = "folder_id"
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

/// Where a message sent through the API is, as the server's saved copy says (server/db/repos/requests.ts).
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

  enum CodingKeys: String, CodingKey {
    case thread, channel, events, artifacts, children, team, parent, pending, live
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
  }
}
