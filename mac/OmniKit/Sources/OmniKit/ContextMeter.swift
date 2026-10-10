import Foundation
import Observation

/// How full a thread's context window is and what fills it: ContextUsage in shared/context-meter.ts, as the
/// stream's `context` message and GET /api/threads/:id/context carry it.
public struct ContextUsage: Decodable, Hashable, Sendable {
  /// Tokens in the window on the last call to the model.
  public let used: Double
  /// The window the harness compacts against, or nil when it has not said.
  public let max: Double?
  /// The model's own window, when an autocompact window setting narrows `max`.
  public let modelWindow: Double?
  /// Where autocompact starts, when it is on.
  public let autoCompactAt: Double?
  public let model: String?
  /// claude-cli, claude-stream, claude-transcript or codex.
  public let source: String
  /// The CLI's split of `used`, plus free space and the autocompact buffer. Estimated by the CLI.
  public let categories: [Category]?
  /// Tokens per tool among the conversation's messages. Estimated by the CLI.
  public let tools: [Tool]?
  /// CLAUDE.md, rules and memory files, by path.
  public let memoryFiles: [MemoryFile]?
  public let updatedAt: Date

  public struct Category: Decodable, Hashable, Sendable {
    public let name: String
    public let tokens: Double
    /// used: in the window now. free: room left. buffer: kept free for autocompact.
    public let kind: String
  }

  public struct Tool: Decodable, Hashable, Sendable {
    public let name: String
    public let callTokens: Double
    public let resultTokens: Double
    public var tokens: Double { callTokens + resultTokens }
  }

  public struct MemoryFile: Decodable, Hashable, Sendable {
    public let path: String
    public let tokens: Double
  }

  enum CodingKeys: String, CodingKey {
    case used, max, modelWindow, autoCompactAt, model, source, categories, tools, memoryFiles
    case updatedAt = "updated_at"
  }

  public init(
    used: Double, max: Double?, modelWindow: Double? = nil, autoCompactAt: Double? = nil, model: String? = nil,
    source: String, categories: [Category]? = nil, tools: [Tool]? = nil, memoryFiles: [MemoryFile]? = nil, updatedAt: Date
  ) {
    self.used = used
    self.max = max
    self.modelWindow = modelWindow
    self.autoCompactAt = autoCompactAt
    self.model = model
    self.source = source
    self.categories = categories
    self.tools = tools
    self.memoryFiles = memoryFiles
    self.updatedAt = updatedAt
  }

  public var percent: Double? { ContextMeter.percent(used: used, max: max) }
  public var level: ContextMeter.Level { ContextMeter.level(percent) }
  /// "62.4K / 270K tokens (23%)", or "62.4K tokens" with no window.
  public var summary: String {
    guard let p = percent, let max else { return "\(ContextMeter.formatTokens(used)) tokens" }
    return "\(ContextMeter.formatTokens(used)) / \(ContextMeter.formatTokens(max)) tokens (\(Int(p.rounded()))%)"
  }
  /// What fills the window, then the room left, each with tokens.
  public var usedCategories: [Category] { (categories ?? []).filter { $0.kind == "used" && $0.tokens > 0 } }
  public var roomCategories: [Category] { (categories ?? []).filter { $0.kind != "used" && $0.tokens > 0 } }
  /// The six tools with the most tokens.
  public var topTools: [Tool] { Array((tools ?? []).sorted { $0.tokens > $1.tokens }.prefix(6)) }

  /// Which numbers are exact, for the panel's footnote.
  public var sourceNote: String {
    switch source {
    case "claude-cli": "From Claude Code at the end of the last turn."
    case "claude-stream": "Total from the last model call. The split updates when the turn ends."
    case "claude-transcript": "Read from the session file. Open a turn for the full split."
    case "codex": "From Codex. Codex reports a total only."
    default: "From the agent."
    }
  }
}

/// One tool result, estimated from its length in the session file.
public struct ContextResult: Decodable, Hashable, Sendable {
  public let tool: String
  /// What it read or ran: a path, a command, a query.
  public let label: String
  public let tokens: Double
}

/// GET /api/threads/:id/context.
public struct ContextView: Decodable, Hashable, Sendable {
  /// nil when the harness reports nothing, or the thread has not run yet.
  public let context: ContextUsage?
  /// The biggest tool results in the window. Estimated. Claude Code only.
  public let largest: [ContextResult]
  public let compact: Compact

  public struct Compact: Decodable, Hashable, Sendable {
    public let ok: Bool
    public let reason: String?
    /// The harness takes a focus line (Claude Code).
    public let focus: Bool
  }
}

/// The meter's math, from shared/context-meter.ts.
public enum ContextMeter {
  public enum Level: Sendable { case ok, warn, critical }

  public static let warnAt = 70.0
  public static let criticalAt = 90.0

  /// The harnesses that report their window. The meter stays out of Cursor and Hermes threads.
  public static let metered: Set<HarnessID> = [.claudeCode, .codex]

  /// Percent of the window in use, 0 to 100, or nil with no window to measure against.
  public static func percent(used: Double, max: Double?) -> Double? {
    guard let max, max > 0, used.isFinite else { return nil }
    return Swift.min(100, Swift.max(0, used / max * 100))
  }

  public static func level(_ percent: Double?) -> Level {
    guard let percent else { return .ok }
    if percent >= criticalAt { return .critical }
    if percent >= warnAt { return .warn }
    return .ok
  }

  /// 950, 12.4K, 200K, 1M, 1.25M.
  public static func formatTokens(_ n: Double) -> String {
    let a = abs(n)
    if a >= 1_000_000 { return trim(n / 1_000_000, digits: 2) + "M" }
    if a >= 1_000 { return trim(n / 1_000, digits: a >= 100_000 ? 0 : 1) + "K" }
    return String(Int(n.rounded()))
  }

  private static func trim(_ v: Double, digits: Int) -> String {
    var s = String(format: "%.\(digits)f", v)
    if s.contains(".") {
      while s.hasSuffix("0") { s.removeLast() }
      if s.hasSuffix(".") { s.removeLast() }
    }
    return s
  }

  /// The newer of two readings. The stream's push wins a tie: it is the live one.
  public static func newest(_ a: ContextUsage?, _ pushed: ContextUsage?) -> ContextUsage? {
    guard let a else { return pushed }
    guard let pushed else { return a }
    return pushed.updatedAt >= a.updatedAt ? pushed : a
  }

  /// mcp__server__tool reads as "server: tool".
  public static func shortTool(_ name: String) -> String {
    guard name.hasPrefix("mcp__") else { return name }
    let rest = name.dropFirst(5)
    guard let sep = rest.range(of: "__"), sep.lowerBound > rest.startIndex else { return name }
    var server = String(rest[..<sep.lowerBound])
    if server.hasPrefix("claude_ai_") { server.removeFirst("claude_ai_".count) }
    return "\(server.replacingOccurrences(of: "_", with: " ")): \(rest[sep.upperBound...])"
  }

  /// A path inside the thread's folder relative to it, and one in a home folder from ~.
  public static func shortPath(_ path: String, cwd: String?) -> String {
    if let cwd, !cwd.isEmpty {
      let base = cwd.hasSuffix("/") ? String(cwd.dropLast()) : cwd
      if path.hasPrefix(base + "/") { return String(path.dropFirst(base.count + 1)) }
    }
    for home in ["/Users/", "/home/"] where path.hasPrefix(home) {
      let rest = path.dropFirst(home.count)
      if let slash = rest.firstIndex(of: "/"), slash > rest.startIndex { return "~/" + rest[rest.index(after: slash)...] }
    }
    return path
  }
}

/// The calls the context meter makes. `OmniClient` is one; tests pass a fake.
public protocol ContextAPI: Sendable {
  func threadContext(_ id: String, refresh: Bool) async throws(OmniAPIError) -> ContextView
  func compactThread(_ id: String, focus: String?) async throws(OmniAPIError) -> OmniThread
}

extension OmniClient: ContextAPI {
  /// `refresh` first asks a warm Claude Code process for its own split.
  public func threadContext(_ id: String, refresh: Bool = false) async throws(OmniAPIError) -> ContextView {
    try await send("GET", "/api/threads/\(uriComponent(id))/context", query: refresh ? [("refresh", "1")] : [])
  }

  /// The harness's own /compact, as a message. Claude Code keeps what `focus` names; Codex ignores it.
  public func compactThread(_ id: String, focus: String? = nil) async throws(OmniAPIError) -> OmniThread {
    try await send("POST", "/api/threads/\(uriComponent(id))/compact", body: CompactBody(focus: focus))
  }
}

struct CompactBody: Encodable, Sendable {
  let focus: String?
}

/// One thread's meter: the server's view, merged with the stream's pushed reading, and the Compact action.
@MainActor @Observable
public final class ContextModel {
  public let threadID: String
  public private(set) var view: ContextView?
  public private(set) var refreshing = false
  public private(set) var sending = false
  /// Compact was sent and its turn has not ended yet.
  public private(set) var compacting = false
  public private(set) var error: OmniAPIError?
  @ObservationIgnored private let api: any ContextAPI

  public init(threadID: String, api: any ContextAPI) {
    self.threadID = threadID
    self.api = api
  }

  /// The reading to show: the newer of the server's and the stream's.
  public func context(pushed: ContextUsage?) -> ContextUsage? {
    ContextMeter.newest(view?.context, pushed)
  }

  /// Why Compact is off, or nil when it can run.
  public func compactBlocked(busy: Bool) -> String? {
    if busy { return "Wait for the current turn to finish." }
    guard let compact = view?.compact else { return "Loading" }
    return compact.ok ? nil : compact.reason ?? "Compact is not available."
  }

  /// Loads the view. A failure keeps the last one; the stream brings the next reading.
  public func load(refresh: Bool = false) async {
    if refresh { refreshing = true }
    defer { if refresh { refreshing = false } }
    if let v = try? await api.threadContext(threadID, refresh: refresh) { view = v }
  }

  /// Sends the harness's /compact. Returns the thread the server answered with, nil on a failure (see `error`).
  @discardableResult
  public func compact(focus: String) async -> OmniThread? {
    sending = true
    error = nil
    defer { sending = false }
    let line = focus.trimmingCharacters(in: .whitespacesAndNewlines)
    do {
      let t = try await api.compactThread(threadID, focus: view?.compact.focus == true && !line.isEmpty ? line : nil)
      compacting = true
      return t
    } catch {
      self.error = error
      return nil
    }
  }

  /// The thread's turn ended: Compact is done, and the view moves on with it.
  public func turnEnded() async {
    compacting = false
    await load()
  }
}
