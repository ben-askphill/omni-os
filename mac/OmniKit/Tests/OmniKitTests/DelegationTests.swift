import Foundation
import Testing

@testable import OmniKit

private func json(_ s: String) -> String {
  String(data: try! JSONEncoder().encode(s), encoding: .utf8)!
}

private let solo = #"{"thread_id":"a","task_id":"T-1","channel":"inbox","role":"researcher","harness":"claude-code","status":"queued"}"#
private let team =
  #"{"lead":{"thread_id":"L","task_id":"T-9","title":"Mic research","channel":"inbox","role":"researcher","harness":"claude-code","status":"running"},"members":[{"thread_id":"m1","task_id":"T-9.1","title":"Price","channel":"inbox","role":"researcher","harness":"codex","status":"queued"}]}"#

@Suite struct DelegationTests {
  @Test func foldsDelegateCallsIntoOneCardAndATeamIntoItsOwn() throws {
    let items = Transcript(
      try events([
        ("tool_use", #"{"id":"d1","name":"mcp__omni__delegate","input":{"channel":"inbox","role":"researcher","prompt":"x","title":"Best price"},"parent":null}"#),
        ("tool_use", #"{"id":"d2","name":"mcp__omni__delegate","input":{"channel":"inbox","prompt":"y"},"parent":null}"#),
        ("tool_use", #"{"id":"d3","name":"mcp__omni__delegate_team","input":{"channel":"inbox","title":"Mic research","prompt":"z","tasks":[]},"parent":null}"#),
        ("tool_use", #"{"id":"d4","name":"mcp__omni__delegate","input":{"channel":"nope","prompt":"w"},"parent":null}"#),
        ("tool_result", #"{"tool_use_id":"d1","text":\#(json(solo)),"is_error":false,"truncated":false}"#),
        ("tool_result", #"{"tool_use_id":"d2","text":\#(json(solo.replacingOccurrences(of: "\"a\"", with: "\"b\""))),"is_error":false,"truncated":false}"#),
        ("tool_result", #"{"tool_use_id":"d3","text":\#(json(team)),"is_error":false,"truncated":false}"#),
        ("tool_result", #"{"tool_use_id":"d4","text":"unknown channel","is_error":true,"truncated":false}"#),
      ])
    ).items
    guard case .tools(let group)? = items.first else { Issue.record("no tool group: \(items)"); return }
    let cards = Delegation.of(group.calls)
    #expect(cards.count == 2)
    #expect(cards[0].lead == nil)
    #expect(cards[0].branches.map(\.id) == ["a", "b"])
    #expect(cards[0].branches[0].title == "Best price")
    #expect(cards[1].lead?.title == "Mic research")
    #expect(cards[1].branches.map(\.taskID) == ["T-9.1"])
    #expect(cards[1].branches[0].harness == .codex)
  }

  @Test func takesTheLiveStateOfAKnownThread() throws {
    let card = DelegationBranch(id: "a", title: "x", role: nil, channel: "inbox", harness: .claudeCode, taskID: nil, status: .queued)
    let t = try OmniJSON.decoder().decode(
      OmniThread.self,
      from: Data(
        #"{"id":"a","channel_id":"inbox","title":"Best price","status":"done","source":"team","has_run":1,"created_at":"2026-10-02T12:00:00Z","updated_at":"2026-10-02T12:05:00Z"}"#
          .utf8))
    #expect(card.live(["a": t]).status == .done)
    #expect(card.live(["a": t]).title == "Best price")
    #expect(Delegation.team(of: [t]).map(\.id) == ["a"])
  }
}
