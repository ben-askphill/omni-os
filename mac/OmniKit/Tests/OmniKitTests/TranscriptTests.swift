import Foundation
import Testing
import OmniKit

// The transcript as buildItems in web/src/components/Transcript.tsx lays it out.

private func use(_ id: String, _ name: String = "Bash", input: String = "{}", parent: String? = nil) -> (String, String) {
  ("tool_use", #"{"id":"\#(id)","name":"\#(name)","input":\#(input),"parent":\#(parent.map { "\"\($0)\"" } ?? "null")}"#)
}

private func answer(_ id: String, _ text: String = "ok", error: Bool = false) -> (String, String) {
  ("tool_result", #"{"tool_use_id":"\#(id)","text":"\#(text)","is_error":\#(error),"truncated":false}"#)
}

private func text(_ t: String) -> (String, String) { ("assistant_text", #"{"text":"\#(t)"}"#) }
private func user(_ t: String) -> (String, String) { ("user", #"{"text":"\#(t)"}"#) }
private func result(ok: Bool = true, turns: Int = 1) -> (String, String) {
  ("result", #"{"ok":\#(ok),"subtype":"\#(ok ? "success" : "error_max_turns")","duration_ms":1000,"turns":\#(turns)}"#)
}
private func todos(_ states: String...) -> String {
  #"{"todos":[\#(states.enumerated().map { #"{"content":"Step \#($0.offset + 1)","activeForm":"Doing step \#($0.offset + 1)","status":"\#($0.element)"}"# }.joined(separator: ","))]}"#
}

private func groups(_ items: [TranscriptItem]) -> [ToolGroup] {
  items.compactMap { if case .tools(let g) = $0 { g } else { nil } }
}

private func recorded(_ name: String) throws -> [EventRow] {
  if name.hasSuffix(".sse") {
    return try FixtureTests.threadStream().compactMap { if case .event(let e) = $0 { e } else { nil } }
  }
  return try decodeFixture(ThreadDetail.self, name).events
}

@Suite struct TranscriptTests {
  @Test func groupsToolCallsBetweenMessages() throws {
    let e = try events([
      user("fix it"), ("init", #"{"model":"m","cwd":"/x","tools":1,"mcp":[]}"#), use("a"), answer("a"),
      ("status", #"{"text":"Thinking"}"#), use("b", "Read"), answer("b"), text("Done."), result(turns: 2),
    ])
    let t = Transcript(e)
    #expect(t.items.map(\.id) == [.event(1), .event(3), .event(8), .event(9)])
    let g = try #require(groups(t.items).first)
    #expect(g.calls.map(\.name) == ["Bash", "Read"])
    #expect(g.calls.map(\.id) == [3, 6])
    #expect(g.total == 2)
    #expect(g.firstCallID == "a")
    #expect(g.calls.allSatisfy { $0.result?.text == "ok" })
    guard case .text(8, _, "Done.") = t.items[2] else { Issue.record("not the text: \(t.items[2])"); return }
    guard case .result(9, let r) = t.items[3] else { Issue.record("not the result"); return }
    #expect(r.turns == 2)
  }

  @Test func nestsSubAgentCallsUnderTheirTask() throws {
    let e = try events([
      use("t", "Task"), use("g", "Grep", parent: "t"), use("r", "Read", parent: "t"), use("x", "Read", parent: "g"),
      answer("t"), use("lost", "Bash", parent: "gone"),
    ])
    let g = try #require(groups(Transcript(e).items).first)
    #expect(g.calls.map(\.callID) == ["t", "lost"])
    #expect(g.calls[0].children.map(\.callID) == ["g", "r"])
    #expect(g.calls[0].children[0].children.map(\.callID) == ["x"])
    #expect(g.calls.map(\.orphan) == [false, true])
    #expect(g.total == 5)
    #expect(g.flat.map(\.callID) == ["t", "g", "x", "r", "lost"])
  }

  @Test func adoptsOnlyWithinAGroup() throws {
    let e = try events([use("t", "Task"), text("Meanwhile"), use("c", "Read", parent: "t")])
    let later = try #require(groups(Transcript(e).items).last)
    #expect(later.calls.map(\.callID) == ["c"])
    #expect(later.calls[0].orphan)
  }

  @Test func keepsOnePlanAfterTheGroupOfTheLatestTodoWrite() throws {
    let first = try events([use("p1", "TodoWrite", input: todos("in_progress", "pending")), text("Looking"), use("b")])
    var t = Transcript(first)
    #expect(t.items.map(\.id) == [.event(1), .plan, .event(2), .event(3)])
    guard case .plan(let plan) = t.items[1] else { Issue.record("no plan"); return }
    #expect(plan.after == 1)
    #expect(plan.todos.map(\.label) == ["Doing step 1", "Step 2"])
    #expect(plan.done == 0)

    let second = first + (try events([use("p2", "TodoWrite", input: todos("completed", "completed"))]).map { try renumber($0, 4) })
    t.update(second)
    #expect(t.items.map(\.id) == [.event(1), .event(2), .event(3), .plan])
    guard case .plan(let now) = t.items[3] else { Issue.record("no plan"); return }
    #expect(now.after == 3)
    #expect(now.allDone)
    #expect(t.items == Transcript.build(second))
  }

  @Test func leavesThePlanOutForATodoWriteWithoutAList() throws {
    let t = Transcript(try events([use("p", "TodoWrite", input: #"{"todos":"none"}"#)]))
    #expect(t.items.map(\.id) == [.event(1)])
  }

  @Test func skipsAZeroTurnSuccessWithoutEndingTheGroup() throws {
    let t = Transcript(try events([use("a"), result(turns: 0), use("b"), result(ok: false, turns: 0), use("c")]))
    #expect(t.items.map(\.id) == [.event(1), .event(4), .event(5)])
    #expect(groups(t.items).map(\.total) == [2, 1])
  }

  @Test func attachesAResultWhenItComes() throws {
    let e = try events([use("a"), text("while it runs"), answer("b", "early"), answer("a", "late", error: true), use("b")])
    let g = groups(Transcript(e).items)
    #expect(g[0].calls[0].result?.text == "late")
    #expect(g[0].failures == 1)
    #expect(g[1].calls[0].result?.text == "early")
  }

  @Test func tellsAStoppedCallFromAFailedOne() throws {
    let e = try events([
      use("a"), answer("a", "[Request interrupted by user for tool use]", error: true),
      use("b"), answer("b", "exit 1", error: true), use("c"),
    ])
    let calls = try #require(groups(Transcript(e).items).first).calls
    #expect(calls.map(\.isStopped) == [true, false, false])
    #expect(calls.map(\.isFailed) == [false, true, false])
    #expect(calls.map(\.isPending) == [false, false, true])
  }

  @Test func namesAGroupByItsCommonestTools() throws {
    let e = try events([
      use("1", "Read"), use("2", "Bash"), use("3", "Bash"), use("4", "Grep"), use("5", "Bash"), use("6", "Read"),
      use("7", "mcp__plugin_github_github__search_issues"), use("8", "Glob", parent: "1"),
    ])
    let g = try #require(groups(Transcript(e).items).first)
    #expect(g.names == "Bash 3, Read 2, Glob, Grep")
  }

  @Test func saysWhenAGroupIsStillGoing() throws {
    let t = Transcript(try events([use("a"), answer("a"), use("b")]))
    let g = try #require(groups(t.items).first)
    #expect(t.isLive(g, running: true))
    #expect(!t.isLive(g, running: false))
    #expect(g.latest?.callID == "b")
    #expect(!t.showsWorking(running: true))

    let answered = Transcript(try events([use("a"), answer("a")]))
    #expect(!answered.isLive(try #require(groups(answered.items).first), running: true))
    let closed = Transcript(try events([use("a"), text("thinking")]))
    #expect(!closed.isLive(try #require(groups(closed.items).first), running: true))
    #expect(closed.showsWorking(running: true))
    #expect(!closed.showsWorking(running: false))
    #expect(Transcript().showsWorking(running: true))
  }

  @Test func laysOutARecordedTurn() throws {
    let e = try recorded("thread-rich.json")
    for row in e { if case .unknown = row.content { Issue.record("event \(row.id) did not decode") } }
    let t = Transcript(e)
    #expect(t.items.map(\.id) == [20, 21, nil, 40, 41, 46, 47, 48, 49, 50, 52, 53].map { $0.map(TranscriptItemID.event) ?? .plan })
    let g = try #require(groups(t.items).first)
    #expect(g.calls.map(\.name) == ["TodoWrite", "Task", "TodoWrite", "Edit", "Bash", "mcp__plugin_github_github__search_issues", "TodoWrite"])
    #expect(g.calls[1].children.map(\.name) == ["Grep", "Read"])
    #expect(g.total == 9)
    #expect(g.flat.allSatisfy { $0.result != nil })
    #expect(g.failures == 1)
    #expect(g.names == "TodoWrite 3, Task, Grep, Read")
    #expect(g.calls[1].summary(cwd: "/tmp/omni-fixtures/acme") == "Find the cart code (Explore)")
    #expect(g.calls[1].children[0].summary(cwd: "/tmp/omni-fixtures/acme") == "cartTotal  in src")
    guard case .plan(let plan) = t.items[2] else { Issue.record("no plan"); return }
    #expect(plan.after == 21)
    #expect(plan.todos.count == 3)
    #expect(plan.allDone)
    guard case .report(46, _, let report) = t.items[5] else { Issue.record("no report"); return }
    #expect(report.taskID == "T-1")
    guard case .error(52, let error) = t.items[10] else { Issue.record("no error"); return }
    #expect(error.hasPrefix("claude exited with code 1."))
    guard case .user(53, _, let dropped) = t.items[11] else { Issue.record("no message"); return }
    #expect(dropped.dropped == true)
    #expect(t.items == Transcript.build(e))
  }

  @Test(arguments: ["thread.json", "thread-rich.json", "thread-stream.sse"])
  func buildsTheSameInPiecesAsAllAtOnce(_ name: String) throws {
    let all = try recorded(name)
    #expect(!all.isEmpty)
    var rng = SplitMix(seed: 63)
    for _ in 0..<300 {
      var t = Transcript()
      var n = 0
      while n < all.count {
        n = min(all.count, n + Int.random(in: 1...6, using: &rng))
        t.update(Array(all[..<n]))
      }
      #expect(t.items == Transcript.build(all))
    }
    var t = Transcript()
    for n in 1...all.count {
      t.update(Array(all[..<n]))
      #expect(t.items == Transcript.build(Array(all[..<n])), "after \(n) events")
    }
  }

  @Test func buildsTheSameInPiecesForRandomTurns() throws {
    var rng = SplitMix(seed: 7)
    for round in 0..<200 {
      let all = try randomTurn(&rng, count: Int.random(in: 1...60, using: &rng))
      var t = Transcript()
      var n = 0
      while n < all.count {
        n = min(all.count, n + Int.random(in: 1...4, using: &rng))
        t.update(Array(all[..<n]))
        #expect(t.items == Transcript.build(Array(all[..<n])), "round \(round) after \(n) events")
      }
    }
  }

  @Test func startsOverWhenAnEarlierEventTurnsUp() throws {
    let all = try events([use("a"), answer("a"), text("Done."), user("next"), use("b"), answer("b")])
    var t = Transcript()
    t.update(all.enumerated().filter { $0.offset != 2 }.map(\.element))
    t.update(all)
    #expect(t.items == Transcript.build(all))
    t.update(Array(all.prefix(2)))
    #expect(t.items == Transcript.build(Array(all.prefix(2))))
  }

  @Test func saysHowATurnEnded() throws {
    func line(_ json: String) throws -> TurnResult {
      guard case .result(let r) = try decode(EventRow.self, eventJSON(kind: "result", payload: json)).content else { throw TimedOut(what: "a result") }
      return r
    }
    #expect(try line(#"{"ok":true,"subtype":"success","duration_ms":185000,"turns":8}"#).line == "done in 3m 5s · 8 turns")
    #expect(try line(#"{"ok":true,"subtype":"success","turns":1}"#).line == "done · 1 turn")
    #expect(try line(#"{"ok":false,"subtype":"error_during_execution","stopped":true,"duration_ms":2000,"turns":0}"#).line == "stopped in 2s")
    let bad = try line(#"{"ok":false,"subtype":"error_max_turns","duration_ms":61000,"turns":3}"#)
    #expect(bad.line == "ended in 1m 1s · 3 turns · error max turns")
    #expect(bad.isBad)
    #expect(try line(#"{"ok":false,"subtype":"success"}"#).line == "ended")
  }
}

/// `row` with the id `id`.
func renumber(_ row: EventRow, _ id: Int) throws -> EventRow {
  try decode(EventRow.self, eventJSON(kind: row.kind, payload: row.payload, id: id))
}

/// A turn of random events: calls nested under earlier ones, answers early, late or never, plans, messages,
/// zero-turn results, unknown kinds.
private func randomTurn(_ rng: inout SplitMix, count: Int) throws -> [EventRow] {
  var calls: [String] = []
  var list: [(String, String)] = []
  for n in 0..<count {
    switch Int.random(in: 0..<12, using: &rng) {
    case 0...3:
      let id = Int.random(in: 0..<4, using: &rng) == 0 && !calls.isEmpty ? calls.randomElement(using: &rng)! : "c\(n)"
      let parent = Int.random(in: 0..<3, using: &rng) == 0 ? (calls.randomElement(using: &rng) ?? "none") : nil
      let name = ["Bash", "Read", "Task", "TodoWrite", "mcp__x__y"].randomElement(using: &rng)!
      list.append(use(id, name, input: name == "TodoWrite" ? todos("completed", "in_progress") : #"{"command":"c\#(n)"}"#, parent: parent))
      calls.append(id)
    case 4...6:
      list.append(answer(calls.randomElement(using: &rng) ?? "c\(n + 1)", "r\(n)", error: Bool.random(using: &rng)))
    case 7: list.append(text("t\(n)"))
    case 8: list.append(user("u\(n)"))
    case 9: list.append(result(ok: Bool.random(using: &rng), turns: Int.random(in: 0...2, using: &rng)))
    case 10: list.append(["status", "init", "compact", "error", "crew_report"].randomElement(using: &rng).map { ($0, #"{"text":"x"}"#) }!)
    default: list.append(("user", "not json"))
    }
  }
  return try events(list)
}

/// A seeded generator, so a failing split can be run again.
struct SplitMix: RandomNumberGenerator {
  var state: UInt64
  init(seed: UInt64) { state = seed }
  mutating func next() -> UInt64 {
    state &+= 0x9E37_79B9_7F4A_7C15
    var z = state
    z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
    z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
    return z ^ (z >> 31)
  }
}

// Ticks in web/src/components/ui.tsx: how many of the plan's ticks are filled.
@Suite struct TicksTests {
  @Test(arguments: [
    (0.0, 5, 0, 5),
    (0.01, 24, 1, 24),
    (0.5, 3, 2, 3),
    (1.0, 4, 4, 4),
    (1.5, 4, 4, 4),
    (-1.0, 4, 0, 4),
    (0.0, 0, 0, 1),
  ])
  func fillsAsTheWebUIDoes(value: Double, count: Int, on: Int, total: Int) {
    let t = Ticks(value: value, count: count)
    #expect(t.on == on)
    #expect(t.count == total)
  }

  @Test func followsThePlan() throws {
    let input = #"{"todos":[{"content":"A","status":"completed"},{"content":"B"},{"content":"C"}]}"#
    let items = Transcript(try events([("tool_use", #"{"id":"u1","name":"TodoWrite","input":\#(input),"parent":null}"#)])).items
    guard case .plan(let plan) = items.last else { Issue.record("no plan"); return }
    #expect(plan.ticks == Ticks(value: 1.0 / 3, count: 3))
    #expect(plan.ticks.on == 1)
  }
}
