import Foundation

/// The terminal_excerpt kind of message context, ported from packages/shared/message-context-terminal.ts: output Ben
/// selected in a thread's Terminal tab, as plain text, with the shell it came from and when. It is a snapshot: the
/// shell goes on and the scrollback scrolls away, and the record does not change. Nothing in it is ever run, since the
/// text holds no control character, so no escape sequence survives into the record or the harness's message.
public enum TerminalExcerptContext: MessageContextKind {
  public static let kind = "terminal_excerpt"
  public static let version = 1
  public static let linesMax = 200
  public static let textMax = 8_000
  public static let cwdMax = 1_024
  private static let idMax = 64
  private static let labelTextMax = 60

  public struct Body: Codable, Hashable, Sendable {
    /// The thread whose shell it was: one shell per thread.
    public let thread: String
    /// The shell's process id, which tells a restarted shell from the one Ben selected in. Nil when the server had none open.
    public let pid: Int?
    /// The directory the shell was started in. A `cd` since is not known.
    public let cwd: String
    /// When Ben added it, as `2026-10-24T09:30:15.250Z`.
    public let capturedAt: String
    /// Lines in `text`.
    public let lines: Int
    /// Plain text, lines joined with `\n`, no control characters.
    public let text: String

    enum CodingKeys: String, CodingKey {
      case thread, pid, cwd, lines, text
      case capturedAt = "captured_at"
    }

    public func encode(to encoder: any Encoder) throws {
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode(thread, forKey: .thread)
      try c.encode(pid, forKey: .pid)
      try c.encode(cwd, forKey: .cwd)
      try c.encode(capturedAt, forKey: .capturedAt)
      try c.encode(lines, forKey: .lines)
      try c.encode(text, forKey: .text)
    }
  }

  /// Why a body does not parse, or why a selection cannot be sent. The text is the TypeScript's.
  public struct SelectionError: Error, Hashable, Sendable {
    public let message: String

    public init(_ message: String) {
      self.message = message
    }
  }

  public static func parse(_ body: JSONValue, v: Int) -> Body? {
    try? check(body, v: v).get()
  }

  public static func label(_ b: Body) -> String {
    let first = b.text.split(separator: "\n", omittingEmptySubsequences: false).first { $0.unicodeScalars.contains { $0 != " " && $0 != "\t" } }
    let trimmed = String(first ?? "").trimmingCharacters(in: CharacterSet(charactersIn: " \t")).replacingOccurrences(of: "\t", with: " ")
    let scalars = Array(trimmed.unicodeScalars)
    let head = scalars.count > labelTextMax ? String(String.UnicodeScalarView(scalars.prefix(labelTextMax - 1))) + "…" : trimmed
    return MessageContext.cutLabel("Terminal, \(b.lines == 1 ? "1 line" : "\(b.lines) lines"): \(head)")
  }

  /// `3 lines selected`, as the detail view says it.
  public static func countLine(_ lines: Int) -> String { "\(lines) \(lines == 1 ? "line" : "lines") selected" }

  // MARK: Parse

  /// A character the record never holds, other than `\n` and `\t`: C0 and C1 controls (so no escape sequence), the line
  /// and paragraph separators, and the bidirectional overrides that make text read as something it is not.
  static func forbidden(_ u: Unicode.Scalar) -> Bool {
    switch u.value {
    case 0x00...0x08, 0x0b...0x1f, 0x7f...0x9f, 0x2028...0x2029, 0x202a...0x202e, 0x2066...0x2069: true
    default: false
    }
  }

  /// One line of text for a field that has no line breaks of its own.
  static func plain(_ v: JSONValue?, _ at: String, _ max: Int) -> Result<String, SelectionError> {
    guard let s = v?.stringValue, !s.isEmpty, !MessageContext.overLimit(s, max) else {
      return .failure(SelectionError("\(at) must be a string of 1 to \(max) characters"))
    }
    if s.unicodeScalars.contains(where: { forbidden($0) || $0 == "\n" || $0 == "\t" }) {
      return .failure(SelectionError("\(at) must be plain text on one line"))
    }
    return .success(s)
  }

  private static let time = Date.ISO8601FormatStyle(includingFractionalSeconds: true)

  /// `2026-10-24T09:30:15.250Z`: that shape exactly and a real time. The milliseconds are not compared after a round
  /// trip through `Date`, which cannot hold most of them exactly (`.094` came back as `.093`); the seconds are, so
  /// `2026-02-31T…` is refused.
  static func validTime(_ s: String) -> Bool {
    let shape = s.wholeMatch(of: #/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z/#) != nil
    guard shape, let date = try? time.parse(s) else { return false }
    return format(date).prefix(19) == s.prefix(19)
  }

  static func format(_ date: Date) -> String { date.formatted(time) }

  /// `parse` with its reason, as `terminalExcerpt.parse` in TypeScript.
  public static func check(_ body: JSONValue, v: Int) -> Result<Body, SelectionError> {
    guard v == 1 else { return .failure(SelectionError("terminal_excerpt has no version \(v)")) }
    guard case .object(let o) = body else { return .failure(SelectionError("not an object")) }
    let thread: String
    switch plain(o["thread"], "thread", idMax) {
    case .success(let t): thread = t
    case .failure(let e): return .failure(e)
    }
    var pid: Int?
    switch o["pid"] {
    case nil, .null?: pid = nil
    case .number(let n)?:
      guard let i = Int(exactly: n), i >= 1 else { return .failure(SelectionError("pid must be a process id or null")) }
      pid = i
    default: return .failure(SelectionError("pid must be a process id or null"))
    }
    let cwd: String
    switch plain(o["cwd"], "cwd", cwdMax) {
    case .success(let c): cwd = c
    case .failure(let e): return .failure(e)
    }
    guard let at = o["captured_at"]?.stringValue, validTime(at) else {
      return .failure(SelectionError("captured_at must be a time like 2026-10-24T09:30:00.000Z"))
    }
    guard let text = o["text"]?.stringValue else { return .failure(SelectionError("text must be a string")) }
    if text.unicodeScalars.contains(where: forbidden) {
      return .failure(SelectionError("text must be plain text: no control characters or escape sequences"))
    }
    if !text.unicodeScalars.contains(where: { $0 != " " && $0 != "\t" && $0 != "\n" }) { return .failure(SelectionError("text is empty")) }
    if MessageContext.overLimit(text, textMax) { return .failure(SelectionError("text is longer than \(textMax) characters")) }
    let lines = text.unicodeScalars.count { $0 == "\n" } + 1
    if lines > linesMax { return .failure(SelectionError("text is longer than \(linesMax) lines")) }
    return .success(Body(thread: thread, pid: pid, cwd: cwd, capturedAt: at, lines: lines, text: text))
  }

  // MARK: Select

  /// What the shell's selection is attached to.
  public struct Source: Sendable {
    public let thread: String
    public let pid: Int?
    public let cwd: String
    public let at: Date

    public init(thread: String, pid: Int?, cwd: String, at: Date) {
      self.thread = thread
      self.pid = pid
      self.cwd = cwd
      self.at = at
    }
  }

  /// Selected terminal text as plain text: escape sequences dropped whole, other control characters dropped, line endings
  /// made `\n`, trailing spaces trimmed and the blank lines around it removed. What is left is what the terminal showed.
  public static func plainText(_ raw: String) -> String {
    var out: [Unicode.Scalar] = []
    let s = Array(raw.unicodeScalars)
    var i = 0
    func at(_ k: Int) -> UInt32? { k < s.count ? s[k].value : nil }
    func skip(_ range: ClosedRange<UInt32>) { while let c = at(i), range.contains(c) { i += 1 } }
    while i < s.count {
      let c = s[i].value
      if c == 0x1b {
        i += 1
        switch at(i) {
        case 0x5d?:  // OSC: to its BEL or ESC \, or up to an ESC that is not one.
          i += 1
          while let c = at(i), c != 0x07, c != 0x1b { i += 1 }
          if at(i) == 0x07 { i += 1 } else if at(i) == 0x1b, at(i + 1) == 0x5c { i += 2 }
        case 0x5b?:  // CSI: parameters, intermediates, and a final byte if there is one.
          i += 1
          skip(0x30...0x3f)
          skip(0x20...0x2f)
          if let c = at(i), (0x40...0x7e).contains(c) { i += 1 }
        default:  // Any other ESC pair.
          skip(0x20...0x2f)
          if let c = at(i), (0x30...0x7e).contains(c) { i += 1 }
        }
      } else if c == 0x0d {
        out.append("\n")
        i += at(i + 1) == 0x0a ? 2 : 1
      } else {
        if !forbidden(s[i]) { out.append(s[i]) }
        i += 1
      }
    }
    var lines = String(String.UnicodeScalarView(out)).split(separator: "\n", omittingEmptySubsequences: false).map { line -> String in
      var scalars = Substring(line).unicodeScalars
      while let last = scalars.last, last == " " || last == "\t" { scalars = scalars.dropLast() }
      return String(String.UnicodeScalarView(scalars))
    }
    while lines.first?.isEmpty == true { lines.removeFirst() }
    while lines.last?.isEmpty == true { lines.removeLast() }
    return lines.joined(separator: "\n")
  }

  /// The record body for what is selected in the terminal now. Refused when nothing is, or when it is more than a message
  /// should carry: it is never cut, since a cut excerpt would not be the output Ben meant.
  public static func select(_ raw: String?, from source: Source) -> Result<Body, SelectionError> {
    let text = plainText(raw ?? "")
    if text.isEmpty { return .failure(SelectionError("Nothing is selected. Select some output first.")) }
    if text.unicodeScalars.count(where: { $0 == "\n" }) + 1 > linesMax { return .failure(SelectionError("Select at most \(linesMax) lines.")) }
    if MessageContext.overLimit(text, textMax) { return .failure(SelectionError("Select at most \(textMax) characters.")) }
    let body: JSONValue = .object([
      "thread": .string(source.thread), "pid": source.pid.map { .number(Double($0)) } ?? .null, "cwd": .string(source.cwd),
      "captured_at": .string(format(source.at)), "text": .string(text),
    ])
    return check(body, v: 1)
  }
}

extension Result where Failure == TerminalExcerptContext.SelectionError {
  /// The error's text, nil on success.
  public var failureMessage: String? { if case .failure(let e) = self { e.message } else { nil } }
}
