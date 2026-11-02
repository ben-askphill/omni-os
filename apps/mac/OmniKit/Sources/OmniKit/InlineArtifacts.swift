import Foundation

/// Where a thread's HTML artifacts render inline in its transcript: `inlineArtifactsByGroup` in
/// packages/shared/inline-artifacts.ts. packages/test-fixtures/inline-artifacts.json keeps the two in step.
public enum InlineArtifacts {
  /// Every harness adapter reports a file write as one of these, with the file in `input.file_path`.
  static let writes: Set<String> = ["Write", "Edit", "MultiEdit"]
  /// The tallest an inline page grows before it scrolls inside its frame. A page that grows with its frame stops here.
  public static let maxHeight: Double = 6000

  public struct Call: Sendable {
    public let name: String
    public let input: JSONValue
    /// nil while the call runs.
    public let isError: Bool?
    public let at: Date

    public init(name: String, input: JSONValue, isError: Bool?, at: Date) {
      self.name = name
      self.input = input
      self.isError = isError
      self.at = at
    }
  }

  /// One tool group: its event id and every call in it, sub-agents' calls included.
  public struct Group: Sendable {
    public let key: Int
    public let calls: [Call]

    public init(key: Int, calls: [Call]) {
      self.key = key
      self.calls = calls
    }
  }

  public protocol Candidate {
    var threadID: String { get }
    var path: String { get }
    var kind: String { get }
    var updatedAt: Date { get }
  }

  public static func rendersInline(kind: String) -> Bool { kind == "html" }

  /// The file inside the thread's folder (`/<thread>/artifacts/x.html`), so a path through a symlink still matches.
  static func threadTail(_ a: some Candidate) -> String {
    guard let r = a.path.range(of: "/\(a.threadID)/", options: .backwards) else { return a.path }
    return String(a.path[r.lowerBound...])
  }

  static func wrote(_ c: Call, _ a: some Candidate) -> Bool {
    guard writes.contains(c.name), c.isError == false, let file = c.input["file_path"]?.stringValue else { return false }
    return file == a.path || file.hasSuffix(threadTail(a))
  }

  /// Each HTML artifact under the last group that wrote it. A file no call wrote goes under the last group that
  /// started before its last change; one that changed before any group is not shown inline.
  public static func byGroup<A: Candidate>(_ groups: [Group], _ artifacts: [A]) -> [Int: [A]] {
    var out: [Int: [A]] = [:]
    for a in artifacts where rendersInline(kind: a.kind) {
      let key =
        groups.last { g in g.calls.contains { wrote($0, a) } }?.key
        ?? groups.last { g in g.calls.first.map { $0.at <= a.updatedAt } ?? false }?.key
      if let key { out[key, default: []].append(a) }
    }
    return out
  }

  /// The transcript's tool groups, by the event id its rows use.
  public static func byGroup(_ items: [TranscriptItem], artifacts: [Artifact]) -> [Int: [Artifact]] {
    func flat(_ calls: [ToolCall]) -> [Call] {
      calls.flatMap { [Call(name: $0.name, input: $0.use.input, isError: $0.result?.isError, at: $0.at)] + flat($0.children) }
    }
    let groups = items.compactMap { item -> Group? in
      if case .tools(let g) = item { Group(key: g.eventID, calls: flat(g.calls)) } else { nil }
    }
    return byGroup(groups, artifacts)
  }
}

extension Artifact: InlineArtifacts.Candidate {}
