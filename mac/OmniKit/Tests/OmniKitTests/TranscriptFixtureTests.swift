import Foundation
import Testing
import OmniKit

// The same checkout ServerSupervisorTests boots. The corpus is the Web UI fold's output, read from the repo
// so this test cannot drift from tests/transcript-fold.test.ts.
private let repoRoot = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent().deletingLastPathComponent()

private struct FoldResult: Decodable, Equatable {
  var text: String
  var isError: Bool
  var truncated: Bool

  enum CodingKeys: String, CodingKey {
    case text, truncated
    case isError = "is_error"
  }
}

private struct FoldCall: Decodable, Equatable {
  var id: String?
  var name: String
  var parent: String?
  var orphan: Bool
  var input: JSONValue
  var summary: String
  var result: FoldResult?
  var children: [FoldCall]
}

private struct FoldTodo: Decodable, Equatable {
  var content: String?
  var activeForm: String?
  var status: String?
}

private struct FoldPlan: Decodable, Equatable {
  var after: Int
  var todos: [FoldTodo]
}

private struct FoldModLine: Decodable, Equatable {
  var key: Int
  var plugin: String
  var text: String
}

private struct FoldItem: Decodable, Equatable {
  var type: String
  var key: Int
  var text: String? = nil
  var total: Int? = nil
  var calls: [FoldCall]? = nil
  var ok: Bool? = nil
  var subtype: String? = nil
  var turns: Int? = nil
  var taskId: String? = nil
  var lines: [FoldModLine]? = nil

  enum CodingKeys: String, CodingKey {
    case type, key, text, total, calls, ok, subtype, turns, lines
    case taskId = "task_id"
  }
}

private struct FoldCase: Decodable {
  var name: String
  var events: [EventRow]
  var items: [FoldItem]
  var plan: FoldPlan?
}

private struct Corpus: Decodable {
  var cases: [FoldCase]
}

private func projectCall(_ c: ToolCall) -> FoldCall {
  FoldCall(
    id: c.callID.isEmpty ? nil : c.callID,
    name: c.name,
    parent: c.use.parent,
    orphan: c.orphan,
    input: c.use.input,
    summary: c.summary(cwd: nil),
    result: c.result.map { FoldResult(text: $0.text, isError: $0.isError, truncated: $0.truncated) },
    children: c.children.map(projectCall)
  )
}

/// The fold's items, with the plan beside them, as tests/fixtures/transcript/corpus.json stores it.
private func project(_ transcript: Transcript) -> (items: [FoldItem], plan: FoldPlan?) {
  var items: [FoldItem] = []
  var plan: FoldPlan?
  for item in transcript.items {
    switch item {
    case .user(let id, _, let message):
      items.append(FoldItem(type: "user", key: id, text: message.text))
    case .text(let id, _, let text):
      items.append(FoldItem(type: "text", key: id, text: text))
    case .tools(let group):
      items.append(FoldItem(type: "tools", key: group.eventID, total: group.total, calls: group.calls.map(projectCall)))
    case .plan(let p):
      plan = FoldPlan(
        after: p.after,
        todos: p.todos.map { FoldTodo(content: $0.content, activeForm: $0.activeForm, status: $0.status) }
      )
    case .result(let id, let result):
      items.append(FoldItem(type: "result", key: id, ok: result.ok, subtype: result.subtype, turns: result.turns))
    case .error(let id, let text):
      items.append(FoldItem(type: "error", key: id, text: text))
    case .report(let id, _, let report):
      items.append(FoldItem(type: "report", key: id, text: report.text, taskId: report.taskID))
    case .mod(let id, let lines):
      items.append(FoldItem(type: "mod", key: id, lines: lines.map { FoldModLine(key: $0.id, plugin: $0.plugin, text: $0.text) }))
    }
  }
  return (items, plan)
}

@Suite struct TranscriptFixtureTests {
  @Test func matchesTheWebFold() throws {
    let url = repoRoot.appending(path: "tests/fixtures/transcript/corpus.json")
    let corpus = try OmniJSON.decoder().decode(Corpus.self, from: Data(contentsOf: url))
    let names = Set(corpus.cases.map(\.name))
    #expect(names == Set([
      "first-string-field", "grouping", "mod-logs", "plan-placement", "result-before-call", "self-parent", "undecodable-tool-use",
      "zero-turn-success",
    ]))
    for c in corpus.cases {
      let got = project(Transcript(c.events))
      let plans = c.events.isEmpty ? 0 : Transcript(c.events).items.count { if case .plan = $0 { true } else { false } }
      #expect(plans <= 1, "\(c.name) has one plan")
      #expect(got.items == c.items, "\(c.name) items")
      #expect(got.plan == c.plan, "\(c.name) plan")
      #expect(Transcript(c.events).items == Transcript.build(c.events), "\(c.name) builds the same both ways")
    }
  }
}
