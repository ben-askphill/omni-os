import CoreGraphics
import Foundation

/// One transcript entry. The server stores `payload` as JSON text inside the JSON row; `content` is
/// that text decoded by kind, done once here so views never parse it again.
public struct EventRow: Decodable, Hashable, Sendable, Identifiable {
  public let id: Int
  public let threadID: String
  public let kind: String
  /// The payload exactly as stored, JSON text.
  public let payload: String
  public let content: EventPayload
  public let createdAt: Date

  enum CodingKeys: String, CodingKey {
    case id, kind, payload
    case threadID = "thread_id"
    case createdAt = "created_at"
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(Int.self, forKey: .id)
    threadID = try c.decode(String.self, forKey: .threadID)
    kind = try c.decode(String.self, forKey: .kind)
    payload = try c.decode(String.self, forKey: .payload)
    createdAt = try c.decode(Date.self, forKey: .createdAt)
    content = EventPayload(kind: kind, json: payload)
  }
}

/// An event's payload by kind. A kind this version does not know, or a known kind whose payload
/// no longer decodes, is kept as `.unknown` with its JSON, never dropped.
public enum EventPayload: Hashable, Sendable {
  case user(UserMessage)
  case crewReport(CrewReport)
  case sessionInit(SessionInit)
  case assistantText(text: String)
  case toolUse(ToolUse)
  case toolResult(ToolResult)
  case status(text: String)
  case error(text: String)
  case result(TurnResult)
  case unknown(kind: String, payload: JSONValue)

  public init(kind: String, json: String) {
    let data = Data(json.utf8)
    let d = OmniJSON.decoder()
    do {
      switch kind {
      case "user": self = .user(try d.decode(UserMessage.self, from: data))
      case "crew_report": self = .crewReport(try d.decode(CrewReport.self, from: data))
      case "init": self = .sessionInit(try d.decode(SessionInit.self, from: data))
      case "assistant_text": self = .assistantText(text: try d.decode(TextPayload.self, from: data).text)
      case "tool_use":
        var use = try d.decode(ToolUse.self, from: data)
        if case .object = use.input { use.inputKeys = JSONKeyOrder.keys(ofObjectAt: "input", in: json) }
        use.inputJSON = JSONKeyOrder.valueText(ofKey: "input", in: json)
        self = .toolUse(use)
      case "tool_result": self = .toolResult(try d.decode(ToolResult.self, from: data))
      case "status": self = .status(text: try d.decode(TextPayload.self, from: data).text)
      case "error": self = .error(text: try d.decode(TextPayload.self, from: data).text)
      case "result": self = .result(try d.decode(TurnResult.self, from: data))
      default: self = .unknown(kind: kind, payload: JSONValue.parse(json))
      }
    } catch {
      self = .unknown(kind: kind, payload: JSONValue.parse(json))
    }
  }
}

private struct TextPayload: Decodable {
  let text: String
}

/// A file Ben attached, saved in the thread's uploads folder.
public struct Attachment: Decodable, Hashable, Sendable {
  public let name: String
  public let path: String
  public let size: Int
  public let mime: String
  /// Renders as an image in the transcript.
  public let image: Bool

  /// The largest a thumbnail shows, as `max-h-44 max-w-[14rem]` in Transcript.tsx.
  public static let thumbnailBox = CGSize(width: 224, height: 176)

  /// An image's size shrunk to fit `thumbnailBox` with its shape kept. Small images stay as they are.
  public static func thumbnailSize(_ natural: CGSize) -> CGSize {
    guard natural.width > 0, natural.height > 0 else { return .zero }
    let scale = min(1, thumbnailBox.width / natural.width, thumbnailBox.height / natural.height)
    return CGSize(width: (natural.width * scale).rounded(), height: (natural.height * scale).rounded())
  }
}

/// A command or Mention the message names, with its place in the text.
public struct SlashHit: Decodable, Hashable, Sendable {
  public let name: String
  /// omni, project, personal, plugin, mcp or builtin.
  public let source: String
  public let description: String
  public let argumentHint: String?
  public let start: Int
  public let end: Int
}

public struct SlashRecord: Decodable, Hashable, Sendable {
  /// The harness command the message starts with.
  public let command: SlashHit?
  /// The Mentions after it, in order.
  public let mentions: [SlashHit]?
}

/// kind `user`: a message from Ben or the conductor.
public struct UserMessage: Decodable, Hashable, Sendable {
  public let text: String
  /// ben, conductor, or the thread's source for its first message.
  public let source: String?
  public let slash: SlashRecord?
  public let attachments: [Attachment]?
  /// Set when it was sent mid-turn.
  public let mode: SendMode?
  /// The agent never saw it.
  public let dropped: Bool?
}

/// kind `crew_report`: a child thread reporting back to its parent.
public struct CrewReport: Decodable, Hashable, Sendable {
  public let text: String
  public let taskID: String?
  public let threadID: String?
  public let title: String?
  public let role: String?
  public let channel: String?
  public let status: String?
  public let dropped: Bool?

  enum CodingKeys: String, CodingKey {
    case text, title, role, channel, status, dropped
    case taskID = "task_id"
    case threadID = "thread_id"
  }
}

/// kind `init`: the CLI session started.
public struct SessionInit: Decodable, Hashable, Sendable {
  public let model: String
  public let cwd: String
  public let tools: Int
  public let mcp: [String]
}

public struct ToolUse: Decodable, Hashable, Sendable {
  public let id: String
  public let name: String
  public let input: JSONValue
  /// The tool use this one runs inside, for subagents.
  public let parent: String?
  /// The input's keys in the order JavaScript lists them (integer keys first, then as sent), which `input`
  /// does not keep.
  public internal(set) var inputKeys: [String] = []
  /// The input as the server stored it, which is how JSON.stringify wrote it. nil when the call has none.
  public internal(set) var inputJSON: String?

  enum CodingKeys: String, CodingKey {
    case id, name, input, parent
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    name = try c.decode(String.self, forKey: .name)
    input = try c.decodeIfPresent(JSONValue.self, forKey: .input) ?? .null
    parent = try c.decodeIfPresent(String.self, forKey: .parent)
  }
}

public struct ToolResult: Decodable, Hashable, Sendable {
  public let toolUseID: String
  public let text: String
  public let isError: Bool
  public let truncated: Bool

  enum CodingKeys: String, CodingKey {
    case text, truncated
    case toolUseID = "tool_use_id"
    case isError = "is_error"
  }
}

/// kind `result`: a turn ended.
public struct TurnResult: Decodable, Hashable, Sendable {
  public let ok: Bool
  public let subtype: String
  public let durationMs: Double?
  public let turns: Int?
  public let costUSD: Double?
  /// Ben stopped it.
  public let stopped: Bool?

  enum CodingKeys: String, CodingKey {
    case ok, subtype, turns, stopped
    case durationMs = "duration_ms"
    case costUSD = "cost_usd"
  }
}

/// A file an agent wrote into its thread's artifacts folder, or a browser screenshot.
public struct Artifact: Decodable, Hashable, Sendable, Identifiable {
  public let id: Int
  public let threadID: String
  public let path: String
  public let name: String
  /// html, markdown, svg, image, screenshot, pdf, csv, json or text.
  public let kind: String
  public let size: Int
  public let createdAt: Date
  public let updatedAt: Date

  enum CodingKeys: String, CodingKey {
    case id, path, name, kind, size
    case threadID = "thread_id"
    case createdAt = "created_at"
    case updatedAt = "updated_at"
  }
}
