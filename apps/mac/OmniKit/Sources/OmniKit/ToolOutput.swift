import Foundation

// Tool output on the wire (#225): a tool_result row travels as a short preview and its size, its saved output is read
// in bounded chunks when a row opens, and a running command's output is followed through a bounded tail. The client
// half of packages/shared/tool-output.ts, which is the source of truth. Why and how: docs/internals/thread-history.md.

/// The limits of `TOOL_OUTPUT` a client uses. Sizes are code points unless a name says otherwise.
public enum ToolOutputLimit {
  /// Code points of text a compact tool_result carries.
  public static let preview = 1024
  /// UTF-16 units of a tail a client keeps.
  public static let clientTail = 64 * 1024
}

/// What a compact tool_result says about its saved output, in `payload.output`.
public struct ToolOutputMeta: Decodable, Hashable, Sendable {
  /// Code points of the saved text.
  public let chars: Int
  /// Lines of the saved text: its line breaks plus one.
  public let lines: Int
  /// From a leading "Exit code N" line, when the text has one.
  public let exitCode: Int?

  enum CodingKeys: String, CodingKey {
    case chars, lines
    case exitCode = "exit_code"
  }
}

/// GET /api/threads/:id/events/:eventId/output: one chunk of a tool_result's saved text.
public struct OutputChunk: Decodable, Hashable, Sendable {
  public let eventID: Int
  public let toolUseID: String
  /// Where `text` starts.
  public let offset: Int
  public let text: String
  /// Where the next chunk starts, nil at the end. Sent back as it is, never computed.
  public let next: Int?
  /// Code points of the saved text.
  public let total: Int
  public let isError: Bool
  /// The saved text itself was cut when the harness reported it. Shown after the last chunk.
  public let truncated: Bool
  public let exitCode: Int?

  enum CodingKeys: String, CodingKey {
    case offset, text, next, total, truncated
    case eventID = "event_id"
    case toolUseID = "tool_use_id"
    case isError = "is_error"
    case exitCode = "exit_code"
  }
}

/// One message of GET /api/threads/:id/tools/:toolUseId/tail.
public enum TailMessage: Decodable, Hashable, Sendable {
  /// `text` goes after the held tail, or in its place on `reset`, after `skipped` UTF-16 units dropped before it.
  case tail(text: String, reset: Bool, skipped: Int)
  /// The stream is over: the call finished, or, with `live` false, the server has no live output for it (Claude Code,
  /// Cursor and Hermes report a tool's output only when it ends).
  case end(live: Bool)

  enum CodingKeys: String, CodingKey {
    case kind, text, reset, skipped, live
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(String.self, forKey: .kind) {
    case "tail":
      self = .tail(
        text: try c.decode(String.self, forKey: .text), reset: try c.decodeIfPresent(Bool.self, forKey: .reset) ?? false,
        skipped: try c.decode(Int.self, forKey: .skipped))
    case "end":
      self = .end(live: try c.decode(Bool.self, forKey: .live))
    case let kind:
      throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown tail message \(kind)")
    }
  }
}

/// The saved output an open row holds (`LoadedOutput`): what its chunks add up to, and where the next one starts.
public struct LoadedOutput: Hashable, Sendable {
  public let text: String
  /// The next offset to ask for, nil once the saved output is held whole.
  public let next: Int?
  public let total: Int
  public let truncated: Bool

  /// Nothing held yet (`noOutput`): the first chunk starts at 0.
  public static let empty = LoadedOutput(text: "", next: 0, total: 0, truncated: false)

  /// Code points of the saved output not held yet. From `next`, not by counting the held text, which grows to megabytes.
  public var left: Int { next.map { total - $0 } ?? 0 }

  /// `applyChunk`. A chunk that does not start where the held text ends (a repeat, a late answer) changes nothing.
  public func joining(_ c: OutputChunk) -> LoadedOutput {
    guard let next, c.offset == next else { return self }
    return LoadedOutput(text: text + c.text, next: c.next, total: c.total, truncated: c.truncated)
  }
}

/// A running call's output as an open row holds it: the newest `clientTail` UTF-16 units at most.
public struct LiveTail: Hashable, Sendable {
  public private(set) var text = ""
  /// Older output was dropped since the last reset, by the server (`skipped`) or by the cap.
  public private(set) var cut = false

  public init() {}

  public mutating func apply(text more: String, reset: Bool, skipped: Int, cap: Int = ToolOutputLimit.clientTail) {
    let whole = (reset ? 0 : text.utf16.count) + more.utf16.count
    let kept = ToolOutput.applyTail(text, more, reset: reset, cap: cap)
    cut = (!reset && cut) || skipped > 0 || kept.utf16.count < whole
    text = kept
  }
}

extension ToolResult {
  /// The code a failed command exited with: the compact row's, else read from the text.
  public var exitCode: Int? { output?.exitCode ?? ToolOutput.exitCode(of: text) }
}

/// The pure functions of packages/shared/tool-output.ts.
public enum ToolOutput {
  /// `exitCodeOf`: the code a result's text starts with ("Exit code 1" is how Claude Code, Codex and Cursor report a
  /// failed command).
  public static func exitCode(of text: String) -> Int? {
    let prefix = "Exit code "
    guard text.utf8.starts(with: prefix.utf8) else { return nil }
    let line = text.utf8.dropFirst(prefix.utf8.count).prefix { $0 != UInt8(ascii: "\n") }
    let digits = line.first == UInt8(ascii: "-") ? line.dropFirst() : line
    guard (1...10).contains(digits.count), digits.allSatisfy({ (UInt8(ascii: "0")...UInt8(ascii: "9")).contains($0) }) else {
      return nil
    }
    return Int(String(decoding: line, as: UTF8.self))
  }

  /// `outputQuery`. No limit asks for the server's default.
  public static func query(offset: Int, limit: Int? = nil) -> [(String, String)] {
    var q = [("offset", String(offset))]
    if let limit, limit > 0 { q.append(("limit", String(limit))) }
    return q
  }

  /// `applyTail`: `text` after `held` (in its place on `reset`), keeping the newest `cap` UTF-16 units and never
  /// starting on the second half of a surrogate pair.
  public static func applyTail(_ held: String, _ text: String, reset: Bool, cap: Int = ToolOutputLimit.clientTail) -> String {
    let joined = (reset ? "" : held) + text
    let units = joined.utf16
    guard units.count > cap else { return joined }
    var cut = units.index(units.startIndex, offsetBy: units.count - cap)
    if UTF16.isTrailSurrogate(units[cut]) { cut = units.index(after: cut) }
    return String(joined.unicodeScalars[cut...])
  }
}

/// What an open tool row reads.
public enum ToolOutputSource: Hashable, Sendable {
  /// The call runs: follow what it prints.
  case live(threadID: String, toolUseID: String)
  /// A compact result: read its saved output from row `eventID`.
  case saved(threadID: String, eventID: Int)

  /// What `call`'s open row reads. Nil when it has nothing to read: a whole result, or no result in a thread that
  /// is not running.
  public init?(_ call: ToolCall, threadID: String, running: Bool) {
    if let result = call.result {
      guard result.output != nil else { return nil }
      self = .saved(threadID: threadID, eventID: result.eventID)
    } else {
      guard running else { return nil }
      self = .live(threadID: threadID, toolUseID: call.callID)
    }
  }
}

/// The reads an open tool row makes. `OmniClient` is one; tests pass a fake.
public protocol ToolOutputAPI: Sendable {
  func toolOutputChunk(threadID: String, eventID: Int, offset: Int) async throws(OmniAPIError) -> OutputChunk
  /// The tail's messages, until `end`. Ending the iteration closes the connection.
  func toolTail(threadID: String, toolUseID: String) -> AsyncStream<TailMessage>
}

/// One open tool row's output. `run` is the row's task: closing the row cancels it, which cancels the chunk in flight
/// and closes the tail, and the row drops the model with everything it held.
@MainActor @Observable
public final class ToolOutputModel {
  /// The saved output's chunks joined, nil until the first lands.
  public private(set) var saved: LoadedOutput?
  /// A chunk is on the way.
  public private(set) var loading = false
  /// The last chunk read failed. `more()` asks for it again.
  public private(set) var error: OmniAPIError?
  /// What the running call printed. Nil before its first message, and once the server says it has no live output.
  public private(set) var live: LiveTail?

  @ObservationIgnored private var asks: AsyncStream<Void>.Continuation?

  public init() {}

  /// Load more, or Retry after a failure: reads the next chunk. Nothing while one is on the way.
  public func more() {
    guard !loading else { return }
    asks?.yield()
  }

  /// Follows the tail, or reads the first chunk and then one more for each `more()`. Returns when the tail ends or
  /// the task is cancelled.
  public func run(_ source: ToolOutputSource, api: any ToolOutputAPI) async {
    switch source {
    case .live(let thread, let call):
      await follow(api.toolTail(threadID: thread, toolUseID: call))
    case .saved(let thread, let event):
      live = nil
      await read { offset throws(OmniAPIError) in try await api.toolOutputChunk(threadID: thread, eventID: event, offset: offset) }
    }
  }

  private func follow(_ tail: AsyncStream<TailMessage>) async {
    for await m in tail {
      switch m {
      case .tail(let text, let reset, let skipped):
        var held = live ?? LiveTail()
        held.apply(text: text, reset: reset, skipped: skipped)
        live = held
      case .end(let isLive):
        if !isLive { live = nil }
        return
      }
    }
  }

  private func read(_ chunk: (Int) async throws(OmniAPIError) -> OutputChunk) async {
    let (asked, asks) = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
    self.asks = asks
    defer { self.asks = nil }
    // A row back in view keeps what it read, and reads more only when asked.
    if saved == nil { await fetch(chunk) }
    for await _ in asked { await fetch(chunk) }
  }

  private func fetch(_ chunk: (Int) async throws(OmniAPIError) -> OutputChunk) async {
    let held = saved ?? .empty
    guard let offset = held.next else { return }
    loading = true
    error = nil
    defer { loading = false }
    do {
      saved = held.joining(try await chunk(offset))
    } catch {
      if error != .cancelled { self.error = error }
    }
  }
}
