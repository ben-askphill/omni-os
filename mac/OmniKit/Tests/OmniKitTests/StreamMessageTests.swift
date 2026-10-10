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

  @Test func readsContextReadings() throws {
    let m = try decode(ThreadStreamMessage.self, #"{"kind":"context","context":{"used":42000,"max":200000,"source":"claude-cli"}}"#)
    guard case .context(.object(let o)) = m else { Issue.record("not a context reading: \(m)"); return }
    #expect(o["used"] == .number(42000))
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

  // Mods: the shapes server/runner/records.ts sends for a plugin's $.ui calls.

  @Test func readsAModToast() throws {
    let m = try decode(
      ThreadStreamMessage.self, #"{"kind":"mod_toast","thread_id":"t1","plugin":"omni-tool","text":"thread_info ran","timeout_ms":4000}"#)
    guard case .modToast(let t) = m else { Issue.record("not a toast: \(m)"); return }
    #expect(t.threadID == "t1")
    #expect(t.plugin == "omni-tool")
    #expect(t.text == "thread_info ran")
    #expect(t.shownFor == .milliseconds(4000))
    let bare = try decode(ThreadStreamMessage.self, #"{"kind":"mod_toast","text":"hi"}"#)
    guard case .modToast(let b) = bare else { Issue.record("not a toast: \(bare)"); return }
    #expect(b.plugin == "mod")
    #expect(b.shownFor == .milliseconds(4000), "4s when the mod gives no timeout")
    let long = try decode(ThreadStreamMessage.self, #"{"kind":"mod_toast","text":"hi","timeout_ms":600000}"#)
    guard case .modToast(let l) = long else { Issue.record("not a toast: \(long)"); return }
    #expect(l.shownFor == .milliseconds(15000), "held to 15s")
  }

  @Test func keepsAToastWithoutTextAsUnknown() throws {
    let m = try decode(ThreadStreamMessage.self, #"{"kind":"mod_toast","plugin":"p"}"#)
    guard case .unknown = m else { Issue.record("expected unknown: \(m)"); return }
  }

  @Test func readsModStatusFeedEvents() throws {
    let e = try decode(
      FeedEvent.self,
      #"{"type":"mods","mods":[{"thread_id":"t1","channel_id":"c","plugin":"omni-tool","text":"omni-tool: ready","updated_at":"2026-10-10T07:57:15.045Z"}]}"#)
    guard case .mods(let list) = e else { Issue.record("not mods: \(e)"); return }
    #expect(list.map(\.text) == ["omni-tool: ready"])
    #expect(list.first?.id == "t1/omni-tool")
    #expect(try decode(FeedEvent.self, #"{"type":"mods","mods":[]}"#) == .mods([]))
  }

  @Test func readsAModLogRow() throws {
    let row = try decode(EventRow.self, eventJSON(kind: "mod", payload: #"{"plugin":"omni-tool","level":"log","text":"omni-tool: thread_info served"}"#))
    guard case .mod(let log) = row.content else { Issue.record("not a mod log: \(row.content)"); return }
    #expect(log.plugin == "omni-tool")
    #expect(log.text == "omni-tool: thread_info served")
    let unnamed = try decode(EventRow.self, eventJSON(kind: "mod", payload: #"{"plugin":"","level":"log","text":"x"}"#))
    guard case .mod(let u) = unnamed.content else { Issue.record("not a mod log"); return }
    #expect(u.plugin == "mod")
    let broken = try decode(EventRow.self, eventJSON(kind: "mod", payload: #"{"plugin":"p","text":5}"#))
    guard case .unknown(kind: "mod", _) = broken.content else { Issue.record("expected unknown: \(broken.content)"); return }
  }
}
