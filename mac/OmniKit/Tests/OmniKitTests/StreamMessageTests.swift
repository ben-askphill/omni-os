import Foundation
import Testing
import OmniKit

let artifactJSON = """
  {"id":3,"thread_id":"t1","path":"/d/threads/t1/artifacts/r.md","name":"r.md","kind":"markdown","size":12,
   "created_at":"2026-09-28T07:57:15.045Z","updated_at":"2026-09-28T07:57:15.045Z"}
  """

@Suite struct StreamMessageTests {
  @Test func readsAnEventRow() throws {
    let m = try decode(ThreadStreamMessage.self, eventJSON(kind: "assistant_text", payload: #"{"text":"ack"}"#, id: 9))
    guard case .event(let row) = m else { Issue.record("not an event: \(m)"); return }
    #expect(row.id == 9)
    #expect(row.content == .assistantText(text: "ack"))
  }

  @Test func readsAnArtifact() throws {
    let m = try decode(ThreadStreamMessage.self, #"{"kind":"artifact","artifact":\#(artifactJSON)}"#)
    guard case .artifact(let a) = m else { Issue.record("not an artifact: \(m)"); return }
    #expect(a.name == "r.md")
    #expect(a.size == 12)
  }

  @Test func readsAThreadChange() throws {
    let m = try decode(ThreadStreamMessage.self, #"{"kind":"thread","thread":\#(threadJSON()),"pending":[],"live":false}"#)
    guard case .thread(let t, let pending, let live) = m else { Issue.record("not a thread: \(m)"); return }
    #expect(t.id == "t1")
    #expect(pending == [])
    #expect(live == false)
    let bare = try decode(ThreadStreamMessage.self, #"{"kind":"thread","thread":\#(threadJSON())}"#)
    guard case .thread(_, nil, nil) = bare else { Issue.record("expected no pending or live: \(bare)"); return }
  }

  @Test func keepsMessagesItDoesNotKnow() throws {
    let m = try decode(ThreadStreamMessage.self, #"{"kind":"typing","who":"agent"}"#)
    #expect(m == .unknown(.object(["kind": .string("typing"), "who": .string("agent")])))
  }

  @Test func readsFeedEvents() throws {
    let thread = try decode(FeedEvent.self, #"{"type":"thread","thread":\#(threadJSON())}"#)
    guard case .thread(let t) = thread else { Issue.record("not a thread: \(thread)"); return }
    #expect(t.title == "Fix cart")

    let usage = try decode(FeedEvent.self, #"{"type":"usage","harness":"codex","usage":{"status":"allowed","updated_at":"2026-09-28T07:57:15.045Z"}}"#)
    guard case .usage(.codex, let u?) = usage else { Issue.record("not codex usage: \(usage)"); return }
    #expect(u.status == "allowed")

    let artifact = try decode(FeedEvent.self, #"{"type":"artifact","artifact":\#(artifactJSON)}"#)
    guard case .artifact(let a) = artifact else { Issue.record("not an artifact: \(artifact)"); return }
    #expect(a.threadID == "t1")
  }

  @Test func readsUsageWithoutAHarnessAsClaudeCode() throws {
    let usage = try decode(FeedEvent.self, #"{"type":"usage","usage":null}"#)
    #expect(usage == .usage(harness: .claudeCode, usage: nil))
  }

  @Test func keepsFeedEventsItDoesNotKnow() throws {
    let e = try decode(FeedEvent.self, #"{"type":"automation","id":"x"}"#)
    #expect(e == .unknown(.object(["type": .string("automation"), "id": .string("x")])))
  }
}
