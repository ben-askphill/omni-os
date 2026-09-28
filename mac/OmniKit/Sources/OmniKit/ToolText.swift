import Foundation

/// How the transcript names and sums up a tool call, as the Web UI does (toolLabel, toolSummary and toolIcon in
/// web/src/components/Transcript.tsx).
public enum ToolText {
  /// "Bash", or an MCP tool as its server and name: "github · search_issues".
  public static func label(_ name: String) -> String {
    guard name.hasPrefix("mcp__") else { return name }
    let rest = name.dropFirst(5)
    guard let sep = rest.dropFirst().range(of: "__"), sep.upperBound < rest.endIndex else { return name }
    var server = String(rest[..<sep.lowerBound])
    if isUUIDish(server) {
      server = "mcp"
    } else if server.hasPrefix("plugin_") {
      let after = server.dropFirst(7)
      if let us = after.firstIndex(of: "_"), us > after.startIndex { server = String(after[after.index(after: us)...]) }
    }
    return "\(server) · \(rest[sep.upperBound...])"
  }

  /// One line on what the call does: the command, the file, the pattern, the url.
  public static func summary(_ use: ToolUse, cwd: String?) -> String {
    let i = Input(use)
    switch use.name {
    case "Bash", "BashOutput": return firstLine(i.str("command") || i.str("description") || i.str("bash_id"))
    case "Read", "Edit", "Write", "MultiEdit", "NotebookEdit", "NotebookRead":
      return Format.shortPath(i.str("file_path") || i.str("notebook_path"), cwd: cwd)
    case "Glob": return i.str("pattern")
    case "Grep": return i.str("pattern") + (truthy(i["path"]) ? "  in \(Format.shortPath(i.str("path"), cwd: cwd))" : "")
    case "WebFetch": return i.str("url")
    case "WebSearch": return i.str("query")
    case "Task", "Agent": return i.str("description") + (truthy(i["subagent_type"]) ? " (\(i.str("subagent_type")))" : "")
    case "TodoWrite":
      guard case .array(let todos) = i["todos"] else { return "0/0 done" }
      return "\(todos.count { $0["status"] == .string("completed") })/\(todos.count) done"
    case "Skill": return i.str("skill") || i.str("command")
    case "KillShell", "KillBash": return i.str("shell_id")
    default: break
    }
    for k in ["url", "query", "q", "path", "file_path", "selector", "name", "title", "id", "command", "prompt", "text"] {
      let s = i.str(k)
      if !s.isEmpty { return firstLine(s) }
    }
    for v in i.values {
      let s = str(v)
      if !s.isEmpty { return firstLine(s) }
    }
    return ""
  }

  /// An SF Symbol for the call's row.
  public static func icon(_ name: String) -> String {
    switch name {
    case "Bash", "BashOutput": "terminal"
    case "Read", "Edit", "Write", "MultiEdit", "Glob", "Grep": "doc"
    case "WebFetch", "WebSearch": "globe"
    case _ where name.contains("browser"): "globe"
    case "Task", "Agent": "square.3.layers.3d"
    default: "wrench.and.screwdriver"
    }
  }

  /// The summary is a command, path or pattern, set in monospace.
  public static func isMonospaced(_ name: String) -> Bool {
    ["Bash", "Read", "Edit", "Write", "MultiEdit", "Glob", "Grep"].contains(name)
  }

  /// The first line, trimmed, cut to `max` characters with "...".
  public static func firstLine(_ s: String, max: Int = 160) -> String {
    let line = s.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).first ?? ""
    return line.count > max ? line.prefix(max - 1) + "..." : String(line)
  }

  /// A value as the Web UI's `str` prints it: strings, numbers and booleans; anything else is empty.
  public static func str(_ v: JSONValue?) -> String {
    switch v {
    case .string(let s): s
    case .number(let n): jsNumber(n)
    case .bool(let b): b ? "true" : "false"
    default: ""
    }
  }

  static func jsNumber(_ n: Double) -> String {
    if n == n.rounded(), abs(n) < 1e18 { return String(Int64(n)) }
    return "\(n)"
  }

  /// JavaScript truthiness.
  static func truthy(_ v: JSONValue?) -> Bool {
    switch v {
    case nil, .null: false
    case .bool(let b): b
    case .number(let n): n != 0
    case .string(let s): !s.isEmpty
    case .array, .object: true
    }
  }

  private static func isUUIDish(_ s: String) -> Bool {
    let hex = Set("0123456789abcdef")
    let chars = Array(s)
    guard chars.count >= 36, chars[8] == "-" else { return false }
    return chars[..<8].allSatisfy(hex.contains) && chars[9...].allSatisfy { hex.contains($0) || $0 == "-" }
  }

  /// A call's input the way the Web UI sees it: an object, or anything else wrapped as `{value}`.
  private struct Input {
    let fields: [String: JSONValue]
    /// Its values in JavaScript's order.
    let values: [JSONValue]

    init(_ use: ToolUse) {
      switch use.input {
      case .object(let o):
        fields = o
        let keys = use.inputKeys.filter { o[$0] != nil }
        values = (keys.count == o.count ? keys : JSONKeyOrder.jsOrder(o.keys.sorted())).compactMap { o[$0] }
      case .array(let a):
        fields = [:]
        values = a
      default:
        fields = ["value": use.input]
        values = [use.input]
      }
    }

    subscript(_ key: String) -> JSONValue? { fields[key] }
    func str(_ key: String) -> String { ToolText.str(fields[key]) }
  }
}

/// JavaScript's `a || b` for strings.
private func || (a: String, b: @autoclosure () -> String) -> String { a.isEmpty ? b() : a }

/// The keys of an object in JSON text, in the order the Web UI lists them. `JSONValue` keeps no order, and a
/// summary falls back to a call's first string value.
enum JSONKeyOrder {
  /// The keys of the object under `key` in the JSON object `json`.
  static func keys(ofObjectAt key: String, in json: String) -> [String] {
    var s = Scanner(Array(json.utf8))
    guard let members = s.members(), let start = members.last(where: { $0.key == key })?.value else { return [] }
    s.i = start
    guard let inner = s.members() else { return [] }
    var seen = Set<String>()
    return jsOrder(inner.map(\.key).filter { seen.insert($0).inserted })
  }

  /// The text of the value under `key` in the JSON object `json`, as written.
  static func valueText(ofKey key: String, in json: String) -> String? {
    var s = Scanner(Array(json.utf8))
    guard let members = s.members(), let start = members.last(where: { $0.key == key })?.value else { return nil }
    s.i = start
    guard s.skipValue() else { return nil }
    let text = String(decoding: s.b[start..<s.i], as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? nil : text
  }

  /// Integer keys first, ascending, then the rest in the order given, as JavaScript orders an object's keys.
  static func jsOrder(_ keys: [String]) -> [String] {
    let index = { (k: String) -> UInt32? in
      guard let n = UInt32(k), n < UInt32.max, String(n) == k else { return nil }
      return n
    }
    let ints = keys.compactMap(index).sorted().map(String.init)
    return ints + keys.filter { index($0) == nil }
  }

  private struct Scanner {
    let b: [UInt8]
    var i = 0

    init(_ b: [UInt8]) { self.b = b }

    /// At an object: its keys with where each value starts, leaving `i` after the object.
    mutating func members() -> [(key: String, value: Int)]? {
      space()
      guard peek == UInt8(ascii: "{") else { return nil }
      i += 1
      var out: [(key: String, value: Int)] = []
      while true {
        space()
        if peek == UInt8(ascii: "}") { i += 1; return out }
        guard let key = string() else { return nil }
        space()
        guard peek == UInt8(ascii: ":") else { return nil }
        i += 1
        space()
        out.append((key, i))
        guard skipValue() else { return nil }
        space()
        if peek == UInt8(ascii: ",") { i += 1 } else if peek != UInt8(ascii: "}") { return nil }
      }
    }

    private var peek: UInt8? { i < b.count ? b[i] : nil }

    private mutating func space() {
      while let c = peek, c == 0x20 || c == 0x09 || c == 0x0A || c == 0x0D { i += 1 }
    }

    private mutating func string() -> String? {
      let start = i
      guard skipString() else { return nil }
      let raw = b[start..<i]
      if !raw.contains(UInt8(ascii: "\\")) { return String(decoding: raw.dropFirst().dropLast(), as: UTF8.self) }
      return (try? JSONSerialization.jsonObject(with: Data(raw), options: .fragmentsAllowed)) as? String
    }

    private mutating func skipString() -> Bool {
      guard peek == UInt8(ascii: "\"") else { return false }
      i += 1
      while let c = peek {
        i += 1
        if c == UInt8(ascii: "\\") { i += 1 } else if c == UInt8(ascii: "\"") { return true }
      }
      return false
    }

    mutating func skipValue() -> Bool {
      guard let c = peek else { return false }
      if c == UInt8(ascii: "\"") { return skipString() }
      if c == UInt8(ascii: "{") || c == UInt8(ascii: "[") {
        var depth = 0
        while let c = peek {
          switch c {
          case UInt8(ascii: "\""): guard skipString() else { return false }; continue
          case UInt8(ascii: "{"), UInt8(ascii: "["): depth += 1
          case UInt8(ascii: "}"), UInt8(ascii: "]"): depth -= 1
          default: break
          }
          i += 1
          if depth == 0 { return true }
        }
        return false
      }
      while let c = peek, c != UInt8(ascii: ","), c != UInt8(ascii: "}"), c != UInt8(ascii: "]") { i += 1 }
      return true
    }
  }
}
