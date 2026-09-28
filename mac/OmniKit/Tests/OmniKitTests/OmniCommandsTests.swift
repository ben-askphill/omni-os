import Foundation
import Testing
import OmniKit

private let thread = try! OmniJSON.decoder().decode(OmniThread.self, from: Data("""
  {"id":"t1","channel_id":"acme","title":"Fix cart","status":"done","role":"","model":"sonnet","harness":"claude-code",
   "effort":"high","session_id":"s1","has_run":1,"cwd":"/tmp/x","branch":null,"parent_id":null,"task_id":null,"source":"manual",
   "automation":null,"last_text":null,"created_at":"2026-09-28T07:57:15Z","updated_at":"2026-09-28T07:57:15Z"}
  """.utf8))

@Suite struct OmniCommandsTests {
  @Test func clearWithNoPromptOpensTheComposerWithTheSameSettings() async throws {
    let t = StubTransport(body: "{}")
    let result = try await OmniCommands.run(.newThread(prompt: ""), in: thread, client: OmniClient(port: 4799, transport: t))
    #expect(result == .openNewThread(NewThreadPreset(channel: "acme", role: "", harness: "claude-code", model: "sonnet", effort: "high")))
    #expect(t.requests.isEmpty)
  }

  @Test func clearWithAPromptStartsAThreadWithThisOnesSettings() async throws {
    let t = StubTransport(body: try fixture("thread-created.json"))
    let result = try await OmniCommands.run(.newThread(prompt: "fix cart"), in: thread, client: OmniClient(port: 4799, transport: t))
    guard case .threadCreated = result else { Issue.record("got \(String(describing: result))"); return }
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "POST" && req.url?.path == "/api/threads")
    #expect(try bodyJSON(req) == .object(["channel": .string("acme"), "prompt": .string("fix cart"), "harness": .string("claude-code"), "model": .string("sonnet"), "effort": .string("high")]))
  }

  @Test func renamePatchesTheTitle() async throws {
    let t = StubTransport(body: try fixture("thread-created.json"))
    let result = try await OmniCommands.run(.rename(title: "New name"), in: thread, client: OmniClient(port: 4799, transport: t))
    guard case .renamed = result else { Issue.record("got \(String(describing: result))"); return }
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "PATCH" && req.url?.path == "/api/threads/t1")
    #expect(try bodyJSON(req) == .object(["title": .string("New name")]))
  }

  @Test func sendAndFixedDoNothing() async throws {
    let t = StubTransport(body: "{}")
    let client = OmniClient(port: 4799, transport: t)
    #expect(try await OmniCommands.run(.send, in: thread, client: client) == nil)
    #expect(try await OmniCommands.run(.fixed, in: thread, client: client) == nil)
    #expect(t.requests.isEmpty)
    #expect(NewThreadPreset.otherModel(thread) == NewThreadPreset(channel: "acme", role: "", pickModel: true))
  }
}
