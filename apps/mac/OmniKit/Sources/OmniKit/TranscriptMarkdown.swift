import Foundation

/// A thread as Markdown, for Copy on a row and Copy Thread as Markdown.
public enum TranscriptMarkdown {
  public static func thread(title: String, items: [TranscriptItem], cwd: String?) -> String {
    (["# " + title] + items.map { block($0, cwd: cwd) }).joined(separator: "\n\n") + "\n"
  }

  /// What Copy on one row puts on the pasteboard: the text as it reads, without the labels around it.
  public static func copyText(_ item: TranscriptItem, cwd: String?) -> String {
    switch item {
    case .user(_, _, let m): m.text
    case .text(_, _, let s): s
    case .tools(let g): g.calls.flatMap { lines($0, depth: 0, cwd: cwd) }.joined(separator: "\n")
    case .plan(let p): checklist(p)
    case .result(_, let r): r.line
    case .error(_, let s): s
    case .report(_, _, let r): r.text
    case .mod(_, let lines): lines.map { "\($0.plugin): \($0.text)" }.joined(separator: "\n")
    }
  }

  private static func block(_ item: TranscriptItem, cwd: String?) -> String {
    switch item {
    case .user(_, _, let m):
      var head = "**\(m.author)**"
      if m.dropped == true {
        head += " · Not sent"
      } else if let send = m.sendLabel {
        head += " · " + send
      }
      var parts = [head, m.text]
      if let files = m.attachments, !files.isEmpty { parts.append("Attached: " + files.map(\.name).joined(separator: ", ")) }
      return parts.joined(separator: "\n\n")
    case .plan(let p):
      return "**Plan** \(p.done)/\(p.todos.count)\n\n" + checklist(p)
    case .result(_, let r):
      return "*\(r.line)*"
    case .error(_, let s):
      return "**Error**\n\n" + fenced(s)
    case .report(_, _, let r):
      var head = "**Report from \(r.role.flatMap { $0.isEmpty ? nil : $0 } ?? "crew")**"
      for bit in [r.taskID, r.status] { if let bit, !bit.isEmpty { head += " · " + bit } }
      if r.dropped == true { head += " · Not delivered" }
      var parts = [head]
      if let title = r.title, !title.isEmpty { parts.append("**\(title)**") }
      parts.append(r.text.isEmpty ? "(no reply)" : r.text)
      return parts.joined(separator: "\n\n")
    case .mod(_, let lines):
      return lines.map { "*\($0.plugin)* \($0.text)" }.joined(separator: "\n")
    case .text, .tools:
      return copyText(item, cwd: cwd)
    }
  }

  private static func lines(_ c: ToolCall, depth: Int, cwd: String?) -> [String] {
    var line = String(repeating: "  ", count: depth) + "- " + c.label
    let summary = c.summary(cwd: cwd)
    if !summary.isEmpty { line += " " + code(summary) }
    if c.isFailed { line += " (error)" } else if c.isStopped { line += " (stopped)" }
    return [line] + c.children.flatMap { lines($0, depth: depth + 1, cwd: cwd) }
  }

  private static func checklist(_ p: Plan) -> String {
    p.todos.map { "- [\($0.status == "completed" ? "x" : " ")] \($0.content ?? "")" }.joined(separator: "\n")
  }

  /// An inline code span that holds any backticks in `s`.
  private static func code(_ s: String) -> String {
    let fence = String(repeating: "`", count: longestRun(of: "`", in: s) + 1)
    let pad = s.hasPrefix("`") || s.hasSuffix("`") ? " " : ""
    return fence + pad + s + pad + fence
  }

  /// A code block whose fence no line of `s` can close.
  private static func fenced(_ s: String) -> String {
    let fence = String(repeating: "`", count: max(3, longestRun(of: "`", in: s) + 1))
    return fence + "\n" + s + "\n" + fence
  }

  private static func longestRun(of c: Character, in s: String) -> Int {
    var best = 0
    var run = 0
    for ch in s {
      run = ch == c ? run + 1 : 0
      best = max(best, run)
    }
    return best
  }
}

extension UserMessage {
  /// Who the Markdown export says wrote it.
  var author: String {
    switch source {
    case "conductor": "Conductor"
    case "automation": "Automation"
    case "capture": "Captured"
    case "import": "Imported"
    default: "You"
    }
  }
}
