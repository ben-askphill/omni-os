import Foundation

/// One `data:` message on GET /api/threads/:id/stream. Classified like `classifyStream` in web/src/api.ts.
public enum ThreadStreamMessage: Decodable, Hashable, Sendable {
  /// A new transcript entry. Its id is also the SSE id, the `after` to resume from.
  case event(EventRow)
  case artifact(Artifact)
  /// The thread row changed. `pending` and `live` come with it when the server sends them.
  case thread(OmniThread, pending: [PendingMsg]?, live: Bool?)
  case unknown(JSONValue)

  private enum CodingKeys: String, CodingKey {
    case kind, artifact, thread, pending, live, id, payload
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
  case unknown(JSONValue)

  private enum CodingKeys: String, CodingKey {
    case type, thread, harness, usage, artifact
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
    default:
      self = .unknown(try JSONValue(from: decoder))
    }
  }
}
