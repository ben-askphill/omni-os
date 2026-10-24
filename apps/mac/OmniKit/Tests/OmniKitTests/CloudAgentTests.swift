import Foundation
import Testing
import OmniKit

// Cursor Cloud threads: the cloud_agent rows the server writes (apps/server/harness/cursor-cloud) and how they fold.

private let agent = "bc-6f1c2d3e-4a5b-4c6d-8e7f-901234567890"

private func cloud(run: String = "run-1", status: String, branch: String? = nil, pr: String? = nil) -> (String, String) {
  var fields = [
    #""agent_id":"\#(agent)""#, #""url":"https://cursor.com/agents/\#(agent)""#, #""name":"Move the buttons""#,
    #""repo":"acme/widgets""#, #""run_id":"\#(run)""#, #""status":"\#(status)""#,
  ]
  if let branch { fields.append(#""branch":"\#(branch)""#) }
  if let pr { fields.append(#""pr_url":"\#(pr)""#) }
  return ("cloud_agent", "{" + fields.joined(separator: ",") + "}")
}

private func cards(_ items: [TranscriptItem]) -> [(Int, CloudAgentState)] {
  items.compactMap { if case .cloud(let id, let s) = $0 { (id, s) } else { nil } }
}

@Suite struct CloudAgentTests {
  @Test func decodesACloudAgentRow() throws {
    let e = try events([cloud(status: "FINISHED", branch: "cursor/move-6f1c", pr: "https://github.com/acme/widgets/pull/42")])[0]
    guard case .cloudAgent(let s) = e.content else { Issue.record("not decoded: \(e.content)"); return }
    #expect(s.agentID == agent && s.runID == "run-1" && s.repo == "acme/widgets" && s.ref == nil)
    #expect(s.branch == "cursor/move-6f1c" && s.prURL == "https://github.com/acme/widgets/pull/42")
    #expect(s.statusLabel == "Finished" && s.tone == .done && !s.isRunning)
    #expect(s.prNumber == "#42" && s.title == "Move the buttons" && s.runKey == "run-1")
  }

  @Test func keepsARowWithoutItsAgentURLOrStatusAsUnknown() throws {
    for payload in [#"{"agent_id":"bc-1","status":"RUNNING"}"#, #"{"agent_id":"bc-1","url":"https://cursor.com/agents/bc-1"}"#, #"{"url":"u","status":"RUNNING"}"#] {
      let e = try events([("cloud_agent", payload)])[0]
      guard case .unknown(let kind, _) = e.content else { Issue.record("decoded \(payload)"); continue }
      #expect(kind == "cloud_agent")
    }
  }

  @Test func saysEachStatus() throws {
    let say = { (status: String) throws -> (String, CloudAgentState.Tone) in
      guard case .cloudAgent(let s) = try events([cloud(status: status)])[0].content else { throw CancellationError() }
      return (s.statusLabel, s.tone)
    }
    #expect(try say("CREATING") == ("Starting", .live))
    #expect(try say("RUNNING") == ("Working", .live))
    #expect(try say("FINISHED") == ("Finished", .done))
    #expect(try say("ERROR") == ("Error", .needs))
    #expect(try say("CANCELLED") == ("Stopped", .plain))
    #expect(try say("EXPIRED") == ("Expired", .needs))
  }

  @Test func showsOneCardPerRunWithItsNewestState() throws {
    let e = try events([
      ("user", #"{"text":"go"}"#), cloud(status: "CREATING"), ("status", #"{"text":"Cursor cloud agent is starting"}"#),
      cloud(status: "RUNNING"), cloud(status: "RUNNING", branch: "cursor/b"), cloud(status: "FINISHED", branch: "cursor/b", pr: "https://github.com/acme/widgets/pull/7"),
      ("assistant_text", #"{"text":"Done."}"#), ("result", #"{"ok":true,"subtype":"success","turns":1}"#),
      ("user", #"{"text":"again"}"#), cloud(run: "run-2", status: "CREATING", branch: "cursor/b"),
    ])
    let built = Transcript.build(e)
    #expect(Transcript(e).items == built)
    let c = cards(built)
    #expect(c.count == 2)
    #expect(c[0].0 == 2 && c[0].1.status == "FINISHED" && c[0].1.prNumber == "#7")
    #expect(c[1].0 == 10 && c[1].1.status == "CREATING" && c[1].1.branch == "cursor/b")
    // The card sits where the run started, before its reply.
    #expect(built.map(\.id) == [.event(1), .event(2), .event(7), .event(8), .event(9), .event(10)])
  }

  @Test func updatesTheCardInPlaceAsRowsArrive() throws {
    let all = try events([("user", #"{"text":"go"}"#), cloud(status: "CREATING"), cloud(status: "RUNNING", branch: "cursor/b")])
    var t = Transcript()
    t.update(Array(all.prefix(2)))
    #expect(cards(t.items).map(\.1.status) == ["CREATING"])
    t.update(all)
    #expect(cards(t.items).map(\.1.status) == ["RUNNING"])
    #expect(cards(t.items).map(\.0) == [2])
    #expect(t.items == Transcript.build(all))
  }

  @Test func endsAGroupOfCalls() throws {
    let e = try events([
      ("tool_use", #"{"id":"a","name":"Bash","input":{},"parent":null}"#), cloud(status: "RUNNING"),
      ("tool_use", #"{"id":"b","name":"Bash","input":{},"parent":null}"#),
    ])
    let built = Transcript.build(e)
    #expect(Transcript(e).items == built)
    #expect(built.map(\.id) == [.event(1), .event(2), .event(3)])
  }

  @Test func copiesTheCardAsText() throws {
    guard case .cloudAgent(let s) = try events([cloud(status: "FINISHED", branch: "cursor/b", pr: "https://github.com/acme/widgets/pull/7")])[0].content else {
      Issue.record("not decoded")
      return
    }
    #expect(TranscriptMarkdown.copyText(.cloud(eventID: 1, s), cwd: nil) == """
      Move the buttons · Finished
      Repo: acme/widgets
      Branch: cursor/b
      PR: https://github.com/acme/widgets/pull/7
      Agent: https://cursor.com/agents/\(agent)
      """)
  }

  @Test func linksTheAgentFromItsSessionID() {
    #expect(CursorCloud.agentURL(sessionID: agent)?.absoluteString == "https://cursor.com/agents/\(agent)")
    #expect(CursorCloud.agentURL(sessionID: "00000000-0000-4000-8000-000000000001") == nil)
    #expect(CursorCloud.agentURL(sessionID: nil) == nil)
  }

  @Test func neverSteersWhenTheCatalogIsNotLoaded() {
    #expect(!SendRules.canSteer(harness: .cursorCloud, capabilities: nil))
  }
}
