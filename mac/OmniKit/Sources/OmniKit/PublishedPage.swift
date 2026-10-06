import Foundation

/// A page a thread published to claude.ai with Claude Code's Artifact tool: `publishedFrom` in
/// shared/published.ts. tests/fixtures/published.json keeps the two in step.
public struct PublishedPage: Hashable, Sendable, Identifiable {
  public let url: String
  /// The local page that was published. nil when the page came from an Artifact type.
  public let filePath: String?
  public let title: String
  public let description: String?
  /// The call updated a page it had published before, at the same URL.
  public let update: Bool

  public var id: String { url }

  public init(url: String, filePath: String? = nil, title: String, description: String? = nil, update: Bool) {
    self.url = url
    self.filePath = filePath
    self.title = title
    self.description = description
    self.update = update
  }

  private static let pattern = #"https://claude\.ai/(?:code/)?artifact/[A-Za-z0-9_-]+"#

  public static func isArtifactURL(_ s: String) -> Bool {
    s.range(of: "^\(pattern)$", options: .regularExpression) != nil
  }

  /// The page a call published, or nil when it did something else (read, list, an asset upload) or failed.
  public static func from(name: String, input: JSONValue, result: ToolResult?) -> PublishedPage? {
    from(name: name, input: input, text: result?.text, isError: result?.isError ?? true)
  }

  static func from(name: String, input: JSONValue, text: String?, isError: Bool) -> PublishedPage? {
    guard name == "Artifact", let text, !isError else { return nil }
    func str(_ key: String) -> String? {
      guard let s = input[key]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
      return s
    }
    guard (str("action") ?? "publish") == "publish", input["asset"] != .bool(true) else { return nil }
    let given = str("url")
    let found = text.range(of: pattern, options: .regularExpression).map { String(text[$0]) }
    guard let url = found ?? given.flatMap({ isArtifactURL($0) ? $0 : nil }) else { return nil }
    let file = str("file_path")
    let name = file.map { $0.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? $0 }
    return PublishedPage(url: url, filePath: file, title: str("title") ?? name ?? "Artifact", description: str("description"), update: given != nil)
  }

  /// The pages a transcript published, each under the last tool group that published it, by the group's event id.
  /// `publishedByGroup` in web/src/components/Transcript.tsx.
  public static func byGroup(_ items: [TranscriptItem]) -> [Int: [PublishedPage]] {
    var last: [(group: Int, page: PublishedPage)] = []
    func visit(_ call: ToolCall, group: Int) {
      if let p = from(name: call.name, input: call.use.input, result: call.result) {
        last.removeAll { $0.page.url == p.url }
        last.append((group, p))
      }
      call.children.forEach { visit($0, group: group) }
    }
    for case .tools(let g) in items { g.calls.forEach { visit($0, group: g.eventID) } }
    return Dictionary(grouping: last, by: \.group).mapValues { $0.map(\.page) }
  }
}

extension OmniClient {
  /// Asks the thread that published a page to act on its comments. Queued after the thread's current turn.
  public func checkComments(threadID: String, url: String) async throws(OmniAPIError) -> OmniThread {
    try await send("POST", "/api/threads/\(uriComponent(threadID))/published/comments", body: CommentsBody(url: url))
  }
}

struct CommentsBody: Encodable, Sendable {
  let url: String
}
