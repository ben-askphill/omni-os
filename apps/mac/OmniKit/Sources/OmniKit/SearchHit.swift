import Foundation

/// One result of GET /api/search: a thread, and the words around the match when the body matched.
public struct SearchHit: Decodable, Hashable, Sendable, Identifiable {
  public let threadID: String
  public let title: String
  public let channelID: String
  public let status: ThreadStatus
  public let updatedAt: Date
  /// Text with `<mark>` around the matched words, empty when only the title matched.
  public let snippet: String

  public var id: String { threadID }

  enum CodingKeys: String, CodingKey {
    case title, status, snippet
    case threadID = "thread_id"
    case channelID = "channel_id"
    case updatedAt = "updated_at"
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    threadID = try c.decode(String.self, forKey: .threadID)
    title = try c.decode(String.self, forKey: .title)
    channelID = try c.decode(String.self, forKey: .channelID)
    status = try c.decode(ThreadStatus.self, forKey: .status)
    updatedAt = try c.decode(Date.self, forKey: .updatedAt)
    snippet = try c.decodeIfPresent(String.self, forKey: .snippet) ?? ""
  }
}

/// A stretch of a search snippet, marked when the search matched it.
public struct SnippetRun: Hashable, Sendable {
  public let text: String
  public let marked: Bool

  public init(text: String, marked: Bool) {
    self.text = text
    self.marked = marked
  }
}

public enum Snippet {
  /// Splits on the `<mark>` and `</mark>` the search adds. Everything else is plain text, angle brackets
  /// included, as the Web UI's `safeSnippet` shows it. A mark left open runs to the end.
  public static func runs(_ snippet: String) -> [SnippetRun] {
    var runs: [SnippetRun] = []
    var marked = false
    var rest = Substring(snippet)
    func add(_ text: Substring) {
      guard !text.isEmpty else { return }
      if let last = runs.last, last.marked == marked {
        runs[runs.count - 1] = SnippetRun(text: last.text + text, marked: marked)
      } else {
        runs.append(SnippetRun(text: String(text), marked: marked))
      }
    }
    while let tag = rest.firstRange(of: "<") {
      add(rest[..<tag.lowerBound])
      let after = rest[tag.lowerBound...]
      if after.hasPrefix("<mark>") {
        marked = true
        rest = after.dropFirst(6)
      } else if after.hasPrefix("</mark>") {
        marked = false
        rest = after.dropFirst(7)
      } else {
        add("<")
        rest = after.dropFirst()
      }
    }
    add(rest)
    return runs
  }
}
