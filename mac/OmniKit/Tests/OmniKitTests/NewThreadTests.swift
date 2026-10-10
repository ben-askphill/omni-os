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

  @Test func noRoleGoesBackToTheChannelsRunAndAChoiceAfterARoleWins() {
    var c = NewThreadRules.selectingRole(
      "builder", from: NewThreadRules.initial(fixedChannel: nil), crew: crew(), channels: channels, harnesses: harnesses(), channelFixed: false)
    let none = NewThreadRules.selectingRole("", from: c, crew: crew(), channels: channels, harnesses: harnesses(), channelFixed: false)
    #expect(none == NewThreadChoice(channel: "acme", role: "", harness: .claudeCode, model: "sonnet", effort: ""))
    let acme = ["acme": RunDefaults(harness: .codex, effort: "high")]
    let back = NewThreadRules.selectingRole(
      "", from: c, crew: crew(), channels: channels, harnesses: harnesses(), channelFixed: false, defaults: acme)
    #expect(back == NewThreadChoice(channel: "acme", role: "", harness: .codex, model: "gpt-y", effort: "high"))
    c = NewThreadRules.selectingModel(harness: .claudeCode, model: "opus", from: c)
    c.effort = "low"
    #expect(c.role == "builder" && c.channel == "acme" && c.harness == .claudeCode && c.model == "opus" && c.effort == "low")
  }

  @Test func theConductorChannelAndRoleGoTogether() {
    var c = NewThreadChoice(channel: "acme", role: "conductor", harness: .claudeCode, model: "opus", effort: "")
    c = NewThreadRules.selectingChannel("inbox", from: c, crew: crew(), harnesses: harnesses(), defaults: [:])
    #expect(c.channel == "inbox" && c.role == "")
    c = NewThreadRules.selectingChannel("conductor", from: c, crew: crew(), harnesses: harnesses(), defaults: [:])
    #expect(c.role == "conductor")
    c.role = "builder"
    #expect(NewThreadRules.selectingChannel("conductor", from: c, crew: crew(), harnesses: harnesses(), defaults: [:]).role == "builder")
  }

  @Test func preselectsTheChannelsRunWhenTheRoleSetsNone() {
    let d: [String: RunDefaults] = [
      "acme": RunDefaults(harness: .codex, model: "gpt-x", effort: "minimal"),
      "inbox": RunDefaults(harness: .codex),
      "solo": RunDefaults(effort: "low"),
      "gone": RunDefaults(harness: "nope", model: "x", effort: "high"),
    ]
    func pre(_ channel: String, role: String = "") -> NewThreadChoice {
      NewThreadRules.preselecting(
        NewThreadChoice(channel: channel, role: role, harness: .claudeCode, model: "opus", effort: "high"),
        crew: crew(), harnesses: harnesses(), defaults: d)
    }
    #expect(pre("acme") == NewThreadChoice(channel: "acme", role: "", harness: .codex, model: "gpt-x", effort: "minimal"))
    // Only a harness: its default model.
    #expect(pre("inbox").harness == .codex && pre("inbox").model == "gpt-y" && pre("inbox").effort == "")
    // Only an effort: Claude Code's default model at that effort.
    #expect(pre("solo") == NewThreadChoice(channel: "solo", role: "", harness: .claudeCode, model: "sonnet", effort: "low"))
    // Nothing set: Claude Code's default.
    #expect(pre("other") == NewThreadChoice(channel: "other", role: "", harness: .claudeCode, model: "sonnet", effort: ""))
    // A harness the catalog lacks: Claude Code on its default model, not the stale model id.
    #expect(pre("gone").harness == .claudeCode && pre("gone").model == "sonnet")
    // A role without run defaults leaves the channel's; one with any replaces them whole.
    #expect(pre("acme", role: "plain").model == "gpt-x")
    #expect(pre("acme", role: "builder") == NewThreadChoice(channel: "acme", role: "builder", harness: .codex, model: "gpt-x", effort: "high"))
    #expect(pre("inbox", role: "conductor") == NewThreadChoice(channel: "inbox", role: "conductor", harness: .claudeCode, model: "opus", effort: ""))
  }

  @Test func changingChannelPreselectsItsRunUnlessTheRoleSetsOne() {
    let d = ["acme": RunDefaults(harness: .codex, model: "gpt-x")]
    let start = NewThreadChoice(channel: "inbox", role: "", harness: .claudeCode, model: "opus", effort: "high")
    let c = NewThreadRules.selectingChannel("acme", from: start, crew: crew(), harnesses: harnesses(), defaults: d)
    #expect(c == NewThreadChoice(channel: "acme", role: "", harness: .codex, model: "gpt-x", effort: ""))
    let ghost = NewThreadChoice(channel: "inbox", role: "ghost", harness: .claudeCode, model: "opus", effort: "low")
    #expect(NewThreadRules.selectingChannel("acme", from: ghost, crew: crew(), harnesses: harnesses(), defaults: d).harness == .claudeCode)
  }

  @Test func runDefaultsCountWhenAnyFieldIsSet() {
    #expect(!RunDefaults().setsRun)
    #expect(!RunDefaults(model: "", effort: "").setsRun)
    #expect(RunDefaults(effort: "low").setsRun)
    #expect(crew()[1].runDefaults.setsRun && !crew()[2].runDefaults.setsRun)
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

  @Test func opensOnTheChannelsRunAndKeepsAPickOrPreset() {
    let dir = TempDir("drafts")
    let d = ["acme": RunDefaults(harness: .codex, effort: "high"), "inbox": RunDefaults(model: "opus")]
    let m = NewThreadComposerModel(fixedChannel: "acme", api: FakeNewThreadAPI(), drafts: DraftStore(directory: dir.url))
    // The catalog arrives after the defaults: the harness's default model fills in then.
    m.update(crew: crew(), channels: channels, harnesses: [], defaults: d)
    #expect(m.choice.harness == .claudeCode && m.choice.effort == "high")
    m.update(crew: crew(), channels: channels, harnesses: harnesses(), defaults: d)
    #expect(m.choice == NewThreadChoice(channel: "acme", role: "", harness: .codex, model: "gpt-y", effort: "high"))
    m.selectRole("builder")
    #expect(m.choice.model == "gpt-x")
    m.selectRole("plain")
    #expect(m.choice.harness == .codex && m.choice.model == "gpt-y" && m.choice.effort == "high")
    // A pick survives the lists reloading.
    m.selectModel(harness: .claudeCode, model: "haiku")
    m.update(crew: crew(), channels: channels, harnesses: harnesses(), defaults: d)
    #expect(m.choice.model == "haiku")

    let home = NewThreadComposerModel(fixedChannel: nil, api: FakeNewThreadAPI(), drafts: DraftStore(directory: dir.url))
    home.update(crew: crew(), channels: channels, harnesses: harnesses(), defaults: d)
    home.selectChannel("inbox")
    #expect(home.choice.channel == "inbox" && home.choice.role == "" && home.choice.model == "opus")
    home.apply(NewThreadPreset(channel: "inbox", role: "", harness: .codex, model: "gpt-x"))
    home.update(crew: crew(), channels: channels, harnesses: harnesses(), defaults: d)
    #expect(home.choice.harness == .codex && home.choice.model == "gpt-x")
  }

  @Test func restoresTheDraftPerChannelKey() {
    let dir = TempDir("drafts")
    DraftStore(directory: dir.url).save("in acme", for: "new:acme")
    #expect(make(FakeNewThreadAPI(), dir, channel: "acme").text == "in acme")
    #expect(make(FakeNewThreadAPI(), dir).text == "")
  }

  @Test func newThreadHereFilesTheThreadAndKeepsTheChannelsRun() async {
    let dir = TempDir("drafts")
    let api = FakeNewThreadAPI()
    let m = make(api, dir, channel: "acme")
    m.selectModel(harness: .codex, model: "gpt-x")
    let before = m.choice
    let f = FolderWithThreads(Folder(id: "f1", channelID: "acme", name: "Launch"))
    m.apply(.inFolder(f))
    #expect(m.choice == before)
    #expect(m.folderChip == FolderRef(id: "f1", name: "Launch"))
    m.text = "go"
    _ = await m.send()
    #expect(api.sent.last?.0.folder == "f1")
    // Sent once: the next thread starts ungrouped.
    #expect(m.folderChip == nil)
    m.apply(.inFolder(f))
    m.clearFolder()
    m.text = "again"
    _ = await m.send()
    #expect(api.sent.last?.0.folder == nil)
  }

  @Test func theFolderGoesInTheRequestBody() throws {
    let json = try OmniJSON.encoder().encode(NewThread(channel: "acme", prompt: "hi", folder: "f1"))
    let v = try JSONDecoder().decode(JSONValue.self, from: json)
    #expect(v == .object(["channel": .string("acme"), "prompt": .string("hi"), "folder": .string("f1")]))
  }
}
