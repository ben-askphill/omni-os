import Foundation
import Synchronization
import Testing
import OmniKit

// The shapes follow packages/shared/continue.ts. The fixtures continue-preview.json and thread-continued.json, once
// apps/server/tests/mac-fixtures.test.ts records them, hold the server to the same JSON.

private func runJSON(_ harness: String, _ model: String, _ name: String, _ label: String) -> String {
  #"{"harness":"\#(harness)","model":"\#(model)","effort":"","harnessName":"\#(name)","modelLabel":"\#(label)"}"#
}

private let filesJSON = """
  {"base":"aaa","head":"bbb","tree":"ccc","total":5,"listed":[
    {"path":"src/cart.ts","old_path":null,"status":"modified"},{"path":"src/total.ts","old_path":"src/sum.ts","status":"renamed"}]}
  """

private func previewJSON(
  revision: String = "r1", to: String = "codex", blocked: String = "null", files: String = filesJSON, workspace: String = "worktree"
) -> String {
  let target = to == "codex" ? runJSON("codex", "gpt-y", "Codex", "GPT Y") : runJSON(to, "sonnet", "Claude Code", "Sonnet")
  return """
    {"carryover":{
      "source":{"id":"t1","title":"Fix cart","channel":"acme","run":\(runJSON("claude-code", "sonnet", "Claude Code", "Sonnet"))},
      "to":\(target),
      "goal":"Fix the cart total","constraints":["Work on branch omni/abc.","Do not push."],
      "files":\(files),
      "checks":[{"id":7,"command":"npm test","ok":false,"output":"1 failed"},{"id":9,"command":"npm run typecheck","ok":true,"output":""}],
      "recent":[{"id":3,"who":"user","text":"fix it","condensed":true},{"id":12,"who":"agent","text":"Done.\\nAll green.","condensed":false}],
      "attachments":[
        {"id":"u2:0","name":"cart.png","event_id":2,"mime":"image/png","size":3400,"image":true,"availability":"available",
         "reason":null,"selected":true,"carried":true,"as":"inline"},
        {"id":"u2:1","name":"trace.zip","event_id":2,"mime":"application/zip","size":null,"image":false,"availability":"missing",
         "reason":"Its bytes are not on this Mac.","selected":true,"carried":false,"as":null}],
      "omitted":[{"what":"history","count":20,"note":"20 older entries left out.","ref":"/api/threads/t1/history?through=2"},
        {"what":"attachments","count":1,"note":"1 attachment is not carried.","ref":null},
        {"what":"uncommitted","count":2,"note":"2 binary files are not carried.","ref":"git -C /tmp/x status"},
        {"what":"messages","count":1,"note":"1 parked message is not carried.","ref":null}],
      "budget":24000,"chars":12345,"text":"<omni-carryover>the packet</omni-carryover>"},
     "revision":"\(revision)","workspace":"\(workspace)","blocked":\(blocked)}
    """
}

private let busyBlock = #"{"code":"running","message":"A turn is running in it."}"#

private func preview(revision: String = "r1", to: String = "codex", blocked: String = "null") throws -> ContinuePreview {
  try decode(ContinuePreview.self, previewJSON(revision: revision, to: to, blocked: blocked))
}

private func linkJSON(_ id: String, title: String, harness: String, carried: String = "null") -> String {
  #"{"id":"\#(id)","title":"\#(title)","harness":"\#(harness)","model":null,"status":"done","created_at":"2026-10-24T09:00:00Z","carried":\#(carried)}"#
}

private let carriedJSON = #"{"entries":34,"condensed":12,"omitted":20,"chars":12345,"budget":24000,"files":3}"#

/// A thread row with its own id, title and harness, continuing `from` when given.
private func row(_ id: String, title: String = "Fix cart", harness: String = "claude-code", from: String? = nil) -> String {
  """
  {"id":"\(id)","channel_id":"acme","title":"\(title)","status":"running","role":null,"model":"gpt-y","harness":"\(harness)",
   "effort":"","session_id":null,"has_run":0,"cwd":null,"branch":null,"parent_id":null,"task_id":null,
   "continued_from":\(from.map { "\"\($0)\"" } ?? "null"),"source":"manual","automation":null,"last_text":null,
   "created_at":"2026-10-24T09:00:00Z","updated_at":"2026-10-24T09:00:00Z"}
  """
}

private func continuedDetail() throws -> ThreadDetail {
  try decode(ThreadDetail.self, """
    {"thread":\(row("t1", from: "s0")),"events":[],"pending":[],"live":false,
     "continued_from":\(linkJSON("s0", title: "Cart, first try", harness: "codex", carried: carriedJSON)),
     "continued_in":[\(linkJSON("n1", title: "Cart, third try", harness: "cursor"))]}
    """)
}

private let catalogJSON = """
  [
   {"id":"claude-code","name":"Claude Code","plan":"Claude plan","capabilities":{"warmProcess":true,"steer":true,"inlineImages":true,"usage":"five-hour-week"},
    "available":true,"cap":4,"running":0,"models":[
     {"id":"opus","label":"Opus","efforts":["low","high"],"defaultEffort":"high"},
     {"id":"sonnet","label":"Sonnet","default":true,"efforts":["low","high"],"defaultEffort":"high"}]},
   {"id":"hermes","name":"Hermes","plan":"Hermes","capabilities":{"warmProcess":false,"steer":false,"inlineImages":false,"usage":"none"},
    "available":true,"cap":4,"running":0,"models":[{"id":"h1","label":"H1","default":true}]},
   {"id":"codex","name":"Codex","plan":"ChatGPT plan","capabilities":{"warmProcess":false,"steer":false,"inlineImages":false,"usage":"none"},
    "available":CODEX,"cap":4,"running":0,"models":[
     {"id":"gpt-x","label":"GPT X","efforts":["high"]},{"id":"gpt-y","label":"GPT Y","default":true,"efforts":["high"]}]},
   {"id":"cursor","name":"Cursor Agent","plan":"Cursor plan","capabilities":{"warmProcess":false,"steer":false,"inlineImages":false,"usage":"none"},
    "available":false,"fix":"cursor-agent login","cap":4,"running":0,"models":[]},
   {"id":"cursor-cloud","name":"Cursor Cloud","plan":"Cursor plan","capabilities":{"warmProcess":false,"steer":false,"inlineImages":false,"usage":"none"},
    "available":true,"cap":4,"running":0,"models":[{"id":"c1","label":"C1","default":true}]}
  ]
  """

private func catalog(codex: Bool = true) throws -> [HarnessInfo] {
  try decode([HarnessInfo].self, catalogJSON.replacingOccurrences(of: "CODEX", with: codex ? "true" : "false"))
}

private let startBody = ContinueBody(
  run: Run(harness: .codex, model: "gpt-y", effort: ""), attachments: ["u2:0"], text: "Pick it up from the failing test",
  requestID: "q1", revision: "r1")

@Suite struct ContinueDecodingTests {
  @Test func readsAPreview() throws {
    let p = try preview(blocked: busyBlock)
    let c = p.carryover
    #expect(p.revision == "r1")
    #expect(p.workspace == .worktree)
    #expect(p.blocked?.code == .running)
    #expect(p.blocked?.message == "A turn is running in it.")
    #expect(c.source.id == "t1")
    #expect(c.source.run.harnessName == "Claude Code")
    #expect(c.to.harness == "codex")
    #expect(c.to.modelLabel == "GPT Y")
    #expect(c.goal == "Fix the cart total")
    #expect(c.constraints.count == 2)
    let files = try #require(c.files)
    #expect(files.listed.map(\.path) == ["src/cart.ts", "src/total.ts"])
    #expect(files.listed[1].status == .renamed)
    #expect(files.listed[1].oldPath == "src/sum.ts")
    #expect(files.more == 3)
    #expect(c.checks.map(\.ok) == [false, true])
    #expect(c.recent.map(\.who) == [.user, .agent])
    #expect(c.recent.map(\.condensed) == [true, false])
    #expect(c.recent[1].text == "Done.\nAll green.")
    #expect(c.attachments.map(\.id) == ["u2:0", "u2:1"])
    #expect(c.attachments.map(\.eventID) == [2, 2])
    #expect(c.attachments.map(\.carried) == [true, false])
    #expect(c.attachments.map(\.availability) == [.available, .missing])
    #expect(c.attachments.map(\.arrival) == ["inline", nil])
    #expect(c.attachments.map(\.size) == [3400, nil])
    #expect(c.attachments[1].reason == "Its bytes are not on this Mac.")
    #expect(c.omitted.map(\.what) == [.history, .attachments, .uncommitted, .messages])
    #expect(c.omitted.map(\.ref) == ["/api/threads/t1/history?through=2", nil, "git -C /tmp/x status", nil])
    #expect(c.budget == 24000)
    #expect(c.chars == 12345)
    #expect(c.text.hasPrefix("<omni-carryover>"))
  }

  @Test func readsAPreviewWithNoRepoWorkAndNoBlock() throws {
    let p = try decode(ContinuePreview.self, previewJSON(files: "null", workspace: "folder"))
    #expect(p.carryover.files == nil)
    #expect(p.workspace == .folder)
    #expect(p.blocked == nil)
  }

  @Test func readsBothLinksOnAThread() throws {
    let d = try continuedDetail()
    #expect(d.thread.continuedFrom == "s0")
    let from = try #require(d.continuedFrom)
    #expect(from.id == "s0")
    #expect(from.harness == .codex)
    #expect(from.status == .done)
    #expect(from.model == nil)
    #expect(from.carried?.entries == 34)
    #expect(d.continuedIn.map(\.id) == ["n1"])
    #expect(d.continuedIn.first?.carried == nil)
  }

  @Test func leavesTheCarryoverEventOutOfTheTranscript() throws {
    let rows = try [eventJSON(kind: "carryover", payload: carriedJSON, id: 1), eventJSON(kind: "user", payload: #"{"text":"go"}"#, id: 2)]
      .map { try decode(EventRow.self, $0) }
    let items = Transcript(rows).items
    #expect(items.count == 1)
    guard case .user = items.first else { Issue.record("not the user row: \(items)"); return }
  }

  @Test func readsAThreadFromAServerWithoutLinks() throws {
    let d = try decode(ThreadDetail.self, #"{"thread":\#(threadJSON()),"events":[]}"#)
    #expect(d.thread.continuedFrom == nil)
    #expect(d.continuedFrom == nil)
    #expect(d.continuedIn.isEmpty)
  }
}

@Suite struct ContinueRulesTests {
  // Expected strings printed by carriedText and continueRefusal in packages/shared/continue.ts.
  @Test(arguments: [
    ((34, 12, 20, 0), "Carried 34 entries (12 shortened), 20 older left out."),
    ((1, 0, 0, 1), "Carried 1 entry, 1 changed file."),
    ((0, 0, 0, 0), "Carried 0 entries."),
    ((5, 1, 1, 7), "Carried 5 entries (1 shortened), 1 older left out, 7 changed files."),
  ])
  func writesTheCarriedLine(_ c: (Int, Int, Int, Int), _ text: String) throws {
    let stats = try decode(
      CarriedStats.self, #"{"entries":\#(c.0),"condensed":\#(c.1),"omitted":\#(c.2),"chars":1,"budget":1,"files":\#(c.3)}"#)
    #expect(ContinueRules.carriedText(stats) == text)
  }

  @Test func writesTheCarriedLineWithAttachments() throws {
    let some = try decode(
      CarriedStats.self, #"{"entries":3,"condensed":0,"omitted":0,"chars":1,"budget":1,"files":2,"attachments":2}"#)
    #expect(ContinueRules.carriedText(some) == "Carried 3 entries, 2 changed files, 2 attachments.")
    let one = try decode(
      CarriedStats.self, #"{"entries":3,"condensed":0,"omitted":0,"chars":1,"budget":1,"files":0,"attachments":1}"#)
    #expect(ContinueRules.carriedText(one) == "Carried 3 entries, 1 attachment.")
  }

  // Expected strings printed by typeLabel and attachmentRows in apps/web/src/continue.ts.
  @Test(arguments: [
    ("image/png", "PNG image"), ("image/jpeg", "JPEG image"), ("image/svg+xml", "SVG image"), ("application/pdf", "PDF"),
    ("text/plain", "Text"), ("application/zip", "File"), ("", "File"),
  ])
  func namesTheTypeOfAFile(_ mime: String, _ label: String) {
    #expect(ContinueRules.typeLabel(mime) == label)
  }

  @Test func describesEachAttachment() throws {
    let files = try decode(ContinuePreview.self, previewJSON()).carryover.attachments
    #expect(files.map(ContinueRules.attachmentMeta) == ["PNG image · 3.3 KB", "File · size unknown"])
    #expect(files.map(ContinueRules.attachmentNote) == ["Goes inline as an image.", "Its bytes are not on this Mac."])
    #expect(files.map(ContinueRules.attachmentTag) == [nil, "Missing"])
    #expect(ContinueRules.attachmentsSummary(files) == "1 of 2 will be copied into the new thread.")
    #expect(ContinueRules.attachmentsSummary([]) == "None will be carried. Tick the ones the new thread needs.")
  }

  @Test func refusesTheRemoteHarnessesOnly() {
    #expect(ContinueRules.continueRefusal(.hermes) == "Hermes runs on its own server, so this thread's files cannot move there.")
    #expect(
      ContinueRules.continueRefusal(.cursorCloud)
        == "Cursor Cloud works on its own clone of the repo, so it cannot start from this thread's checkout.")
    for h: HarnessID in [.claudeCode, .codex, .cursor] { #expect(ContinueRules.continueRefusal(h) == nil) }
    #expect(ContinueRules.sourceRefusal(.hermes) != nil)
    #expect(ContinueRules.sourceRefusal(.codex) == nil)
  }

  @Test func showsAHistoryEntryWithoutItsSpeakerTag() throws {
    let entry = { (who: String, text: String) in
      try decode(CarryoverEntry.self, #"{"id":1,"who":"\#(who)","text":"\#(text)","condensed":false}"#)
    }
    #expect(ContinueRules.entryText(try entry("user", "[Ben] Round it to cents")) == "Round it to cents")
    #expect(ContinueRules.entryText(try entry("agent", "[Claude Code] Done.")) == "Done.")
    #expect(ContinueRules.entryText(try entry("tool", "  - Bash: npm test\\n    Failed: 1 test failed")) == "Bash: npm test\nFailed: 1 test failed")
    #expect(ContinueRules.entryText(try entry("report", "[Crew report: Fix, done] ok")) == "[Crew report: Fix, done] ok")
    #expect(ContinueRules.entryText(try entry("omni", "[Carried over from \\\"A\\\" on Codex] x")) == "[Carried over from \"A\" on Codex] x")
  }

  @Test func hintsThatASlashCommandRunsFirst() {
    #expect(ContinueRules.slashHint("/compact then carry on") == "A slash command runs first. The carryover goes with your next message.")
    #expect(ContinueRules.slashHint("Fix it, see /tmp/x") == nil)
    #expect(ContinueRules.slashHint("") == nil)
  }

  @Test(arguments: [
    (12_345, 24_000, "12.3k of 24k characters"),
    (850, 24_000, "850 of 24k characters"),
    (24_000, 24_000, "24k of 24k characters"),
    (1_000, 2_500, "1k of 2.5k characters"),
  ])
  func writesTheSize(_ chars: Int, _ budget: Int, _ text: String) {
    #expect(ContinueRules.sizeText(chars: chars, budget: budget) == text)
  }

  @Test func offersTheLocalHarnessesAndOpensOnAnotherOne() throws {
    let t = ContinueTargets(try catalog(), source: .claudeCode)
    #expect(t.offered.map(\.id) == [.claudeCode, .codex, .cursor])
    #expect(t.refused.map(\.id) == [.hermes, .cursorCloud])
    #expect(t.refused.map(\.reason) == [ContinueRules.continueRefusal(.hermes), ContinueRules.continueRefusal(.cursorCloud)])
    #expect(t.initial == Run(harness: .codex, model: "gpt-y", effort: ""))
    #expect(ContinueTargets(try catalog(), source: .codex).initial == Run(harness: .claudeCode, model: "sonnet", effort: ""))
  }

  @Test func opensOnTheSourcesHarnessWhenNoOtherIsAvailable() throws {
    #expect(ContinueTargets(try catalog(codex: false), source: .claudeCode).initial == Run(harness: .claudeCode, model: "sonnet", effort: ""))
    #expect(ContinueTargets([], source: .claudeCode).initial == nil)
  }
}

@Suite struct ContinueClientTests {
  @Test func postsTheRunForAPreview() async throws {
    let t = StubTransport(body: previewJSON())
    let p = try await OmniClient(port: 4799, transport: t).continuePreview(
      "t 1", run: Run(harness: .codex, model: "gpt-y", effort: "high"), attachments: [])
    #expect(p.revision == "r1")
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "POST")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/threads/t%201/continue/preview")
    #expect(
      try bodyJSON(req)
        == .object(["harness": .string("codex"), "model": .string("gpt-y"), "effort": .string("high"), "attachments": .array([])]))
  }

  @Test func postsTheSortedPicksForAPreview() async throws {
    let t = StubTransport(body: previewJSON())
    _ = try await OmniClient(port: 4799, transport: t).continuePreview(
      "t1", run: Run(harness: .codex, model: "", effort: ""), attachments: ["u2:1", "u2:0"])
    let req = try #require(t.requests.first)
    #expect(
      try bodyJSON(req)
        == .object([
          "harness": .string("codex"), "model": .string(""), "effort": .string(""),
          "attachments": .array([.string("u2:0"), .string("u2:1")]),
        ]))
  }

  @Test func startsAndReadsTheNewThread() async throws {
    let t = StubTransport(body: #"{"thread":\#(row("n1", harness: "codex", from: "t1")),"duplicate":true}"#)
    let started = try await OmniClient(port: 4799, transport: t).startContinue("t1", startBody)
    #expect(started.thread.id == "n1")
    #expect(started.thread.continuedFrom == "t1")
    #expect(started.duplicate)
    let req = try #require(t.requests.first)
    #expect(req.url?.path() == "/api/threads/t1/continue")
    #expect(try bodyJSON(req) == .object([
      "harness": .string("codex"), "model": .string("gpt-y"), "effort": .string(""), "attachments": .array([.string("u2:0")]),
      "text": .string("Pick it up from the failing test"), "request_id": .string("q1"), "revision": .string("r1"),
    ]))
  }

  private func refusal(_ status: Int, _ body: String) async -> ContinueError? {
    let client = OmniClient(port: 4799, transport: StubTransport(status: status, body: body))
    do {
      _ = try await client.startContinue("t1", startBody)
      return nil
    } catch {
      return error
    }
  }

  @Test func readsTheThreeConflicts() async throws {
    let block = try decode(ContinueBlock.self, busyBlock)
    #expect(await refusal(409, #"{"error":"Not idle.","code":"busy","block":\#(busyBlock)}"#) == .busy(message: "Not idle.", block: block))
    let fresh = try preview(revision: "r2")
    #expect(
      await refusal(409, #"{"error":"It changed.","code":"changed","preview":\#(previewJSON(revision: "r2"))}"#)
        == .changed(message: "It changed.", preview: fresh))
    #expect(await refusal(409, #"{"error":"Used already.","code":"request_reused"}"#) == .requestReused(message: "Used already."))
  }

  @Test func leavesAnyOtherRefusalAsAnAPIError() async {
    #expect(await refusal(400, #"{"error":"Pick a local harness."}"#) == .api(.http(status: 400, message: "Pick a local harness.")))
    #expect(await refusal(409, #"{"error":"Archived."}"#) == .api(.http(status: 409, message: "Archived.")))
    #expect(await refusal(409, #"{"error":"Not idle.","code":"busy"}"#) == .api(.http(status: 409, message: "Not idle.")))
    let down = OmniClient(port: 4799, transport: StubTransport { _ in throw URLError(.cannotConnectToHost) })
    do {
      _ = try await down.startContinue("t1", startBody)
      Issue.record("started")
    } catch {
      guard case .api(.unreachable) = error else { Issue.record("not unreachable: \(error)"); return }
    }
  }
}

/// The continue endpoints, answering with what the test set. A held preview waits for its gate.
final class FakeContinueAPI: ContinueAPI {
  private struct State {
    var previews: [HarnessID: ContinuePreview] = [:]
    var holds: [HarnessID: Gate] = [:]
    var answers: [Result<ContinueStarted, ContinueError>] = []
    var starts: [ContinueBody] = []
    var asked: [[String]] = []
    var closeFails: OmniAPIError?
    var closes = 0
  }
  private let state = Mutex(State())

  init(_ previews: [HarnessID: ContinuePreview]) {
    state.withLock { $0.previews = previews }
  }

  var starts: [ContinueBody] { state.withLock { $0.starts } }
  /// The picks each preview was asked with, in order.
  var asked: [[String]] { state.withLock { $0.asked } }
  var closes: Int { state.withLock { $0.closes } }
  var closeFails: OmniAPIError? {
    get { state.withLock { $0.closeFails } }
    set { state.withLock { $0.closeFails = newValue } }
  }

  func set(_ preview: ContinuePreview, for harness: HarnessID) { state.withLock { $0.previews[harness] = preview } }

  /// The answers to the next starts, in order. A start with none left succeeds.
  func answer(_ results: Result<ContinueStarted, ContinueError>...) { state.withLock { $0.answers = results } }

  func hold(_ harness: HarnessID) -> Gate {
    let gate = Gate()
    state.withLock { $0.holds[harness] = gate }
    return gate
  }

  func continuePreview(_ id: String, run: Run, attachments: [String]) async throws(OmniAPIError) -> ContinuePreview {
    state.withLock { $0.asked.append(attachments) }
    let gate = state.withLock { $0.holds.removeValue(forKey: run.harness) }
    await gate?.wait()
    guard let p = state.withLock({ $0.previews[run.harness] }) else { throw .http(status: 400, message: "No preview") }
    return p
  }

  func closeTerminal(_ id: String) async throws(OmniAPIError) -> TerminalInfo {
    let fail = state.withLock { s in
      s.closes += 1
      return s.closeFails
    }
    if let fail { throw fail }
    return try! decode(TerminalInfo.self, #"{"open":false,"running":false}"#)
  }

  func startContinue(_ id: String, _ body: ContinueBody) async throws(ContinueError) -> ContinueStarted {
    let next = state.withLock { s in
      s.starts.append(body)
      return s.answers.isEmpty ? nil : s.answers.removeFirst()
    }
    if let next { return try next.get() }
    return try! decode(ContinueStarted.self, #"{"thread":\#(row("n1", harness: "codex", from: "t1")),"duplicate":false}"#)
  }
}

@MainActor @Suite struct ContinueModelTests {
  private let codex = Run(harness: .codex, model: "gpt-y", effort: "")

  private func loaded(_ api: FakeContinueAPI) async -> ContinueModel {
    let m = ContinueModel(api: api, sourceID: "t1")
    m.run = codex
    await m.loadPreview()
    return m
  }

  @Test func startsOnceThePickedRunsPreviewIsInAndAMessageIsWritten() async throws {
    let api = FakeContinueAPI([.codex: try preview()])
    let m = ContinueModel(api: api, sourceID: "t1")
    #expect(m.startBlocker == "No local harness is available")
    m.run = codex
    #expect(m.startBlocker == "Loading the preview")
    await m.loadPreview()
    #expect(m.preview?.revision == "r1")
    #expect(m.startBlocker == "Write the first message for the new thread")
    m.text = "Pick it up from the failing test"
    #expect(m.startBlocker == nil)
    let t = await m.start()
    #expect(t?.id == "n1")
    let body = try #require(api.starts.first)
    #expect(body.revision == "r1")
    #expect(body.harness == .codex && body.model == "gpt-y" && body.effort == "")
    #expect(body.text == "Pick it up from the failing test")
    #expect(!body.requestID.isEmpty)
  }

  @Test func dropsAPreviewThatComesBackForARunBenLeft() async throws {
    let api = FakeContinueAPI([.codex: try preview(), .claudeCode: try preview(to: "claude-code")])
    let m = ContinueModel(api: api, sourceID: "t1")
    let gate = api.hold(.codex)
    m.run = codex
    let first = Task { await m.loadPreview() }
    await settle()
    m.run = Run(harness: .claudeCode, model: "sonnet", effort: "")
    await m.loadPreview()
    gate.open()
    await first.value
    #expect(m.preview?.carryover.to.harness == "claude-code")
    #expect(!m.loading)
    m.text = "go"
    #expect(m.startBlocker == nil)
  }

  @Test func holdsStartOnAPreviewOfAnotherRun() async throws {
    let api = FakeContinueAPI([.codex: try preview()])
    let m = await loaded(api)
    m.text = "go"
    m.run = Run(harness: .claudeCode, model: "sonnet", effort: "")
    #expect(m.startBlocker == "Loading the preview")
    await m.loadPreview()
    #expect(m.loadError == .http(status: 400, message: "No preview"))
    #expect(m.startBlocker == "The preview did not load")
    #expect(await m.start() == nil)
    #expect(api.starts.isEmpty)
  }

  @Test func asksForANewPreviewWithEachTickAndSendsThePicks() async throws {
    let api = FakeContinueAPI([.codex: try preview()])
    let m = await loaded(api)
    #expect(m.picked.isEmpty)
    let before = m.ask
    m.toggle("u2:0")
    #expect(m.ask != before)
    #expect(m.startBlocker == "Loading the preview")
    await m.loadPreview()
    m.toggle("u2:1")
    m.toggle("u2:1")
    await m.loadPreview()
    #expect(api.asked == [[], ["u2:0"], ["u2:0"]])
    m.text = "go"
    #expect(m.startBlocker == nil)
    #expect(await m.start()?.id == "n1")
    #expect(api.starts.first?.attachments == ["u2:0"])
  }

  @Test func holdsStartOnAPreviewOfOtherPicksAndTakesANewRequestIDForThem() async throws {
    let api = FakeContinueAPI([.codex: try preview()])
    api.answer(.failure(.api(.unreachable("offline"))))
    let m = await loaded(api)
    m.text = "go"
    #expect(await m.start() == nil)
    m.toggle("u2:0")
    #expect(m.startBlocker == "Loading the preview")
    #expect(await m.start() == nil)
    await m.loadPreview()
    #expect(await m.start()?.id == "n1")
    let ids = api.starts.map(\.requestID)
    #expect(ids.count == 2)
    #expect(ids[0] != ids[1])
    #expect(api.starts.map(\.attachments) == [[], ["u2:0"]])
  }

  @Test func keepsTheRequestIDAcrossRetriesAndChangesItWithTheText() async throws {
    let api = FakeContinueAPI([.codex: try preview()])
    api.answer(.failure(.api(.unreachable("offline"))), .failure(.api(.unreachable("offline"))))
    let m = await loaded(api)
    m.text = "go"
    #expect(await m.start() == nil)
    #expect(m.error == OmniAPIError.unreachable("offline").message)
    #expect(await m.start() == nil)
    m.text = "go on"
    #expect(await m.start()?.id == "n1")
    #expect(m.error == nil)
    let ids = api.starts.map(\.requestID)
    #expect(ids.count == 3)
    #expect(ids[0] == ids[1])
    #expect(ids[2] != ids[0])
  }

  @Test func swapsInTheFreshPreviewWhenTheThreadChanged() async throws {
    let api = FakeContinueAPI([.codex: try preview()])
    let fresh = try preview(revision: "r2")
    api.answer(.failure(.changed(message: "It changed.", preview: fresh)))
    let m = await loaded(api)
    m.text = "go"
    #expect(await m.start() == nil)
    #expect(m.changed)
    #expect(m.preview == fresh)
    #expect(m.text == "go")
    #expect(m.startBlocker == nil)
    #expect(await m.start()?.id == "n1")
    let starts = api.starts
    #expect(starts.map(\.revision) == ["r1", "r2"])
    #expect(starts[0].requestID != starts[1].requestID)
  }

  @Test func holdsStartWhileTheSourceIsBusy() async throws {
    let block = try decode(ContinueBlock.self, busyBlock)
    let api = FakeContinueAPI([.codex: try preview(blocked: busyBlock)])
    let m = await loaded(api)
    m.text = "go"
    #expect(m.blocked == block)
    #expect(m.startBlocker == "A turn is running in it.")

    api.set(try preview(), for: .codex)
    await m.loadPreview()
    #expect(m.startBlocker == nil)
    api.answer(.failure(.busy(message: "Not idle.", block: block)))
    #expect(await m.start() == nil)
    #expect(m.blocked == block)
    #expect(m.startBlocker == "A turn is running in it.")
  }

  @Test func closesTheTerminalAShellBlocksOnAndChecksAgain() async throws {
    let terminal = #"{"code":"terminal","message":"Its Terminal tab has a shell open."}"#
    let api = FakeContinueAPI([.codex: try preview(blocked: terminal)])
    let m = await loaded(api)
    m.text = "go"
    #expect(m.blocked?.code == .terminal)

    api.closeFails = .http(status: 500, message: "boom")
    await m.closeTerminal()
    #expect(m.error == "boom")
    #expect(m.blocked?.code == .terminal)

    api.closeFails = nil
    api.set(try preview(), for: .codex)
    await m.closeTerminal()
    #expect(api.closes == 2)
    #expect(m.error == nil)
    #expect(m.blocked == nil)
    #expect(!m.closingTerminal)
    #expect(m.startBlocker == nil)
  }

  @Test func takesANewRequestIDAfterTheServerSaysOneWasReused() async throws {
    let api = FakeContinueAPI([.codex: try preview()])
    api.answer(.failure(.requestReused(message: "Used already.")))
    let m = await loaded(api)
    m.text = "go"
    #expect(await m.start() == nil)
    #expect(m.error == "Used already.")
    #expect(await m.start()?.id == "n1")
    let ids = api.starts.map(\.requestID)
    #expect(ids[0] != ids[1])
  }
}

@MainActor @Suite struct ContinueLinkFeedTests {
  @Test func followsTheLinkedThreadsOnTheFeed() async throws {
    let api = FakeThreadAPI(try continuedDetail())
    let t = ScriptedSSETransport(), clock = TestClock()
    let store = ThreadStore(id: "t1", api: api, clock: clock, frame: .zero) { after in
      OmniClient(port: 4799).threadEvents("t1", after: after, transport: t, clock: clock)
    }
    store.start()
    defer { store.stop() }
    try await waitFor("the load") { store.loadState == .loaded }
    #expect(store.continuedFrom?.title == "Cart, first try")
    #expect(store.continuedIn.map(\.id) == ["n1"])

    store.apply(feed: .thread(try decode(OmniThread.self, row("n2", title: "Cart on Codex", harness: "codex", from: "t1"))))
    store.apply(feed: .thread(try decode(OmniThread.self, row("n1", title: "Renamed", harness: "cursor", from: "t1"))))
    store.apply(feed: .thread(try decode(OmniThread.self, row("s0", title: "First try, renamed", harness: "codex"))))
    store.apply(feed: .thread(try decode(OmniThread.self, row("x", from: "other"))))
    #expect(store.continuedIn.map(\.id) == ["n1", "n2"])
    #expect(store.continuedIn.map(\.title) == ["Renamed", "Cart on Codex"])
    #expect(store.continuedIn.map(\.status) == [.running, .running])
    #expect(store.continuedFrom?.title == "First try, renamed")
    #expect(store.continuedFrom?.carried?.entries == 34)
  }
}
