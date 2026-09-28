import Foundation
import Testing
import OmniKit

/// Events numbered from 1 in the order given, each `(kind, payload JSON)`.
func events(_ list: [(String, String)]) throws -> [EventRow] {
  try list.enumerated().map { n, e in try decode(EventRow.self, eventJSON(kind: e.0, payload: e.1, id: n + 1)) }
}

// The same cases as tests/status-line.test.ts, and the rules of betweenTurns in web/src/pages/Thread.tsx.

@Suite struct StatusLineTests {
  @Test func showsTheNewestStatusSinceBensLastMessage() throws {
    #expect(StatusLine.label(try events([("user", "{}"), ("status", #"{"text":"Compacting the conversation"}"#)])) == "Compacting the conversation")
    let e = try events([("user", "{}"), ("status", #"{"text":"One"}"#), ("tool_use", "{}"), ("status", #"{"text":"Two"}"#), ("tool_result", "{}")])
    #expect(StatusLine.label(e) == "Two")
  }

  @Test func showsNoneForAStatusFromBeforeHisLastMessage() throws {
    #expect(StatusLine.label(try events([("status", #"{"text":"Reviewing current changes"}"#), ("result", "{}"), ("user", "{}")])) == nil)
    #expect(StatusLine.label([]) == nil)
  }

  @Test func showsNoneOnceAnEmptyStatusClearsAnEarlierOne() throws {
    let e = try events([("user", "{}"), ("status", #"{"text":"Compacting the conversation"}"#), ("status", #"{"text":""}"#), ("tool_use", "{}")])
    #expect(StatusLine.label(e) == nil)
  }

  @Test func readsAStatusWhateverItsTextIs() throws {
    #expect(StatusLine.label(try events([("user", "{}"), ("status", #"{"text":5}"#)])) == "5")
    #expect(StatusLine.label(try events([("user", "{}"), ("status", "not json")])) == nil)
  }

  @Test(arguments: [
    ([], true),
    ([("user", #"{"text":"hi"}"#)], false),
    ([("user", #"{"text":"hi"}"#), ("init", "{}"), ("status", #"{"text":"Thinking"}"#)], false),
    ([("user", #"{"text":"hi"}"#), ("tool_use", "{}")], false),
    ([("user", #"{"text":"hi"}"#), ("assistant_text", #"{"text":"ok"}"#)], false),
    ([("assistant_text", #"{"text":"ok"}"#), ("result", #"{"ok":true,"subtype":"success"}"#)], true),
    ([("tool_use", "{}"), ("error", #"{"text":"boom"}"#)], true),
    ([("result", #"{"ok":true,"subtype":"success"}"#), ("user", #"{"text":"late","dropped":true}"#)], true),
    ([("result", #"{"ok":true,"subtype":"success"}"#), ("crew_report", #"{"text":"done","thread_id":"c1"}"#)], false),
    ([("result", #"{"ok":true,"subtype":"success"}"#), ("crew_report", #"{"text":"done","dropped":true}"#)], true),
    ([("init", "{}"), ("status", #"{"text":"x"}"#)], true),
    ([("tool_result", "{}")], false),
  ] as [([(String, String)], Bool)])
  func knowsWhenNoTurnIsGoing(_ list: [(String, String)], _ want: Bool) throws {
    #expect(StatusLine.betweenTurns(try events(list)) == want)
  }
}
