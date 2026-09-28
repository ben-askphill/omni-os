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
}

public struct ThreadSource: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let manual: Self = "manual"
  public static let automation: Self = "automation"
  public static let conductor: Self = "conductor"
  public static let `import`: Self = "import"
  public static let capture: Self = "capture"
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
  public let createdAt: Date
  public let updatedAt: Date

  enum CodingKeys: String, CodingKey {
    case id, title, status, role, model, harness, effort, cwd, branch, source, automation
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

  public var id: String { uuid }

  enum CodingKeys: String, CodingKey {
    case uuid, kind, text, source, mode, state, role, attachments
    case taskID = "task_id"
  }
}

/// GET /api/threads/:id.
public struct ThreadDetail: Decodable, Hashable, Sendable {
  public let thread: OmniThread
  public let channel: Channel?
  public let events: [EventRow]
  public let artifacts: [Artifact]
  public let children: [OmniThread]
  public let parent: OmniThread?
  public let pending: [PendingMsg]
  /// A warm CLI process is attached, so the next message starts at once.
  public let live: Bool

  enum CodingKeys: String, CodingKey {
    case thread, channel, events, artifacts, children, parent, pending, live
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    thread = try c.decode(OmniThread.self, forKey: .thread)
    channel = try c.decodeIfPresent(Channel.self, forKey: .channel)
    events = try c.decode([EventRow].self, forKey: .events)
    artifacts = try c.decodeIfPresent([Artifact].self, forKey: .artifacts) ?? []
    children = try c.decodeIfPresent([OmniThread].self, forKey: .children) ?? []
    parent = try c.decodeIfPresent(OmniThread.self, forKey: .parent)
    pending = try c.decodeIfPresent([PendingMsg].self, forKey: .pending) ?? []
    live = try c.decodeIfPresent(Bool.self, forKey: .live) ?? false
  }
}
