import Foundation
import Testing
@testable import OmniKit

// The Base picker's types and rules (packages/shared/worktree-base.ts, apps/server/worktree-base.ts), on JSON in the
// shapes the three endpoints send.

private let unavailableJSON = #"{"available":false,"reason":"This channel does not start threads in worktrees of a repository."}"#

private func availableJSON(remote: String = #"{"remote":"origin","branch":"main","sha":"9999999999999999999999999999999999999999"}"#) -> String {
  """
  {"available":true,"head":{"ref":"feature/cart","sha":"a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"},
   "refs":[
    {"ref":"feature/cart","kind":"branch","sha":"a1b2c3d4e5f60718293a4b5c6d7e8f9012345678","current":true},
    {"ref":"main","kind":"branch","sha":"bbbbbbb4e5f60718293a4b5c6d7e8f9012345678","current":false},
    {"ref":"v3.0","kind":"tag","sha":"ccccccc4e5f60718293a4b5c6d7e8f9012345678","current":false}],
   "remote":\(remote)}
  """
}

private func options(_ json: String) throws -> BaseOptions { try decode(BaseOptions.self, json) }

@Suite struct BasePickTests {
  @Test func decodesTheThreeShapes() throws {
    #expect(try decode(BasePick.self, #"{"kind":"head"}"#) == .head)
    #expect(try decode(BasePick.self, #"{"kind":"remote-default"}"#) == .remoteDefault)
    #expect(try decode(BasePick.self, #"{"kind":"ref","ref":"release/1.2"}"#) == .ref("release/1.2"))
  }

  @Test func encodesTheShapesTheServerTakes() throws {
    func json(_ p: BasePick) throws -> JSONValue {
      try JSONDecoder().decode(JSONValue.self, from: try OmniJSON.encoder().encode(p))
    }
    #expect(try json(.head) == .object(["kind": .string("head")]))
    #expect(try json(.remoteDefault) == .object(["kind": .string("remote-default")]))
    #expect(try json(.ref("v3.0")) == .object(["kind": .string("ref"), "ref": .string("v3.0")]))
  }

  @Test func refusesAPickItDoesNotKnow() {
    #expect(throws: DecodingError.self) { try decode(BasePick.self, #"{"kind":"merge-base"}"#) }
    #expect(throws: DecodingError.self) { try decode(BasePick.self, #"{"kind":"ref"}"#) }
  }

  @Test func labelsAPickBeforeItHasACommit() {
    #expect(BasePick.head.label == "the repo's current commit")
    #expect(BasePick.remoteDefault.label == "origin's default branch")
    #expect(BasePick.ref("v3.0").label == "v3.0")
  }
}

@Suite struct BaseOptionsTests {
  @Test func decodesAChannelWithoutWorktrees() throws {
    let o = try options(unavailableJSON)
    #expect(!o.available && o.reason?.contains("does not start threads") == true)
    #expect(o.head == nil && o.refs.isEmpty && o.remote == nil)
    #expect(BaseRules.choices(o).isEmpty)
  }

  @Test func decodesTheRepoAndItsOrigin() throws {
    let o = try options(availableJSON())
    #expect(o.available && o.reason == nil)
    #expect(o.head == BaseHead(ref: "feature/cart", sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"))
    #expect(o.refs.map(\.ref) == ["feature/cart", "main", "v3.0"])
    #expect(o.refs.map(\.kind) == [.branch, .branch, .tag])
    #expect(o.refs.map(\.current) == [true, false, false])
    #expect(o.remote?.branch == "main")
  }

  @Test func decodesARepoWithNoOriginOrNoFetchedBranch() throws {
    #expect(try options(availableJSON(remote: "null")).remote == nil)
    let never = try options(availableJSON(remote: #"{"remote":"origin","branch":null,"sha":null}"#))
    #expect(never.remote == BaseRemote(remote: "origin", branch: nil, sha: nil))
  }

  @Test func anAvailableAnswerNeedsItsHead() {
    #expect(throws: DecodingError.self) { try options(#"{"available":true,"refs":[],"remote":null}"#) }
  }
}

@Suite struct BaseRulesTests {
  @Test func listsTheCheckoutThenOriginThenBranchesAndTags() throws {
    let rows = BaseRules.choices(try options(availableJSON()))
    #expect(rows.map(\.title) == [
      "Current checkout: feature/cart (a1b2c3d)", "Remote default: origin/main", "main (bbbbbbb)", "v3.0 (ccccccc)",
    ])
    #expect(rows.map(\.pick) == [.head, .remoteDefault, .ref("main"), .ref("v3.0")])
    #expect(rows.map(\.group) == [.current, .remote, .branch, .tag])
  }

  @Test func namesOriginsDefaultBranchWhenItWasNeverFetchedAndLeavesItOutWithoutAnOrigin() throws {
    let never = try options(availableJSON(remote: #"{"remote":"origin","branch":null,"sha":null}"#))
    #expect(BaseRules.choices(never)[1].title == "Remote default: origin's default branch")
    let none = BaseRules.choices(try options(availableJSON(remote: "null")))
    #expect(none.map(\.group) == [.current, .branch, .tag])
  }

  @Test func readsTheDefaultOnThePill() throws {
    let o = try options(availableJSON())
    let head = BaseRules.summary(.head, in: o)
    #expect(head.title == "From feature/cart" && head.sha == "a1b2c3d")
    let remote = BaseRules.summary(.remoteDefault, in: o)
    #expect(remote.title == "From origin/main" && remote.sha == "9999999")
    let tag = BaseRules.summary(.ref("v3.0"), in: o)
    #expect(tag.title == "From v3.0" && tag.sha == "ccccccc")
    // A ref the list does not hold (it is only 60 long) has no commit to show.
    let other = BaseRules.summary(.ref("old/branch"), in: o)
    #expect(other.title == "From old/branch" && other.sha == nil)
  }

  @Test func readsAnUnfetchedRemoteAsWords() throws {
    let o = try options(availableJSON(remote: #"{"remote":"origin","branch":null,"sha":null}"#))
    let s = BaseRules.summary(.remoteDefault, in: o)
    #expect(s.title == "From origin's default branch" && s.sha == nil)
  }

  @Test func offersThePickerOnlyForALocalWorktree() throws {
    let o = try options(availableJSON())
    #expect(BaseRules.isOffered(o, harness: .claudeCode))
    #expect(BaseRules.isOffered(o, harness: .codex))
    #expect(!BaseRules.isOffered(o, harness: .hermes))
    #expect(!BaseRules.isOffered(o, harness: .cursorCloud))
    #expect(!BaseRules.isOffered(try options(unavailableJSON), harness: .claudeCode))
    #expect(!BaseRules.isOffered(nil, harness: .claudeCode))
  }

  @Test func sendsABaseOnlyWhenItIsNotTheDefault() {
    #expect(BaseRules.sent(.head, harness: .claudeCode) == nil)
    #expect(BaseRules.sent(.remoteDefault, harness: .claudeCode) == .remoteDefault)
    #expect(BaseRules.sent(.ref("main"), harness: .codex) == .ref("main"))
    #expect(BaseRules.sent(.ref("main"), harness: .hermes) == nil)
  }

  @Test func shortensACommit() {
    #expect(BaseRules.short("a1b2c3d4e5f6") == "a1b2c3d")
    #expect(BaseRules.short("abc") == "abc")
  }
}

@Suite struct ThreadBaseViewTests {
  @Test func saysWhereAResolvedThreadBranches() throws {
    let v = try decode(ThreadBaseView.self, #"{"pick":{"kind":"remote-default"},"sha":"a1b2c3d4e5f60718","ref":"origin/main"}"#)
    #expect(v.pick == .remoteDefault && v.ref == "origin/main")
    #expect(v.line == "Branching from origin/main @ a1b2c3d")
    let head = try decode(ThreadBaseView.self, #"{"pick":{"kind":"head"},"sha":"a1b2c3d4e5f60718","ref":"main"}"#)
    #expect(head.line == "Branching from main @ a1b2c3d")
  }

  @Test func saysTheWishBeforeItIsResolved() throws {
    let remote = try decode(ThreadBaseView.self, #"{"pick":{"kind":"remote-default"},"sha":null,"ref":null}"#)
    #expect(remote.line == "Branching from origin's default branch")
    let ref = try decode(ThreadBaseView.self, #"{"pick":{"kind":"ref","ref":"release/1.2"},"sha":null,"ref":null}"#)
    #expect(ref.line == "Branching from release/1.2")
    let head = try decode(ThreadBaseView.self, #"{"pick":{"kind":"head"},"sha":null,"ref":null}"#)
    #expect(head.line == "Branching from the repo's current commit")
  }
}

@Suite struct WorktreeBaseFixtureTests {
  @Test func readsTheRecordedOptions() throws {
    let o = try decodeFixture(BaseOptions.self, "bases.json")
    #expect(BaseRules.choices(o).map(\.title) == [
      "Current checkout: main (ccccccc)", "Remote default: origin/main", "omni/00000000 (ccccccc)",
    ])
    let s = BaseRules.summary(.head, in: o)
    #expect("\(s.title) · \(s.sha ?? "")" == "From main · ccccccc")
  }

  @Test func readsTheRecordedThreadBase() throws {
    let v = try decodeFixture(ThreadBaseView.self, "thread-base.json")
    #expect(v.pick == .head && v.line == "Branching from main @ ccccccc")
  }

  @Test func encodesTheRecordedCreateRequest() throws {
    let new = NewThread(channel: "acme", prompt: "TOOL:20 tidy the cart", title: "Tidy the cart", base: .ref("main"))
    let sent = try JSONDecoder().decode(JSONValue.self, from: try OmniJSON.encoder().encode(new))
    #expect(sent == (try decodeFixture(JSONValue.self, "thread-create-base-request.json")))
  }
}

@Suite struct WorktreeBaseClientTests {
  @Test func getsAChannelsOptions() async throws {
    let t = StubTransport(body: availableJSON())
    let o = try await OmniClient(port: 4799, transport: t).channelBases("a b")
    #expect(o.available && o.refs.count == 3)
    #expect(t.requests.first?.url?.absoluteString == "http://127.0.0.1:4799/api/channels/a%20b/bases")
  }

  @Test func getsAThreadsBaseAndNullForAThreadWithoutAWorktree() async throws {
    let some = StubTransport(body: #"{"pick":{"kind":"head"},"sha":null,"ref":null}"#)
    let view = try await OmniClient(port: 4799, transport: some).threadBase("t1")
    #expect(view?.pick == .head)
    #expect(some.requests.first?.url?.absoluteString == "http://127.0.0.1:4799/api/threads/t1/base")
    let none = StubTransport(body: "null")
    #expect(try await OmniClient(port: 4799, transport: none).threadBase("t1") == nil)
  }

  @Test func sendsABaseWithANewThreadAndNoneWithout() async throws {
    let t = StubTransport(body: threadJSON(status: "running"))
    let client = OmniClient(port: 4799, transport: t)
    _ = try await client.createThread(NewThread(channel: "acme", prompt: "hi", base: .ref("release/1.2")))
    _ = try await client.createThread(NewThread(channel: "acme", prompt: "hi"))
    #expect(try bodyJSON(t.requests[0]) == .object([
      "channel": .string("acme"), "prompt": .string("hi"),
      "base": .object(["kind": .string("ref"), "ref": .string("release/1.2")]),
    ]))
    #expect(try bodyJSON(t.requests[1]) == .object(["channel": .string("acme"), "prompt": .string("hi")]))
  }
}

@MainActor
private final class FakeBasesAPI: BasesAPI {
  var answers: [String: Result<BaseOptions, OmniAPIError>] = [:]
  var gates: [String: Gate] = [:]

  nonisolated func channelBases(_ id: String) async throws(OmniAPIError) -> BaseOptions {
    let (gate, answer) = await MainActor.run { (self.gates[id], self.answers[id]) }
    await gate?.wait()
    switch answer {
    case .success(let o)?: return o
    case .failure(let e)?: throw e
    case nil: throw .http(status: 404, message: "no such channel")
    }
  }
}

@MainActor
@Suite struct BaseOptionsModelTests {
  @Test func loadsAChannelsOptionsAndDropsThemWhenTheChannelChanges() async throws {
    let api = FakeBasesAPI()
    api.answers["acme"] = .success(try options(availableJSON()))
    let m = BaseOptionsModel()
    await m.load(channel: "acme", api: api)
    #expect(m.options?.available == true)
    // A channel the server does not know leaves no options to show.
    await m.load(channel: "inbox", api: api)
    #expect(m.options == nil && m.channel == "inbox")
  }

  @Test func aFailedReloadKeepsTheOptionsOfTheSameChannel() async throws {
    let api = FakeBasesAPI()
    api.answers["acme"] = .success(try options(availableJSON()))
    let m = BaseOptionsModel()
    await m.load(channel: "acme", api: api)
    api.answers["acme"] = .failure(.unreachable("down"))
    await m.load(channel: "acme", api: api)
    #expect(m.options?.available == true)
  }

  @Test func theLatestAskWins() async throws {
    let api = FakeBasesAPI()
    api.answers["acme"] = .success(try options(availableJSON()))
    api.answers["inbox"] = .success(try options(unavailableJSON))
    let gate = Gate()
    api.gates["acme"] = gate
    let m = BaseOptionsModel()
    let slow = Task { await m.load(channel: "acme", api: api) }
    await settle()
    await m.load(channel: "inbox", api: api)
    gate.open()
    await slow.value
    #expect(m.channel == "inbox" && m.options?.available == false)
  }
}

@MainActor
private final class FakeNewThreadAPI: NewThreadAPI {
  var failWith: OmniAPIError?
  var sent: [NewThread] = []
  nonisolated func createThread(_ new: NewThread, files: [UploadFile]) async throws(OmniAPIError) -> OmniThread {
    let fail = await MainActor.run { () -> OmniAPIError? in
      self.sent.append(new)
      return self.failWith
    }
    if let fail { throw fail }
    return try! OmniJSON.decoder().decode(OmniThread.self, from: Data(threadJSON(status: "running").utf8))
  }
}

@MainActor
@Suite struct NewThreadBaseTests {
  private func make(_ api: FakeNewThreadAPI, _ dir: TempDir, channel: String? = "acme") -> NewThreadComposerModel {
    NewThreadComposerModel(fixedChannel: channel, api: api, drafts: DraftStore(directory: dir.url))
  }

  @Test func sendsThePickedBase() async {
    let api = FakeNewThreadAPI()
    let m = make(api, TempDir("drafts"))
    m.text = "go"
    m.selectBase(.remoteDefault)
    #expect(await m.send() != nil)
    #expect(api.sent.first?.base == .remoteDefault)
  }

  @Test func sendsNoBaseForTheDefaultOrARemoteHarness() async {
    let api = FakeNewThreadAPI()
    let m = make(api, TempDir("drafts"))
    m.text = "one"
    _ = await m.send()
    m.text = "two"
    m.selectBase(.ref("main"))
    m.selectModel(harness: .hermes, model: "x")
    _ = await m.send()
    #expect(api.sent.map(\.base) == [nil, nil])
  }

  @Test func goesBackToTheCheckoutWhenTheChannelChanges() {
    let m = make(FakeNewThreadAPI(), TempDir("drafts"), channel: nil)
    m.update(crew: [], channels: ["conductor", "acme", "inbox"], harnesses: [])
    m.selectChannel("acme")
    m.selectBase(.ref("main"))
    m.selectChannel("acme")
    #expect(m.basePick == .ref("main"))
    m.selectChannel("inbox")
    #expect(m.basePick == .head)
  }

  @Test func aRefusedBaseKeepsTheDraftAndFilesAndShowsWhy() async {
    let dir = TempDir("drafts")
    let api = FakeNewThreadAPI()
    api.failWith = .http(status: 400, message: #"/repo has no branch, tag or commit named "nope"."#)
    let m = make(api, dir)
    m.text = "hi"
    m.selectBase(.ref("nope"))
    #expect(await m.send() == nil)
    #expect(m.sendError?.contains(#"named "nope""#) == true)
    #expect(m.text == "hi" && DraftStore(directory: dir.url).text(for: "new:acme") == "hi")
    #expect(m.basePick == .ref("nope"), "the pick stays so Ben can change it")
  }
}
