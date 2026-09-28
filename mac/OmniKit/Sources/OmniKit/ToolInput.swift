import Foundation

/// What an expanded call shows of its input, as ToolInput in web/src/components/Transcript.tsx.
public enum ToolInput: Hashable, Sendable {
  public struct Edit: Hashable, Sendable {
    /// nil when the edit adds text without replacing any.
    public let old: String?
    public let new: String

    public init(old: String?, new: String) {
      self.old = old
      self.new = new
    }
  }

  /// A todo as the input lists it. `state` is pending unless the todo says otherwise.
  public struct Check: Hashable, Sendable {
    public let content: String
    public let state: String
  }

  /// `command` starts with "$ ".
  case bash(description: String?, command: String)
  /// At most `maxEdits`.
  case edits(path: String, [Edit])
  /// The first `maxWriteLines` lines, then "..." on its own line when there are more.
  case write(path: String, lines: Int, preview: String)
  case prompt(String)
  case todos([Check])
  /// The input as JSON.stringify(input, null, 2) prints it, cut at `maxJSON` UTF-16 units.
  case json(String)
  case none

  public static let maxEdits = 8
  public static let maxWriteLines = 80
  public static let maxJSON = 6000

  public init(_ use: ToolUse) {
    let i = use.input
    let str = { (k: String) in ToolText.str(i[k]) }
    switch use.name {
    case "Bash":
      let d = str("description")
      self = .bash(description: d.isEmpty ? nil : d, command: "$ " + str("command"))
    case "Edit", "MultiEdit":
      var list = [i]
      if use.name == "MultiEdit", case .array(let edits) = i["edits"] { list = edits }
      self = .edits(
        path: str("file_path"),
        list.prefix(Self.maxEdits).map { ed in
          let old = ToolText.str(ed["old_string"])
          return Edit(old: old.isEmpty ? nil : old, new: ToolText.str(ed["new_string"]))
        })
    case "Write":
      let lines = str("content").components(separatedBy: "\n")
      let preview = lines.prefix(Self.maxWriteLines).joined(separator: "\n") + (lines.count > Self.maxWriteLines ? "\n..." : "")
      self = .write(path: str("file_path"), lines: lines.count, preview: preview)
    case "Task", "Agent":
      self = .prompt(str("prompt"))
    case "TodoWrite":
      guard case .array(let todos) = i["todos"] else { self = Self.json(use); return }
      self = .todos(todos.map { Check(content: ToolText.str($0["content"]), state: $0["status"]?.stringValue ?? "pending") })
    default:
      self = Self.json(use)
    }
  }

  private static func json(_ use: ToolUse) -> ToolInput {
    guard let raw = use.inputJSON, let json = JSONPretty.print(raw, wrappingScalars: true), json != "{}" else { return .none }
    return .json(cut(json, at: maxJSON))
  }

  private static func cut(_ s: String, at max: Int) -> String {
    let units = s.utf16
    guard units.count > max else { return s }
    var end = max
    let i = units.index(units.startIndex, offsetBy: end - 1)
    if UTF16.isLeadSurrogate(units[i]) { end -= 1 }
    return String(decoding: Array(units.prefix(end)), as: UTF16.self) + "\n..."
  }
}

/// JSON text indented as JSON.stringify(value, null, 2) prints it: two spaces, `": "` after keys, `{}` and `[]`
/// for empty ones, and an object's keys in JavaScript's order. Strings and numbers are kept as written, which is
/// how the server's JSON.stringify wrote them.
enum JSONPretty {
  private indirect enum Node {
    case raw(ArraySlice<UInt8>)
    case array([Node])
    case object([(key: ArraySlice<UInt8>, value: Node)])
  }

  /// nil when `text` is not JSON. With `wrappingScalars`, anything but an object or array is printed as
  /// `{"value": ...}`, as the Web UI wraps a tool input that is not an object.
  static func print(_ text: String, wrappingScalars: Bool = false) -> String? {
    var p = Parser(Array(text.utf8))
    guard var node = p.value(), p.atEnd else { return nil }
    if wrappingScalars, case .raw = node { node = .object([(Array(#""value""#.utf8)[...], node)]) }
    var out: [UInt8] = []
    out.reserveCapacity(text.utf8.count * 2)
    write(node, depth: 0, into: &out)
    return String(decoding: out, as: UTF8.self)
  }

  private static func write(_ node: Node, depth: Int, into out: inout [UInt8]) {
    let pad = { (d: Int, out: inout [UInt8]) in
      out.append(UInt8(ascii: "\n"))
      out.append(contentsOf: repeatElement(UInt8(ascii: " "), count: d * 2))
    }
    switch node {
    case .raw(let bytes):
      out.append(contentsOf: bytes)
    case .array(let items):
      guard !items.isEmpty else { return out.append(contentsOf: Array("[]".utf8)) }
      out.append(UInt8(ascii: "["))
      for (n, item) in items.enumerated() {
        if n > 0 { out.append(UInt8(ascii: ",")) }
        pad(depth + 1, &out)
        write(item, depth: depth + 1, into: &out)
      }
      pad(depth, &out)
      out.append(UInt8(ascii: "]"))
    case .object(let members):
      guard !members.isEmpty else { return out.append(contentsOf: Array("{}".utf8)) }
      out.append(UInt8(ascii: "{"))
      for (n, m) in members.enumerated() {
        if n > 0 { out.append(UInt8(ascii: ",")) }
        pad(depth + 1, &out)
        out.append(contentsOf: m.key)
        out.append(contentsOf: Array(": ".utf8))
        write(m.value, depth: depth + 1, into: &out)
      }
      pad(depth, &out)
      out.append(UInt8(ascii: "}"))
    }
  }

  private struct Parser {
    let b: [UInt8]
    var i = 0

    init(_ b: [UInt8]) { self.b = b }

    var atEnd: Bool {
      mutating get {
        space()
        return i == b.count
      }
    }

    private var peek: UInt8? { i < b.count ? b[i] : nil }

    private mutating func space() {
      while let c = peek, c == 0x20 || c == 0x09 || c == 0x0A || c == 0x0D { i += 1 }
    }

    mutating func value() -> Node? {
      space()
      guard let c = peek else { return nil }
      switch c {
      case UInt8(ascii: "{"): return object()
      case UInt8(ascii: "["): return array()
      case UInt8(ascii: "\""): return string().map(Node.raw)
      default:
        let start = i
        while let c = peek, c != UInt8(ascii: ","), c != UInt8(ascii: "}"), c != UInt8(ascii: "]"), c > 0x20 { i += 1 }
        return i > start ? .raw(b[start..<i]) : nil
      }
    }

    private mutating func string() -> ArraySlice<UInt8>? {
      let start = i
      i += 1
      while let c = peek {
        i += 1
        if c == UInt8(ascii: "\\") {
          i += 1
        } else if c == UInt8(ascii: "\"") {
          return b[start..<i]
        }
      }
      return nil
    }

    private mutating func array() -> Node? {
      i += 1
      var items: [Node] = []
      space()
      if peek == UInt8(ascii: "]") {
        i += 1
        return .array(items)
      }
      while true {
        guard let v = value() else { return nil }
        items.append(v)
        space()
        switch peek {
        case UInt8(ascii: ","): i += 1
        case UInt8(ascii: "]"):
          i += 1
          return .array(items)
        default: return nil
        }
      }
    }

    private mutating func object() -> Node? {
      i += 1
      var members: [(key: ArraySlice<UInt8>, value: Node)] = []
      var names: [String] = []
      var index: [String: Int] = [:]
      space()
      if peek == UInt8(ascii: "}") {
        i += 1
        return .object(members)
      }
      while true {
        space()
        guard peek == UInt8(ascii: "\""), let key = string() else { return nil }
        space()
        guard peek == UInt8(ascii: ":") else { return nil }
        i += 1
        guard let v = value() else { return nil }
        let name = Self.name(key)
        // A key given twice keeps its first place and its last value, as JSON.parse does.
        if let at = index[name] {
          members[at].value = v
        } else {
          index[name] = members.count
          names.append(name)
          members.append((key, v))
        }
        space()
        switch peek {
        case UInt8(ascii: ","): i += 1
        case UInt8(ascii: "}"):
          i += 1
          return .object(JSONKeyOrder.jsOrder(names).map { members[index[$0]!] })
        default: return nil
        }
      }
    }

    private static func name(_ key: ArraySlice<UInt8>) -> String {
      if !key.contains(UInt8(ascii: "\\")) { return String(decoding: key.dropFirst().dropLast(), as: UTF8.self) }
      return (try? JSONSerialization.jsonObject(with: Data(key), options: .fragmentsAllowed)) as? String
        ?? String(decoding: key, as: UTF8.self)
    }
  }
}
