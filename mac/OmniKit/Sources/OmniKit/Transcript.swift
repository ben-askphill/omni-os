import Foundation

/// A transcript row's identity, stable while events arrive: the event it starts at, or the one plan.
public enum TranscriptItemID: Hashable, Sendable {
  case event(Int)
  case plan
}

/// One row of the transcript, laid out as buildItems in web/src/components/Transcript.tsx does.
public enum TranscriptItem: Hashable, Sendable, Identifiable {
  case user(eventID: Int, at: Date, UserMessage)
  case text(eventID: Int, at: Date, String)
  /// Tool calls in a row, however many steps they took.
  case tools(ToolGroup)
  /// The latest TodoWrite as a checklist, right after the group it came in.
  case plan(Plan)
  case result(eventID: Int, TurnResult)
  case error(eventID: Int, String)
  case report(eventID: Int, at: Date, CrewReport)
  /// Mod log lines in a row, keyed by the first. They do not end a group of calls, so a busy hook does not split it.
  case mod(eventID: Int, [ModLine])

  public var id: TranscriptItemID {
    switch self {
    case .user(let id, _, _), .text(let id, _, _), .result(let id, _), .error(let id, _), .report(let id, _, _), .mod(let id, _): .event(id)
    case .tools(let g): .event(g.eventID)
    case .plan: .plan
    }
  }
}

/// One `$.ui.log` line from a mod.
public struct ModLine: Hashable, Sendable, Identifiable {
  /// The event's id.
  public let id: Int
  public let at: Date
  public let plugin: String
  public let text: String

  /// A row for a stored log, or nil when it has no text, as the Web UI drops it.
  init?(_ log: ModLog, _ e: EventRow) {
    guard !log.text.isEmpty else { return nil }
    (id, at, plugin, text) = (e.id, e.createdAt, log.plugin, log.text)
  }
}

public struct ToolCall: Hashable, Sendable, Identifiable {
  /// The event's id. The call's own id is `callID`, which a harness may use twice.
  public let id: Int
  public let use: ToolUse
  public internal(set) var result: ToolResult?
  public let at: Date
  /// Calls a sub-agent made inside this one.
  public internal(set) var children: [ToolCall] = []
  /// It names a parent this group does not have.
  public let orphan: Bool

  public var callID: String { use.id }
  public var name: String { use.name }
  public var label: String { ToolText.label(use.name) }
  public func summary(cwd: String?) -> String { ToolText.summary(use, cwd: cwd) }
  public var isPending: Bool { result == nil }
  /// Cut short by a stop or an interrupt. Not a failure.
  public var isStopped: Bool {
    guard let result, result.isError else { return false }
    return Self.stoppedTexts.contains { result.text.hasPrefix($0) }
  }
  public var isFailed: Bool { result?.isError == true && !isStopped }

  /// What the CLI answers for a call it cut short: an interrupt, or a turn abort that skipped queued calls or
  /// dropped a running one.
  static let stoppedTexts = [
    "The user doesn't want to proceed with this tool use",
    "The user doesn't want to take this action right now",
    "[Tool call skipped",
    "[Tool call did not complete",
    "[Request interrupted by user",
  ]

  mutating func update(_ path: ArraySlice<Int>, _ body: (inout ToolCall) -> Void) {
    guard let first = path.first else { return body(&self) }
    children[first].update(path.dropFirst(), body)
  }
}

public struct ToolGroup: Hashable, Sendable, Identifiable {
  /// The event of its first call.
  public let eventID: Int
  public let firstCallID: String
  /// Top-level calls; sub-agent calls sit in their `children`.
  public internal(set) var calls: [ToolCall] = []
  /// Every call, nested or not.
  public internal(set) var total = 0

  public var id: Int { eventID }
  /// One call on its own, shown as a row instead of a group.
  public var isSingle: Bool { total == 1 && calls.count == 1 }
  /// Every call in order, each followed by its sub-calls.
  public var flat: [ToolCall] { calls.flatMap(Self.flatten) }
  public var latest: ToolCall? { flat.last }
  public var hasPending: Bool { flat.contains(where: \.isPending) }
  public var failures: Int { flat.count(where: \.isFailed) }

  /// The four commonest tools: "Bash 3, Read 2, Grep, github".
  public var names: String {
    var order: [String] = []
    var counts: [String: Int] = [:]
    for c in flat {
      let n = c.label.components(separatedBy: " · ")[0]
      if counts[n] == nil { order.append(n) }
      counts[n, default: 0] += 1
    }
    let top = order.enumerated().sorted { a, b in
      let (x, y) = (counts[a.element]!, counts[b.element]!)
      return x != y ? x > y : a.offset < b.offset
    }
    return top.prefix(4).map { counts[$0.element]! > 1 ? "\($0.element) \(counts[$0.element]!)" : $0.element }.joined(separator: ", ")
  }

  /// The same group with only these top-level calls, its total counting them and their sub-calls.
  public func keeping(_ calls: [ToolCall]) -> ToolGroup {
    var g = self
    g.calls = calls
    g.total = g.flat.count
    return g
  }

  private static func flatten(_ c: ToolCall) -> [ToolCall] { [c] + c.children.flatMap(flatten) }
}

public struct Todo: Hashable, Sendable {
  public let content: String?
  public let activeForm: String?
  /// pending, in_progress or completed.
  public let status: String?

  /// The active form while it is in progress, otherwise its content.
  public var label: String? { status == "in_progress" && activeForm?.isEmpty == false ? activeForm : content }

  init(_ v: JSONValue) {
    let field = { (k: String) in v[k].map(ToolText.str).flatMap { $0.isEmpty ? nil : $0 } }
    content = field("content")
    activeForm = field("activeForm")
    status = v["status"]?.stringValue
  }
}

public struct Plan: Hashable, Sendable {
  public let todos: [Todo]
  /// The group it follows.
  public let after: Int

  public var done: Int { todos.count { $0.status == "completed" } }
  public var active: Todo? { todos.first { $0.status == "in_progress" } }
  public var allDone: Bool { !todos.isEmpty && done == todos.count }

  /// The plan a call sets, if it is a TodoWrite with a list.
  init?(_ use: ToolUse, after: Int) {
    guard use.name == "TodoWrite", case .array(let list) = use.input["todos"] else { return nil }
    todos = list.map(Todo.init)
    self.after = after
  }
}

/// The rows for a thread's events. `update` takes the whole event list each time and lays out only what is new
/// since the last call, so a busy thread costs the same per event however long it runs.
public struct Transcript: Sendable {
  public private(set) var items: [TranscriptItem] = []

  private var consumed = 0
  private var lastID: Int?
  /// The latest result for each call id, as the Web UI's results map.
  private var results: [String: ToolResult] = [:]
  /// Where each call sits: its group's event id and the path to it.
  private var refs: [String: [(group: Int, path: [Int])]] = [:]
  private var open: (index: Int, paths: [String: [Int]])?
  private var planIndex: Int?

  public init() {}

  public init(_ events: [EventRow]) { update(events) }

  /// Lays out `events`, sorted by id. Events that arrived out of order lay the whole list out again.
  public mutating func update(_ events: [EventRow]) {
    if consumed > events.count || (consumed > 0 && events[consumed - 1].id != lastID) { self = Transcript() }
    for e in events[consumed...] { add(e) }
    consumed = events.count
    lastID = events.last?.id
  }

  /// The last row that is not the plan or mod log lines, which are asides.
  public var last: TranscriptItem? {
    items.last {
      switch $0 {
      case .plan, .mod: false
      default: true
      }
    }
  }

  /// The group is the last row and still has a call waiting for its result.
  public func isLive(_ group: ToolGroup, running: Bool) -> Bool {
    running && last?.id == .event(group.eventID) && group.hasPending
  }

  /// The Working line shows under the last row, as when nothing has come back since Ben's message.
  public func showsWorking(running: Bool) -> Bool {
    guard running else { return false }
    switch last {
    case nil, .user, .report, .text: return true
    default: return false
    }
  }

  private mutating func add(_ e: EventRow) {
    switch Self.content(of: e) {
    case .toolUse(let use):
      if !Self.isSelfParent(use) { addCall(use, e) }
    case .toolResult(let r):
      guard !r.toolUseID.isEmpty else { return }
      results[r.toolUseID] = r
      for ref in refs[r.toolUseID] ?? [] {
        guard let i = items.lastIndex(where: { $0.id == .event(ref.group) }) else { continue }
        withGroup(at: i) { g in g.calls[ref.path[0]].update(ref.path.dropFirst()) { $0.result = r } }
      }
    case .user(let m): close(.user(eventID: e.id, at: e.createdAt, m))
    case .assistantText(let t): close(.text(eventID: e.id, at: e.createdAt, t))
    case .result(let r):
      if r.ok && (r.turns ?? 0) == 0 { return }
      close(.result(eventID: e.id, r))
    case .error(let t): close(.error(eventID: e.id, t))
    case .crewReport(let r): close(.report(eventID: e.id, at: e.createdAt, r))
    case .mod(let log):
      guard let line = ModLine(log, e) else { return }
      if case .mod(let first, var lines)? = items.last {
        lines.append(line)
        items[items.count - 1] = .mod(eventID: first, lines)
      } else {
        items.append(.mod(eventID: e.id, [line]))
      }
    case .status, .sessionInit, .task: break
    case .unknown(let kind, _):
      if Self.breaking.contains(kind) { close(nil) }
    }
  }

  /// A `tool_use` whose payload does not decode still folds, the way the Web UI's parsePayload does:
  /// a missing name is "tool", a missing input is empty, and a non-object input is wrapped as `{value}`.
  private static func content(of e: EventRow) -> EventPayload {
    if case .unknown(let kind, let payload) = e.content, kind == "tool_use" {
      return .toolUse(lenientToolUse(payload, raw: e.payload))
    }
    return e.content
  }

  /// A call whose parent id is its own id. The Web UI drops it; it is not shown at the top of the group.
  private static func isSelfParent(_ use: ToolUse) -> Bool {
    guard let parent = use.parent, !parent.isEmpty else { return false }
    return parent == use.id
  }

  /// A tool call from a payload that did not decode as `ToolUse`, with the Web UI's defaults.
  private static func lenientToolUse(_ payload: JSONValue, raw: String) -> ToolUse {
    struct Spec: Encodable {
      var id: String
      var name: String
      var input: JSONValue
      var parent: String?
    }
    let fields: [String: JSONValue] = if case .object(let o) = payload { o } else { [:] }
    let id = fields["id"]?.stringValue ?? ""
    let name = fields["name"]?.stringValue ?? "tool"
    let parent = fields["parent"]?.stringValue
    let input: JSONValue
    if let rawInput = fields["input"] {
      switch rawInput {
      case .object, .array: input = rawInput
      default: input = .object(["value": rawInput])
      }
    } else {
      // A missing input is `{value: undefined}` on the web, which JSON leaves out, so the object is empty.
      input = .object([:])
    }
    let data = (try? JSONEncoder().encode(Spec(id: id, name: name, input: input, parent: parent)))
      ?? Data(#"{"id":"","name":"tool","input":{}}"#.utf8)
    let fallback = Data(#"{"id":"","name":"tool","input":{}}"#.utf8)
    guard var use = (try? OmniJSON.decoder().decode(ToolUse.self, from: data))
      ?? (try? OmniJSON.decoder().decode(ToolUse.self, from: fallback))
    else {
      preconditionFailure("lenient tool use")
    }
    if case .object = use.input {
      use.inputKeys = JSONKeyOrder.keys(ofObjectAt: "input", in: raw)
      use.inputJSON = JSONKeyOrder.valueText(ofKey: "input", in: raw)
    }
    return use
  }

  /// Kinds that end a group of calls.
  static let breaking: Set<String> = ["user", "assistant_text", "result", "error", "crew_report"]

  private mutating func close(_ item: TranscriptItem?) {
    open = nil
    if let item { items.append(item) }
  }

  private mutating func addCall(_ use: ToolUse, _ e: EventRow) {
    if open == nil {
      items.append(.tools(ToolGroup(eventID: e.id, firstCallID: use.id)))
      open = (items.count - 1, [:])
    }
    guard var (index, paths) = open, case .tools(let g) = items[index] else { return }
    let parentPath = use.parent.flatMap { paths[$0] }
    let call = ToolCall(id: e.id, use: use, result: results[use.id], at: e.createdAt, orphan: parentPath == nil && use.parent != nil)
    var path: [Int] = []
    withGroup(at: index) { g in
      g.total += 1
      if let parentPath {
        g.calls[parentPath[0]].update(parentPath.dropFirst()) { p in
          path = parentPath + [p.children.count]
          p.children.append(call)
        }
      } else {
        path = [g.calls.count]
        g.calls.append(call)
      }
    }
    paths[use.id] = path
    refs[use.id, default: []].append((g.eventID, path))
    if let plan = Plan(use, after: g.eventID) {
      if let p = planIndex, p == index + 1 {
        items[p] = .plan(plan)
      } else {
        if let p = planIndex {
          items.remove(at: p)
          if p < index { index -= 1 }
        }
        items.insert(.plan(plan), at: index + 1)
        planIndex = index + 1
      }
    }
    open = (index, paths)
  }

  /// Changes the group at `i` in place, without copying its calls.
  private mutating func withGroup(at i: Int, _ body: (inout ToolGroup) -> Void) {
    guard case .tools(var g) = items[i] else { return }
    items[i] = .error(eventID: 0, "")
    body(&g)
    items[i] = .tools(g)
  }
}

extension Transcript {
  /// Every row for `events` in one pass over them, as buildItems does it. The reference `update` must match.
  public static func build(_ events: [EventRow]) -> [TranscriptItem] {
    final class Node {
      let id: Int, use: ToolUse, result: ToolResult?, at: Date, orphan: Bool
      var children: [Node] = []
      init(_ id: Int, _ use: ToolUse, _ result: ToolResult?, _ at: Date, _ orphan: Bool) {
        (self.id, self.use, self.result, self.at, self.orphan) = (id, use, result, at, orphan)
      }
      var call: ToolCall { ToolCall(id: id, use: use, result: result, at: at, children: children.map(\.call), orphan: orphan) }
    }
    final class Group {
      let eventID: Int, first: String
      var calls: [Node] = [], total = 0, byID: [String: Node] = [:]
      init(_ eventID: Int, _ first: String) { (self.eventID, self.first) = (eventID, first) }
    }
    enum Row {
      case item(TranscriptItem)
      case group(Group)
    }

    var results: [String: ToolResult] = [:]
    for e in events {
      if case .toolResult(let r) = e.content, !r.toolUseID.isEmpty { results[r.toolUseID] = r }
    }
    var rows: [Row] = []
    var group: Group?
    var plan: Plan?
    for e in events {
      switch Self.content(of: e) {
      case .toolUse(let use):
        if Self.isSelfParent(use) { break }
        if group == nil {
          let g = Group(e.id, use.id)
          rows.append(.group(g))
          group = g
        }
        let g = group!
        g.total += 1
        if let p = Plan(use, after: g.eventID) { plan = p }
        let parent = use.parent.flatMap { g.byID[$0] }
        let node = Node(e.id, use, results[use.id], e.createdAt, parent == nil && use.parent != nil)
        if let parent { parent.children.append(node) } else { g.calls.append(node) }
        g.byID[use.id] = node
      case .toolResult, .status, .sessionInit, .task: break
      case .user(let m):
        group = nil
        rows.append(.item(.user(eventID: e.id, at: e.createdAt, m)))
      case .assistantText(let t):
        group = nil
        rows.append(.item(.text(eventID: e.id, at: e.createdAt, t)))
      case .result(let r):
        if r.ok && (r.turns ?? 0) == 0 { break }
        group = nil
        rows.append(.item(.result(eventID: e.id, r)))
      case .error(let t):
        group = nil
        rows.append(.item(.error(eventID: e.id, t)))
      case .crewReport(let r):
        group = nil
        rows.append(.item(.report(eventID: e.id, at: e.createdAt, r)))
      case .mod(let log):
        guard let line = ModLine(log, e) else { break }
        if case .item(.mod(let first, var lines))? = rows.last {
          lines.append(line)
          rows[rows.count - 1] = .item(.mod(eventID: first, lines))
        } else {
          rows.append(.item(.mod(eventID: e.id, [line])))
        }
      case .unknown(let kind, _):
        if breaking.contains(kind) { group = nil }
      }
    }
    return rows.flatMap { row -> [TranscriptItem] in
      switch row {
      case .item(let item): return [item]
      case .group(let g):
        let item = TranscriptItem.tools(ToolGroup(eventID: g.eventID, firstCallID: g.first, calls: g.calls.map(\.call), total: g.total))
        if let plan, plan.after == g.eventID { return [item, .plan(plan)] }
        return [item]
      }
    }
  }
}

extension TurnResult {
  /// "done in 3m 5s · 8 turns", and why when it failed: "ended in 1m 1s · 3 turns · error max turns".
  public var line: String {
    let word = ok ? "done" : stopped == true ? "stopped" : "ended"
    var bits = [durationMs.map { "\(word) in \(Format.duration(ms: $0))" } ?? word]
    if let turns, turns != 0 { bits.append(Format.plural(turns, "turn")) }
    let reason = isBad && !subtype.isEmpty && subtype != "success" ? " · " + subtype.replacingOccurrences(of: "_", with: " ") : ""
    return bits.joined(separator: " · ") + reason
  }

  /// It failed, not stopped by Ben.
  public var isBad: Bool { !ok && stopped != true }
}

/// A row of `count` ticks with the first `on` filled for a value from 0 to 1, as Ticks in web/src/components/ui.tsx.
/// Anything above 0 fills at least one.
public struct Ticks: Hashable, Sendable {
  public let on: Int
  public let count: Int

  public init(value: Double, count: Int) {
    let v = min(1, max(0, value))
    self.count = max(1, count)
    on = v > 0 ? max(1, Int((v * Double(self.count)).rounded())) : 0
  }
}

extension Plan {
  public var ticks: Ticks { Ticks(value: todos.isEmpty ? 0 : Double(done) / Double(todos.count), count: todos.count) }
}
