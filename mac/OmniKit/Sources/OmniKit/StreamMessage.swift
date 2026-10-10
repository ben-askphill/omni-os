import Foundation

/// One `data:` message on GET /api/threads/:id/stream. Classified like `classifyStream` in web/src/api.ts.
public enum ThreadStreamMessage: Decodable, Hashable, Sendable {
  /// A new transcript entry. Its id is also the SSE id, the `after` to resume from.
  case event(EventRow)
  case artifact(Artifact)
  /// The thread row changed. `pending` and `live` come with it when the server sends them.
  case thread(OmniThread, pending: [PendingMsg]?, live: Bool?)
  /// How full the thread's context window is (ContextUsage in shared/context-meter.ts). The Web UI draws it
  /// as a ring in the thread header; the Mac app has no meter yet, so it keeps the JSON as is.
  case context(JSONValue)
  case unknown(JSONValue)

  private enum CodingKeys: String, CodingKey {
    case kind, artifact, thread, pending, live, id, payload, context
  }

  public init(from decoder: any Decoder) throws {
    guard let c = try? decoder.container(keyedBy: CodingKeys.self) else {
      self = .unknown(try JSONValue(from: decoder))
      return
    }
    let kind = try? c.decode(String.self, forKey: .kind)
    if kind == "artifact", c.contains(.artifact), try !c.decodeNil(forKey: .artifact) {
      self = .artifact(try c.decode(Artifact.self, forKey: .artifact))
    } else if kind == "thread", c.contains(.thread), try !c.decodeNil(forKey: .thread) {
      self = .thread(
        try c.decode(OmniThread.self, forKey: .thread),
        pending: try c.decodeIfPresent([PendingMsg].self, forKey: .pending),
        live: try? c.decodeIfPresent(Bool.self, forKey: .live)
      )
    } else if kind == "context", let usage = try? c.decode(JSONValue.self, forKey: .context) {
      self = .context(usage)
    } else if (try? c.decode(Int.self, forKey: .id)) != nil, (try? c.decode(String.self, forKey: .payload)) != nil {
      self = .event(try EventRow(from: decoder))
    } else {
      self = .unknown(try JSONValue(from: decoder))
    }
  }
}

/// One `data:` message on GET /api/feed, the server-wide change feed.
public enum FeedEvent: Decodable, Hashable, Sendable {
  /// A thread was created, changed status or was renamed.
  case thread(OmniThread)
  /// A harness's plan usage changed. The server sends every harness's usage when the feed connects.
  case usage(harness: HarnessID, usage: Usage?)
  case artifact(Artifact)
  /// Every sub-agent running now, across all threads, whenever one starts, progresses or ends.
  case tasks([BackgroundTask])
  /// A channel changed on another Mac (sync): refetch the channel list.
  case channel(id: String)
  case unknown(JSONValue)

  private enum CodingKeys: String, CodingKey {
    case type, thread, harness, usage, artifact, tasks, id
  }

  public init(from decoder: any Decoder) throws {
    guard let c = try? decoder.container(keyedBy: CodingKeys.self) else {
      self = .unknown(try JSONValue(from: decoder))
      return
    }
    switch try? c.decode(String.self, forKey: .type) {
    case "thread":
      self = .thread(try c.decode(OmniThread.self, forKey: .thread))
    case "usage":
      self = .usage(
        harness: try c.decodeIfPresent(HarnessID.self, forKey: .harness) ?? .claudeCode,
        usage: try c.decodeIfPresent(Usage.self, forKey: .usage)
      )
    case "artifact":
      self = .artifact(try c.decode(Artifact.self, forKey: .artifact))
    case "tasks":
      self = .tasks(try c.decode([BackgroundTask].self, forKey: .tasks))
    case "channel":
      self = .channel(id: try c.decode(String.self, forKey: .id))
    default:
      self = .unknown(try JSONValue(from: decoder))
    }
  }
}

/// A sub-agent the CLI is running, as GET /api/tasks and the feed's `tasks` event carry it.
public struct BackgroundTask: Decodable, Hashable, Sendable, Identifiable {
  public var id: String { taskID }
  public let threadID: String
  public let channelID: String
  public let taskID: String
  public let toolUseID: String?
  public let description: String
  public let background: Bool
  public let startedAt: Date
  public let lastTool: String?
  public let toolUses: Int?

  enum CodingKeys: String, CodingKey {
    case description, background
    case threadID = "thread_id"
    case channelID = "channel_id"
    case taskID = "task_id"
    case toolUseID = "tool_use_id"
    case startedAt = "started_at"
    case lastTool = "last_tool"
    case toolUses = "tool_uses"
  }
}
