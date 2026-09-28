import Foundation

/// Where a thread's turn is, read from its events as the Web UI does (web/src/status-line.ts, and betweenTurns in
/// web/src/pages/Thread.tsx).
public enum StatusLine {
  /// The label next to the spinner while a thread runs: the newest status since Ben's last message, or nil for
  /// the default. An empty status clears an earlier one, as when Codex finishes compacting mid-turn.
  public static func label(_ events: some BidirectionalCollection<EventRow>) -> String? {
    for e in events.reversed() {
      if e.kind == "user" { return nil }
      guard e.kind == "status" else { continue }
      let text =
        switch e.content {
        case .status(let t): t
        case .unknown(_, let payload): ToolText.str(payload["text"])
        default: ""
        }
      return text.isEmpty ? nil : text
    }
    return nil
  }

  /// No turn is going: the last thing that happened ended one, or nothing has happened yet. A message the agent
  /// never saw does not count as a start.
  public static func betweenTurns(_ events: some BidirectionalCollection<EventRow>) -> Bool {
    for e in events.reversed() {
      switch e.kind {
      case "result", "error": return true
      case "user", "crew_report": if !dropped(e) { return false }
      case "tool_use", "tool_result", "assistant_text": return false
      default: break
      }
    }
    return true
  }

  private static func dropped(_ e: EventRow) -> Bool {
    switch e.content {
    case .user(let m): m.dropped == true
    case .crewReport(let r): r.dropped == true
    case .unknown(_, let payload): ToolText.truthy(payload["dropped"])
    default: false
    }
  }
}
