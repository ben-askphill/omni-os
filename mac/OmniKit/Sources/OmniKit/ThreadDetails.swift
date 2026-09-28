import Foundation

/// One MCP server from the session's init line, `name:status`.
public struct MCPServer: Hashable, Sendable, Identifiable {
  public let raw: String
  public let name: String
  public let status: String

  public var id: String { raw }
  public var ok: Bool { status.isEmpty || status == "connected" }

  /// A bare UUID name is cut to its first eight characters.
  public var label: String {
    let uuid = name.count == 36 && name.range(of: "^[0-9a-f]{8}-[0-9a-f-]{27}$", options: [.regularExpression, .caseInsensitive]) != nil
    return uuid ? "\(name.prefix(8))…" : name
  }

  public init(_ raw: String) {
    self.raw = raw
    if let cut = raw.lastIndex(of: ":"), cut > raw.startIndex {
      name = String(raw[..<cut])
      status = String(raw[raw.index(after: cut)...])
    } else {
      name = raw
      status = ""
    }
  }
}

/// The Details tab's rules (DetailsTab in web/src/pages/Thread.tsx).
public enum ThreadDetails {
  public static func shellQuote(_ s: String) -> String {
    s.range(of: #"^[\w@%+=:,./-]+$"#, options: .regularExpression) != nil ? s : "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
  }

  /// The command that resumes the session in a terminal. nil while the thread has no session.
  public static func resumeCommand(harness: HarnessID, sessionID: String?, cwd: String?) -> String? {
    // Hermes runs on its own server, so there is nothing to resume in a terminal.
    guard let sessionID, !sessionID.isEmpty, harness != .hermes else { return nil }
    let command =
      switch harness {
      case .codex: "codex resume \(sessionID)"
      case .cursor: "cursor-agent --resume \(sessionID)"
      default: "claude --resume \(sessionID)"
      }
    return "cd \(shellQuote(cwd ?? "")) && \(command)"
  }

  public static func harnessName(_ id: HarnessID) -> String {
    switch id {
    case .claudeCode: "Claude Code"
    case .codex: "Codex"
    case .cursor: "Cursor Agent"
    case .hermes: "Hermes"
    default: id.rawValue
    }
  }

  /// A JSON artifact indented as the Web UI shows it. nil when it does not parse.
  public static func prettyJSON(_ text: String) -> String? { JSONPretty.print(text) }

  /// "Mon 28 Sept, 14:05".
  public static func fullDate(_ date: Date, calendar: Calendar = Format.localCalendar) -> String {
    let c = calendar.dateComponents([.weekday, .day, .month], from: date)
    let weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"]
    return "\(weekdays[(c.weekday ?? 1) - 1]) \(c.day ?? 1) \(months[(c.month ?? 1) - 1]), \(Format.clock(date, calendar: calendar))"
  }
}
