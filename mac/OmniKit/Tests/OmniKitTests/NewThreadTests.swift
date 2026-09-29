import Foundation
import Testing
@testable import OmniKit

private let harnessesJSON = """
[
 {"id":"claude-code","name":"Claude Code","plan":"Claude plan","capabilities":{"warmProcess":true,"steer":true,"inlineImages":true,"usage":"five-hour-week"},
  "available":true,"cap":4,"running":0,"models":[
   {"id":"opus","label":"Opus","efforts":["low","high"],"defaultEffort":"high"},
   {"id":"sonnet","label":"Sonnet","default":true,"efforts":["low","medium","high"],"defaultEffort":"medium"},
   {"id":"haiku","label":"Haiku","efforts":[]}]},
 {"id":"codex","name":"Codex","plan":"ChatGPT plan","capabilities":{"warmProcess":false,"steer":false,"inlineImages":false,"usage":"none"},
  "available":true,"cap":4,"running":0,"models":[
   {"id":"gpt-x","label":"GPT X","efforts":["minimal","high"],"defaultEffort":"minimal"},
   {"id":"gpt-y","label":"GPT Y","default":true,"efforts":["high"]}]},
 {"id":"cursor","name":"Cursor","plan":"Cursor plan","capabilities":{"warmProcess":false,"steer":false,"inlineImages":false,"usage":"none"},
  "available":false,"fix":"cursor-agent login","cap":4,"running":0,"models":[]}
]
"""

private func harnesses() -> [HarnessInfo] {
  try! OmniJSON.decoder().decode([HarnessInfo].self, from: Data(harnessesJSON.utf8))
}

private func crew(_ extra: String = "") -> [CrewRole] {
  let json = """
  [{"id":"conductor","name":"Conductor","description":"","model":"opus","channel":"conductor"},
   {"id":"builder","name":"Builder","description":"","harness":"codex","model":"gpt-x","effort":"high","channel":"acme"},
   {"id":"plain","name":"Plain","description":""},
   {"id":"ghost","name":"Ghost","description":"","harness":"nope","effort":"low"}\(extra)]
  """
  return try! OmniJSON.decoder().decode([CrewRole].self, from: Data(json.utf8))
}

private let channels: Set<String> = ["conductor", "acme", "inbox"]

@Suite struct NewThreadRulesTests {
  @Test func startsOnClaudeCodeWithTheConductorRoleInTheConductorChannel() {
    var c = NewThreadRules.initial(fixedChannel: nil)
    #expect(c == NewThreadChoice(channel: "conductor", role: "conductor", harness: .claudeCode, model: "", effort: ""))
    c = NewThreadRules.settled(c, crew: crew(), harnesses: harnesses())
    #expect(c.role == "conductor")
    #expect(c.model == "sonnet")
    let fixed = NewThreadRules.settled(NewThreadRules.initial(fixedChannel: "acme"), crew: crew(), harnesses: harnesses())
    #expect(fixed.channel == "acme" && fixed.role == "")
  }

  @Test func pickingARolePresetsChannelHarnessModelAndEffort() {
    var c = NewThreadRules.settled(NewThreadRules.initial(fixedChannel: nil), crew: crew(), harnesses: harnesses())
    c = NewThreadRules.selectingRole("builder", from: c, crew: crew(), channels: channels, harnesses: harnesses(), channelFixed: false)
    #expect(c == NewThreadChoice(channel: "acme", role: "builder", harness: .codex, model: "gpt-x", effort: "high"))
  }

  @Test func aRoleWithoutSettingsUsesClaudeCodesDefaultAndAFixedChannelStays() {
    let start = NewThreadChoice(channel: "acme", role: "", harness: .codex, model: "gpt-x", effort: "high")
    let c = NewThreadRules.selectingRole("plain", from: start, crew: crew(), channels: channels, harnesses: harnesses(), channelFixed: true)
    #expect(c == NewThreadChoice(channel: "acme", role: "plain", harness: .claudeCode, model: "sonnet", effort: ""))
    let onAcme = NewThreadRules.selectingRole("builder", from: start, crew: crew(), channels: channels, harnesses: harnesses(), channelFixed: true)
    #expect(onAcme.channel == "acme")
  }

  @Test func aRoleNamingAnUnknownHarnessFallsBackToClaudeCode() {
    let c = NewThreadRules.selectingRole(
      "ghost", from: NewThreadRules.initial(fixedChannel: nil), crew: crew(), channels: channels, harnesses: harnesses(), channelFixed: false)
    #expect(c.harness == .claudeCode && c.model == "sonnet" && c.effort == "low")
  }

  @Test func noRoleKeepsTheRestAndAChoiceAfterARoleWins() {
    var c = NewThreadRules.selectingRole(
      "builder", from: NewThreadRules.initial(fixedChannel: nil), crew: crew(), channels: channels, harnesses: harnesses(), channelFixed: false)
    let none = NewThreadRules.selectingRole("", from: c, crew: crew(), channels: channels, harnesses: harnesses(), channelFixed: false)
    #expect(none.role == "" && none.harness == .codex && none.model == "gpt-x" && none.effort == "high")
    c = NewThreadRules.selectingModel(harness: .claudeCode, model: "opus", from: c)
    c.effort = "low"
    #expect(c.role == "builder" && c.channel == "acme" && c.harness == .claudeCode && c.model == "opus" && c.effort == "low")
  }

  @Test func theConductorChannelAndRoleGoTogether() {
    var c = NewThreadChoice(channel: "acme", role: "conductor", harness: .claudeCode, model: "opus", effort: "")
    c = NewThreadRules.selectingChannel("inbox", from: c, crew: crew())
    #expect(c.channel == "inbox" && c.role == "")
    c = NewThreadRules.selectingChannel("conductor", from: c, crew: crew())
    #expect(c.role == "conductor")
    c.role = "builder"
    #expect(NewThreadRules.selectingChannel("conductor", from: c, crew: crew()).role == "builder")
  }

  @Test func changingTheModelResetsEffort() {
    let c = NewThreadChoice(channel: "acme", role: "", harness: .claudeCode, model: "opus", effort: "high")
    #expect(NewThreadRules.selectingModel(harness: .codex, model: "gpt-y", from: c).effort == "")
  }
}

@Suite struct EffortRulesTests {
  @Test func offersDefaultThenTheModelsLevels() {
    let sonnet = harnesses()[0].models[1]
    let options = EffortRules.options(for: sonnet)
    #expect(options.map(\.value) == ["", "low", "medium", "high"])
    #expect(options.map(\.label) == ["Default (medium)", "low", "medium", "high"])
    #expect(EffortRules.options(for: harnesses()[1].models[1]).first?.label == "Default")
  }

  @Test func aModelWithoutLevelsHasNoPicker() {
    #expect(EffortRules.options(for: harnesses()[0].models[2]).isEmpty)
    #expect(EffortRules.options(for: nil).isEmpty)
  }

  @Test func anUnsupportedLevelFallsBackToDefault() {
    let opus = harnesses()[0].models[0]
    #expect(EffortRules.resolved("high", for: opus) == "high")
    #expect(EffortRules.resolved("medium", for: opus) == "")
    #expect(EffortRules.resolved("high", for: harnesses()[0].models[2]) == "")
  }
}

@Suite struct ThreadRunLabelsTests {
  @Test func namesTheChosenModelAndEffort() {
    let labels = ThreadRunLabels.make(harness: .claudeCode, model: "opus", effort: "high", harnesses: harnesses())
    #expect(labels == ThreadRunLabels(model: "Opus", harnessName: "Claude Code", effort: "high"))
  }

  @Test func namesAnEmptyEffortAsTheModelDefault() {
    #expect(ThreadRunLabels.make(harness: .claudeCode, model: "opus", effort: nil, harnesses: harnesses()).effort == "Default (high)")
    #expect(ThreadRunLabels.make(harness: .claudeCode, model: "haiku", effort: nil, harnesses: harnesses()).effort == "Auto effort")
  }

  @Test func namesAnEmptyModelAsTheHarnessDefault() {
    let labels = ThreadRunLabels.make(harness: .claudeCode, model: nil, effort: nil, harnesses: harnesses())
    #expect(labels.model == "Sonnet")
    #expect(labels.effort == "Default (medium)")
  }

  @Test func keepsTheStoredIdWhenTheCatalogHasNotArrived() {
    let labels = ThreadRunLabels.make(harness: .claudeCode, model: "opus", effort: "high", harnesses: [])
    #expect(labels == ThreadRunLabels(model: "opus", harnessName: "Claude Code", effort: "high"))
    let empty = ThreadRunLabels.make(harness: .codex, model: nil, effort: nil, harnesses: [])
    #expect(empty == ThreadRunLabels(model: "default", harnessName: "Codex", effort: "default"))
  }
}

@Suite struct ModelSearchTests {
  @Test func filtersAcrossGroupsByLabelIdHarnessAndPlan() {
    let all = harnesses()
    #expect(ModelSearch.groups(all, query: "").map(\.models.count) == [3, 2, 0])
    #expect(ModelSearch.groups(all, query: "  GPT ").map(\.models.count) == [0, 2, 0])
    #expect(ModelSearch.groups(all, query: "claude plan").map(\.models.count) == [3, 0, 0])
    #expect(ModelSearch.groups(all, query: "codex").map(\.models.count) == [0, 2, 0])
    #expect(ModelSearch.groups(all, query: "zzz").allSatisfy { $0.models.isEmpty })
  }
}

@Suite struct NewThreadRequestTests {
  @Test func bodyOmitsWhatIsDefault() {
    let c = NewThreadChoice(channel: "acme", role: "", harness: .claudeCode, model: "", effort: "")
    #expect(NewThreadRules.request(c, prompt: "Fix it", harnesses: harnesses()) == NewThread(channel: "acme", prompt: "Fix it", harness: .claudeCode))
    let full = NewThreadChoice(channel: "acme", role: "builder", harness: .codex, model: "gpt-x", effort: "high")
    #expect(
      NewThreadRules.request(full, prompt: "Fix it", harnesses: harnesses())
        == NewThread(channel: "acme", prompt: "Fix it", role: "builder", model: "gpt-x", harness: .codex, effort: "high"))
    let stale = NewThreadChoice(channel: "acme", role: "", harness: .claudeCode, model: "haiku", effort: "high")
    #expect(NewThreadRules.request(stale, prompt: "x", harnesses: harnesses()).effort == nil)
  }

  @Test func postsTheRecordedContractAsJSONOrMultipart() async throws {
    let t = StubTransport(body: try fixture("thread-created.json"))
    let client = OmniClient(port: 4799, transport: t)
    let new = NewThread(channel: "acme", prompt: "Fix", role: "builder", model: "gpt-x", harness: .codex, effort: "high")
    let created = try await client.createThread(new, files: [])
    #expect(!created.id.isEmpty)
    _ = try await client.createThread(new, files: [UploadFile(name: "a.png", mime: "image/png", data: Data("PNG".utf8))])
    let r = t.requests
    #expect(r.map { $0.url!.path() } == ["/api/threads", "/api/threads"])
    #expect(r[0].value(forHTTPHeaderField: "Content-Type") == "application/json")
    let expected: JSONValue = .object([
      "channel": .string("acme"), "prompt": .string("Fix"), "role": .string("builder"), "model": .string("gpt-x"),
      "harness": .string("codex"), "effort": .string("high"),
    ])
    #expect(try bodyJSON(r[0]) == expected)
    let body = String(decoding: try #require(r[1].httpBody), as: UTF8.self)
    #expect(r[1].value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data; boundary=") == true)
    #expect(body.contains(#"name="payload""#) && body.contains(#""role":"builder""#))
    #expect(body.contains(#"name="files"; filename="a.png""#))
  }
}

@MainActor
private final class FakeNewThreadAPI: NewThreadAPI {
  var failWith: OmniAPIError?
  var sent: [(NewThread, [String])] = []
  nonisolated func createThread(_ new: NewThread, files: [UploadFile]) async throws(OmniAPIError) -> OmniThread {
    let names = files.map(\.name)
    let fail = await MainActor.run { () -> OmniAPIError? in
      self.sent.append((new, names))
      return self.failWith
    }
    if let fail { throw fail }
    return try! OmniJSON.decoder().decode(OmniThread.self, from: Data(threadJSON(status: "running").utf8))
  }
}

@MainActor
@Suite struct NewThreadComposerModelTests {
  private func make(_ api: FakeNewThreadAPI, _ dir: TempDir, channel: String? = nil) -> NewThreadComposerModel {
    let m = NewThreadComposerModel(
      fixedChannel: channel, api: api, drafts: DraftStore(directory: dir.url),
      readFile: { UploadFile(name: $0.name, mime: "text/plain", data: Data("x".utf8)) })
    m.update(crew: crew(), channels: channels, harnesses: harnesses())
    return m
  }

  @Test func sendsTheChoiceClearsTheDraftAndReturnsTheThread() async {
    let dir = TempDir("drafts")
    let api = FakeNewThreadAPI()
    let m = make(api, dir)
    DraftStore(directory: dir.url).save("old", for: "new:*")
    m.text = "Do the thing"
    m.addFiles([StagedFile(url: URL(filePath: "/tmp/a.txt"), name: "a.txt", size: 3)])
    m.selectRole("builder")
    let t = await m.send()
    #expect(t != nil)
    #expect(api.sent.first?.0 == NewThread(channel: "acme", prompt: "Do the thing", role: "builder", model: "gpt-x", harness: .codex, effort: "high"))
    #expect(api.sent.first?.1 == ["a.txt"])
    #expect(m.text == "" && m.files.isEmpty)
    #expect(DraftStore(directory: dir.url).text(for: "new:*") == "")
  }

  @Test func aFailedSendKeepsTheDraft() async {
    let dir = TempDir("drafts")
    let api = FakeNewThreadAPI()
    api.failWith = .http(status: 400, message: "bad role")
    let m = make(api, dir, channel: "acme")
    m.text = "hi"
    #expect(await m.send() == nil)
    #expect(m.sendError == "bad role")
    #expect(DraftStore(directory: dir.url).text(for: "new:acme") == "hi")
  }

  @Test func restoresTheDraftPerChannelKey() {
    let dir = TempDir("drafts")
    DraftStore(directory: dir.url).save("in acme", for: "new:acme")
    #expect(make(FakeNewThreadAPI(), dir, channel: "acme").text == "in acme")
    #expect(make(FakeNewThreadAPI(), dir).text == "")
  }
}
