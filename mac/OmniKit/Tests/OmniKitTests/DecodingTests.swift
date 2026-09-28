import Foundation
import Testing
import OmniKit

func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
  try OmniJSON.decoder().decode(T.self, from: Data(json.utf8))
}

let channelJSON = """
  {"id":"acme","name":"Acme","kind":"client","repo_path":null,"github_repo":"acme/shop","use_worktree":1,"base_dir":null,
   "store_domain":null,"portal_slug":null,"browser_headless":0,"notes":null,"archived":0,"created_at":"2026-09-28T07:57:15.045Z"}
  """

func threadJSON(effort: String = "", status: String = "done", extra: String = "") -> String {
  """
  {"id":"t1","channel_id":"acme","title":"Fix cart","status":"\(status)","role":null,"model":"sonnet","harness":"claude-code",
   "effort":"\(effort)","session_id":"s1","has_run":1,"cwd":"/tmp/x","branch":null,"parent_id":null,"task_id":null,
   "source":"manual","automation":null,"last_text":null,"created_at":"2026-09-28T07:57:15Z","updated_at":"2026-09-28T07:58:00.5Z"\(extra)}
  """
}

func eventJSON(kind: String, payload: String, id: Int = 1) -> String {
  let quoted = String(data: try! JSONEncoder().encode(payload), encoding: .utf8)!
  return #"{"id":\#(id),"thread_id":"t1","kind":"\#(kind)","payload":\#(quoted),"created_at":"2026-09-28T07:57:15.045Z"}"#
}

@Suite struct DecodingTests {
  @Test func readsIntBooleans() throws {
    let c = try decode(Channel.self, channelJSON)
    #expect(c.useWorktree == true)
    #expect(c.browserHeadless == false)
    #expect(c.archived == false)
    #expect(c.kind == .client)
    #expect(c.repoPath == nil)
    #expect(c.githubRepo == "acme/shop")
    let t = try decode(OmniThread.self, threadJSON())
    #expect(t.hasRun == true)
  }

  @Test func readsTrueAndFalseAsBooleansToo() throws {
    let json = channelJSON.replacingOccurrences(of: #""use_worktree":1"#, with: #""use_worktree":false"#)
    #expect(try decode(Channel.self, json).useWorktree == false)
  }

  @Test(arguments: [
    ("2026-09-28T07:57:15.045Z", 1_790_582_235.045),
    ("2026-09-28T07:57:15Z", 1_790_582_235),
    ("2026-09-28T09:57:15+02:00", 1_790_582_235),
    ("2026-09-28 07:57:15", 1_790_582_235),
  ])
  func readsDatesWithAndWithoutFractionalSeconds(_ text: String, _ seconds: Double) throws {
    let date = try #require(OmniJSON.parseDate(text))
    #expect(abs(date.timeIntervalSince1970 - seconds) < 0.001)
  }

  @Test func rejectsTextThatIsNotADate() {
    #expect(OmniJSON.parseDate("yesterday") == nil)
    #expect(throws: DecodingError.self) {
      try decode(Channel.self, channelJSON.replacingOccurrences(of: "2026-09-28T07:57:15.045Z", with: "soon"))
    }
  }

  @Test func readsAnEmptyEffortAsTheDefault() throws {
    #expect(try decode(OmniThread.self, threadJSON()).effort == nil)
    #expect(try decode(OmniThread.self, threadJSON(effort: "high")).effort == "high")
  }

  @Test func keepsStatusesItDoesNotKnow() throws {
    let t = try decode(OmniThread.self, threadJSON(status: "paused"))
    #expect(t.status.rawValue == "paused")
    #expect(!t.status.isActive)
    #expect(try decode(OmniThread.self, threadJSON(status: "queued")).status.isActive)
  }

  @Test func readsAChannelWithItsRunningThreads() throws {
    let json = channelJSON.dropLast() + #","running":1,"active":[{"id":"t1","channel_id":"acme","title":"Fix cart","status":"running","created_at":"2026-09-28T07:57:15.045Z"}]}"#
    let c = try decode(ChannelWithRunning.self, String(json))
    #expect(c.id == "acme")
    #expect(c.name == "Acme")
    #expect(c.running == 1)
    #expect(c.active.map(\.id) == ["t1"])
    #expect(c.active.first?.status == .running)
  }

  @Test func readsAChannelWithoutActiveThreads() throws {
    let c = try decode(ChannelWithRunning.self, String(channelJSON.dropLast() + #","running":0}"#))
    #expect(c.active.isEmpty)
  }

  @Test func readsKnownEventPayloads() throws {
    let user = try decode(EventRow.self, eventJSON(kind: "user", payload: #"{"text":"hi","source":"ben","attachments":[{"name":"a.png","path":"/x/a.png","size":3,"mime":"image/png","image":true}]}"#))
    guard case .user(let m) = user.content else { Issue.record("not a user event: \(user.content)"); return }
    #expect(m.text == "hi")
    #expect(m.source == "ben")
    #expect(m.attachments?.first?.image == true)

    let tool = try decode(EventRow.self, eventJSON(kind: "tool_use", payload: #"{"id":"u1","name":"Read","input":{"file_path":"/a","limit":3}}"#))
    guard case .toolUse(let use) = tool.content else { Issue.record("not a tool_use: \(tool.content)"); return }
    #expect(use.name == "Read")
    #expect(use.input == .object(["file_path": .string("/a"), "limit": .number(3)]))
    #expect(use.parent == nil)

    let result = try decode(EventRow.self, eventJSON(kind: "result", payload: #"{"ok":true,"subtype":"success","duration_ms":1200,"turns":2,"cost_usd":0.01}"#))
    guard case .result(let r) = result.content else { Issue.record("not a result: \(result.content)"); return }
    #expect(r.ok)
    #expect(r.turns == 2)
    #expect(r.stopped == nil)

    #expect(try decode(EventRow.self, eventJSON(kind: "assistant_text", payload: #"{"text":"ack"}"#)).content == .assistantText(text: "ack"))
    #expect(try decode(EventRow.self, eventJSON(kind: "error", payload: #"{"text":"boom"}"#)).content == .error(text: "boom"))
  }

  @Test func keepsEventKindsItDoesNotKnow() throws {
    let row = try decode(EventRow.self, eventJSON(kind: "plan", payload: #"{"steps":["a"]}"#))
    #expect(row.kind == "plan")
    #expect(row.content == .unknown(kind: "plan", payload: .object(["steps": .array([.string("a")])])))
  }

  @Test func keepsAKnownKindWhosePayloadChangedShape() throws {
    let row = try decode(EventRow.self, eventJSON(kind: "tool_use", payload: #"{"tool":"Read"}"#))
    #expect(row.content == .unknown(kind: "tool_use", payload: .object(["tool": .string("Read")])))
    let broken = try decode(EventRow.self, eventJSON(kind: "user", payload: "not json"))
    #expect(broken.content == .unknown(kind: "user", payload: .string("not json")))
  }

  @Test func readsAThreadSnapshot() throws {
    let json = """
      {"thread":\(threadJSON()),"events":[\(eventJSON(kind: "status", payload: #"{"text":"compacting"}"#))],"artifacts":[],
       "children":[],"parent":null,"pending":[{"uuid":"u","kind":"user","text":"next","source":"ben","mode":"queue","state":"held"}],"live":true}
      """
    let d = try decode(ThreadDetail.self, json)
    #expect(d.channel == nil)
    #expect(d.parent == nil)
    #expect(d.events.first?.content == .status(text: "compacting"))
    #expect(d.pending.first?.mode == .queue)
    #expect(d.pending.first?.state == .held)
    #expect(d.pending.first?.taskID == nil)
    #expect(d.live)
  }

  @Test func readsStatusAndDropsHarnessesWithoutUsage() throws {
    let json = """
      {"usage":{"claude-code":{"five_hour":{"utilization":0.25,"resetsAt":1790328600},"status":"allowed","updated_at":"2026-09-28T07:57:15.045Z"},
       "codex":null,"cursor":null},"slots":{"claude-code":{"running":1,"cap":4},"codex":{"running":0,"cap":4}},
       "running":1,"queued":0,"maxConcurrent":4,"maxUploadMb":25}
      """
    let s = try decode(Status.self, json)
    #expect(Array(s.usage.keys) == [.claudeCode])
    let five = try #require(s.usage[.claudeCode]?.fiveHour)
    #expect(five.utilization == 0.25)
    #expect(five.resetsAt == Date(timeIntervalSince1970: 1_790_328_600))
    #expect(s.usage[.claudeCode]?.sevenDay == nil)
    #expect(s.slots[.codex] == HarnessSlot(running: 0, cap: 4))
    #expect(s.server == nil)
  }

  @Test func readsTheServerThatAnswered() throws {
    let json = """
      {"usage":{},"slots":{},"running":0,"queued":0,"maxConcurrent":4,"maxUploadMb":25,
       "server":{"version":"0.1.0","pid":42,"root":"/r","dataDir":"/r/data","gitHead":null,"startedAt":"2026-09-28T07:57:15.045Z","port":4747}}
      """
    let server = try #require(try decode(Status.self, json).server)
    #expect(server.pid == 42)
    #expect(server.gitHead == nil)
    #expect(server.port == 4747)
  }

  @Test func readsHarnessesAndCrew() throws {
    let harness = """
      {"id":"codex","name":"Codex","plan":"ChatGPT plan","capabilities":{"warmProcess":true,"steer":true,"inlineImages":true,"usage":"five-hour-week"},
       "available":false,"fix":"codex login","models":[{"id":"gpt-5","label":"GPT-5","efforts":["low","high"],"defaultEffort":"high","default":true},
       {"id":"mini","label":"Mini","efforts":[],"defaultEffort":""}],"cap":4,"running":0}
      """
    let h = try decode(HarnessInfo.self, harness)
    #expect(h.id == .codex)
    #expect(h.fix == "codex login")
    #expect(h.models.map(\.isDefault) == [true, false])
    #expect(h.models.map(\.defaultEffort) == ["high", nil])
    let role = try decode(CrewRole.self, #"{"id":"dev","name":"Dev","description":"Writes code","mcp":["omni"],"charter":"Be good","effort":""}"#)
    #expect(role.harness == nil)
    #expect(role.effort == nil)
    #expect(role.error == nil)
  }
}
