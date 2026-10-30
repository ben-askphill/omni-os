import Foundation
import Testing
@testable import OmniKit

private func file(_ name: String, size: Int = 10, modified: Double = 0) -> StagedFile {
  StagedFile(url: URL(filePath: "/tmp/\(name)"), name: name, size: size, modified: Date(timeIntervalSince1970: modified))
}

@Suite struct SendRulesTests {
  @Test func steersByDefaultAndQueuesWhereSteeringIsNotSupported() {
    #expect(SendRules.primary(canSteer: true) == .steer)
    #expect(SendRules.primary(canSteer: false) == .queue)
    #expect(SendRules.options(canSteer: true) == [.steer, .queue, .interrupt])
    #expect(SendRules.options(canSteer: false) == [.queue, .interrupt])
  }

  @Test func saysABusyReplyQueuesWhereItCannotSteer() {
    #expect(SendRules.placeholder(busy: true, canSteer: false) == "Queue a message. It runs after this turn.")
    #expect(SendRules.placeholder(busy: true) == "Steer the agent. It reads this at its next step.")
    #expect(SendRules.placeholder(busy: false, canSteer: false) == "Reply")
  }

  @Test func namesTheMenuKeysInThePlaceholder() {
    #expect(SendRules.withKeys("Reply") == "Reply · / commands, @ files")
  }

  @Test func sendKeysOnlyPickAModeWhileBusy() {
    #expect(SendRules.mode(busy: false, canSteer: true, shift: false) == nil)
    #expect(SendRules.mode(busy: false, canSteer: true, shift: true) == nil)
    #expect(SendRules.mode(busy: true, canSteer: true, shift: false) == .steer)
    #expect(SendRules.mode(busy: true, canSteer: false, shift: false) == .queue)
    #expect(SendRules.mode(busy: true, canSteer: false, shift: true) == .interrupt)
  }

  @Test func capabilitiesDecideWhenKnownElseCursorCannotSteer() throws {
    let caps = try JSONDecoder().decode(
      HarnessCapabilities.self, from: Data(#"{"warmProcess":false,"steer":false,"inlineImages":false,"usage":"none"}"#.utf8))
    #expect(!SendRules.canSteer(harness: .claudeCode, capabilities: caps))
    #expect(SendRules.canSteer(harness: .codex, capabilities: nil))
    #expect(!SendRules.canSteer(harness: .cursor, capabilities: nil))
  }

  @Test func escapeInterruptsOnlyWhenNothingElseWantsIt() {
    var c = EscapeContext(running: true)
    #expect(EscapeGate.interrupts(c))
    c.running = false
    #expect(!EscapeGate.interrupts(c))
    for tweak: (inout EscapeContext) -> Void in [
      { $0.interrupting = true }, { $0.composing = true }, { $0.isRepeat = true }, { $0.hasModifiers = true },
      { $0.menuOrSheetOpen = true }, { $0.slashMenuOpen = true },
    ] {
      var d = EscapeContext(running: true)
      tweak(&d)
      #expect(!EscapeGate.interrupts(d))
    }
  }
}

@Suite struct AttachmentRulesTests {
  @Test func addsUniqueFilesAndDropsEmptyOnes() {
    let r = AttachmentRules.add([file("a.png")], incoming: [file("a.png"), file("b.png"), file("empty.txt", size: 0)], maxMB: 25)
    #expect(r.files.map(\.name) == ["a.png", "b.png"])
    #expect(r.error == nil)
  }

  @Test func keepsTenAndSaysSo() {
    let many = (1...12).map { file("f\($0)") }
    let r = AttachmentRules.add([], incoming: many, maxMB: 25)
    #expect(r.files.count == 10)
    #expect(r.error == "At most 10 files per message.")
  }

  @Test func namesFilesOverTheLimit() {
    let mb = 1024 * 1024
    let one = AttachmentRules.add([], incoming: [file("big.mov", size: 26 * mb), file("ok.txt")], maxMB: 25)
    #expect(one.files.map(\.name) == ["ok.txt"])
    #expect(one.error == #""big.mov" is over the 25 MB limit."#)
    let two = AttachmentRules.add([], incoming: [file("a", size: 3 * mb), file("b", size: 4 * mb)], maxMB: 2.5)
    #expect(two.files.isEmpty)
    #expect(two.error == #""a", "b" are over the 2.5 MB limit."#)
  }

  @Test func aCleanAddClearsTheLastError() {
    let r = AttachmentRules.add([], incoming: [file("a")], maxMB: 25)
    #expect(r.error == nil)
  }
}

@Suite struct DraftStoreTests {
  @Test func savesRestoresAndClears() {
    let dir = TempDir("drafts")
    let store = DraftStore(directory: dir.url)
    #expect(store.text(for: "reply:t1") == "")
    store.save("half a thought\nsecond line", for: "reply:t1")
    #expect(DraftStore(directory: dir.url).text(for: "reply:t1") == "half a thought\nsecond line")
    #expect(store.text(for: "reply:t2") == "")
    store.save("", for: "reply:t1")
    #expect(store.text(for: "reply:t1") == "")
  }
}

@MainActor
private final class FakeReplyAPI: ReplyAPI {
  var failWith: OmniAPIError?
  var sent: [(id: String, prompt: String, mode: SendMode?, files: [String], requestID: String?, context: [String])] = []
  /// When set, each send waits for it after it is recorded.
  var gate: Gate?
  nonisolated func reply(
    to id: String, prompt: String, mode: SendMode?, files: [UploadFile], requestID: String?, context: [MessageContext]
  ) async throws(OmniAPIError) -> OmniThread {
    let names = files.map(\.name)
    let (fail, gate) = await MainActor.run { () -> (OmniAPIError?, Gate?) in
      self.sent.append((id, prompt, mode, names, requestID, context.map(\.id)))
      return (self.failWith, self.gate)
    }
    await gate?.wait()
    if let fail { throw fail }
    return try! OmniJSON.decoder().decode(OmniThread.self, from: Data(threadJSON(status: "running").utf8))
  }
}

/// A diff_selection record with this id.
private func record(_ id: String, note: String = "") -> MessageContext {
  let body = DiffSelectionContext.parse(JSONValue.parse("""
    {"path":"src/cart.ts","old_path":null,"rows":[{"kind":"add","text":"x","old":null,"new":4}],
     "source":{"group":"unstaged","from":"9f2c1e4","to":"3f2a1c9","turn":null,"blob_old":null,"blob_new":null}}
    """), v: 1)!
  return MessageContext.make(DiffSelectionContext.self, body: body, note: note, id: id)
}

@MainActor
@Suite struct ReplyComposerModelTests {
  private func make(_ api: FakeReplyAPI, _ dir: TempDir) -> ReplyComposerModel {
    let drafts = DraftStore(directory: dir.url)
    return ReplyComposerModel(
      threadID: "t1", api: api, context: DraftContextModel(threadID: "t1", drafts: drafts), drafts: drafts,
      readFile: { UploadFile(name: $0.name, mime: "text/plain", data: Data("x".utf8)) })
  }

  @Test func restoresTheDraftAndClearsItOnASuccessfulSend() async {
    let dir = TempDir("drafts")
    DraftStore(directory: dir.url).save("keep me", for: "reply:t1")
    let api = FakeReplyAPI()
    let m = make(api, dir)
    #expect(m.text == "keep me")
    m.addFiles([file("a.txt")])
    let sent = await m.send(mode: .steer)
    #expect(sent != nil)
    #expect(api.sent.map(\.prompt) == ["keep me"])
    #expect(api.sent.first?.mode == .steer)
    #expect(api.sent.first?.files == ["a.txt"])
    #expect(m.text == "")
    #expect(m.files.isEmpty)
    #expect(DraftStore(directory: dir.url).text(for: "reply:t1") == "")
  }

  @Test func aFailedSendKeepsTheDraftAndFilesAndShowsTheError() async {
    let dir = TempDir("drafts")
    let api = FakeReplyAPI()
    api.failWith = .http(status: 500, message: "boom")
    let m = make(api, dir)
    m.text = "hello"
    m.addFiles([file("a.txt")])
    let sent = await m.send(mode: nil)
    #expect(sent == nil)
    #expect(m.sendError == "boom")
    #expect(m.text == "hello")
    #expect(m.files.count == 1)
    #expect(DraftStore(directory: dir.url).text(for: "reply:t1") == "hello")
  }

  @Test func aRetryOfTheSameMessageKeepsItsRequestID() async {
    let dir = TempDir("drafts")
    let api = FakeReplyAPI()
    api.failWith = .unreachable("offline")
    let m = make(api, dir)
    m.text = "queue this"
    #expect(await m.send(mode: .queue) == nil)
    #expect(await m.send(mode: .queue) == nil)
    // Another mode is another message.
    #expect(await m.send(mode: .steer) == nil)
    api.failWith = nil
    #expect(await m.send(mode: .steer) != nil)
    let ids = api.sent.map(\.requestID)
    #expect(ids.allSatisfy { $0 != nil })
    #expect(ids[0] == ids[1])
    #expect(ids[2] != ids[1])
    #expect(ids[3] == ids[2])
    #expect(m.lastRequest == nil)
    // Sent: the next message gets a new id, even with the same text.
    m.text = "queue this"
    _ = await m.send(mode: .steer)
    #expect(api.sent.last?.requestID != ids[3])
  }

  @Test func blankTextSendsNothing() async {
    let dir = TempDir("drafts")
    let api = FakeReplyAPI()
    let m = make(api, dir)
    m.text = "  \n "
    #expect(await m.send(mode: nil) == nil)
    #expect(api.sent.isEmpty)
  }

  @Test func addingContextKeepsTheTextAndSendsBothThenClearsBoth() async {
    let dir = TempDir("drafts")
    let api = FakeReplyAPI()
    let m = make(api, dir)
    m.text = "half a thought"
    #expect(m.context.add(record("r1")) == nil)
    #expect(m.text == "half a thought")
    #expect(DraftStore(directory: dir.url).text(for: "reply:t1") == "half a thought")
    #expect(await m.send(mode: nil) != nil)
    #expect(api.sent.map(\.prompt) == ["half a thought"])
    #expect(api.sent.map(\.context) == [["r1"]])
    #expect(m.text == "" && m.context.records.isEmpty)
  }

  @Test func contextAloneCanBeSent() async {
    let dir = TempDir("drafts")
    let api = FakeReplyAPI()
    let m = make(api, dir)
    #expect(!m.canSend)
    _ = m.context.add(record("r1"))
    #expect(m.canSend)
    #expect(await m.send(mode: .queue) != nil)
    #expect(api.sent.map(\.prompt) == [""])
    #expect(!m.canSend)
  }

  @Test func aFailedSendKeepsTheContextAndARetryKeepsItsRequestID() async {
    let dir = TempDir("drafts")
    let api = FakeReplyAPI()
    api.failWith = .unreachable("offline")
    let m = make(api, dir)
    _ = m.context.add(record("r1"))
    #expect(await m.send(mode: nil) == nil)
    #expect(m.context.records.map(\.id) == ["r1"])
    #expect(await m.send(mode: nil) == nil)
    _ = m.context.add(record("r2"))
    #expect(await m.send(mode: nil) == nil)
    let ids = api.sent.map(\.requestID)
    #expect(ids[0] == ids[1])
    #expect(ids[2] != ids[1], "another record is another message")
  }

  @Test func aSendSettlesOnlyTheRecordsItCarried() async throws {
    let dir = TempDir("drafts")
    let api = FakeReplyAPI()
    let gate = Gate()
    api.gate = gate
    let m = make(api, dir)
    _ = m.context.add(record("r1"))
    let sending = Task { await m.send(mode: nil) }
    try await waitFor("the send to be out") { !api.sent.isEmpty }
    #expect(m.context.add(record("r2")) == nil)
    gate.open()
    #expect(await sending.value != nil)
    #expect(m.context.records.map(\.id) == ["r2"])
    #expect(DraftContextModel(threadID: "t1", drafts: DraftStore(directory: dir.url)).records.map(\.id) == ["r2"])
  }

  @Test func aSendShowsInTheThreadAtOnceWithItsFiles() async throws {
    let dir = TempDir("drafts")
    let api = FakeReplyAPI()
    let gate = Gate()
    api.gate = gate
    let m = make(api, dir)
    m.text = "look at this"
    m.addFiles([file("shot.png")])
    let sending = Task { await m.send(mode: nil) }
    try await waitFor("the send to be out") { !api.sent.isEmpty }
    #expect(m.text == "" && m.files.isEmpty, "the box empties as it goes")
    let out = m.outgoing.messages
    #expect(out.map(\.text) == ["look at this"])
    #expect(out.first?.attachments.map(\.name) == ["shot.png"])
    #expect(out.first?.attachments.first?.image == true)
    #expect(out.first?.requestID == api.sent.first?.requestID)
    gate.open()
    #expect(await sending.value != nil)
    #expect(m.outgoing.messages.isEmpty)
    #expect(m.text == "" && m.files.isEmpty)
  }

  @Test func aFailedSendComesBackUnlessANewMessageWasStarted() async throws {
    let dir = TempDir("drafts")
    let api = FakeReplyAPI()
    api.failWith = .http(status: 500, message: "boom")
    let gate = Gate()
    api.gate = gate
    let m = make(api, dir)
    m.text = "first"
    m.addFiles([file("a.txt")])
    let sending = Task { await m.send(mode: nil) }
    try await waitFor("the send to be out") { !api.sent.isEmpty }
    m.text = "second"
    gate.open()
    #expect(await sending.value == nil)
    #expect(m.outgoing.messages.isEmpty)
    #expect(m.text == "second")
    #expect(m.files.map(\.name) == ["a.txt"])
  }

  @Test func theServersPendingRowReplacesTheLocalOne() {
    let model = SendingModel()
    model.begin(.init(requestID: "r1", text: "hi", files: []))
    #expect(model.shown(besides: []).map(\.requestID) == ["r1"])
    let row = try! OmniJSON.decoder().decode(PendingMsg.self, from: Data(#"{"uuid":"u1","kind":"user","text":"hi","mode":"steer","state":"sent","request_id":"r1"}"#.utf8))
    #expect(model.shown(besides: [row]).isEmpty)
  }

  @Test func openPRQueuesWhileBusyAndLeavesTheDraftAlone() async {
    let dir = TempDir("drafts")
    let api = FakeReplyAPI()
    let m = make(api, dir)
    m.text = "draft"
    _ = await m.openPR(running: true)
    _ = await m.openPR(running: false)
    #expect(api.sent.map(\.mode) == [.queue, nil])
    #expect(api.sent.first?.prompt == ReplyComposerModel.openPRPrompt)
    #expect(m.text == "draft")
  }
}

@MainActor
@Suite struct DraftContextModelTests {
  @Test func addsOnceRemovesAndSurvivesARelaunch() {
    let dir = TempDir("drafts")
    let m = DraftContextModel(threadID: "t1", drafts: DraftStore(directory: dir.url))
    #expect(m.add(record("r1", note: "look")) == nil)
    #expect(m.add(record("r1", note: "look")) == nil)
    #expect(m.add(record("r2")) == nil)
    #expect(m.records.map(\.id) == ["r1", "r2"])
    let again = DraftContextModel(threadID: "t1", drafts: DraftStore(directory: dir.url))
    #expect(again.records == m.records)
    #expect(DraftContextModel(threadID: "t2", drafts: DraftStore(directory: dir.url)).records.isEmpty)
    m.remove(id: "r1")
    #expect(DraftContextModel(threadID: "t1", drafts: DraftStore(directory: dir.url)).records.map(\.id) == ["r2"])
    m.settle(sent: ["r2"])
    #expect(DraftStore(directory: dir.url).text(for: "context:t1") == "")
  }

  @Test func refusesANinthRecordAndTooMuchJSON() {
    let dir = TempDir("drafts")
    let m = DraftContextModel(threadID: "t1", drafts: DraftStore(directory: dir.url))
    for i in 0..<MessageContext.maxCount { #expect(m.add(record("r\(i)")) == nil) }
    #expect(m.add(record("r9")) == "A message holds at most 8 of these. Send it, or remove one first.")
    #expect(m.records.count == MessageContext.maxCount)

    let big = DraftContextModel(threadID: "t2", drafts: DraftStore(directory: dir.url))
    let long = String(repeating: "x", count: 1_900)
    var refused: String?
    for i in 0..<MessageContext.maxCount where refused == nil { refused = big.add(record("n\(i)", note: long)) }
    #expect(refused == nil, "notes alone stay under the limit")
    let rows = (1...100).map { #"{"kind":"add","text":"\#(String(repeating: "y", count: 400))","old":null,"new":\#($0)}"# }
    let body = DiffSelectionContext.parse(JSONValue.parse(#"{"path":"a","rows":[\#(rows.joined(separator: ","))],"source":{"group":"unstaged","from":"a","to":"b"}}"#), v: 1)!
    let huge = MessageContext.make(DiffSelectionContext.self, body: body, note: "", id: "huge")
    #expect(DraftContextModel(threadID: "t3", drafts: DraftStore(directory: dir.url)).add(huge) == "Too much for one message. Pick fewer lines, or send what is attached first.")
    let note = DraftContextModel(threadID: "t4", drafts: DraftStore(directory: dir.url))
    #expect(note.add(record("long", note: String(repeating: "z", count: 2_001))) == "A note can be 2000 characters at most.")
  }
}

@Suite struct ReplyRequestTests {
  @Test func jsonWithoutFilesOmitsAnIdleMode() async throws {
    let t = StubTransport(body: threadJSON())
    let client = OmniClient(port: 4799, transport: t)
    _ = try await client.reply(to: "t1", prompt: "hi", mode: nil, files: [])
    _ = try await client.reply(to: "t1", prompt: "hi", mode: .interrupt, files: [])
    let r = t.requests
    #expect(r[0].value(forHTTPHeaderField: "Content-Type") == "application/json")
    #expect(try bodyJSON(r[0]) == .object(["prompt": .string("hi")]))
    #expect(try bodyJSON(r[1]) == .object(["prompt": .string("hi"), "mode": .string("interrupt")]))
  }

  @Test func aRequestIDGoesInTheBody() async throws {
    let t = StubTransport(body: threadJSON())
    let client = OmniClient(port: 4799, transport: t)
    _ = try await client.reply(to: "t1", prompt: "then write it up", mode: .queue, files: [], requestID: "req-1")
    let expected = try JSONDecoder().decode(JSONValue.self, from: Data(try fixture("message-queued-request.json").utf8))
    #expect(try bodyJSON(t.requests[0]) == expected)
  }

  /// The lines the fixture run picked in its Changes answer, picked here the way the Changes tab does, make exactly the
  /// body the server took.
  @Test func linesPickedFromTheChangesAnswerAreTheRecordedRequest() async throws {
    let changes = try decodeFixture(BranchChanges.self, "changes.json")
    let view = try #require(ChangesView(changes))
    let file = try #require(view.groups.first { $0.kind == .unstaged }?.files.first { $0.file.path == "src/cart.ts" })
    let source = DiffSelectionContext.Source(group: .unstaged, from: view.base.sha, to: try #require(changes.head), turn: nil)
    let body = try DiffSelectionContext.select(file: file.diff, path: file.file.path, oldPath: file.file.oldPath, from: 1, to: 4, source: source).get()
    let record = MessageContext.make(
      DiffSelectionContext.self, body: body, note: "this reduce reads better with names", id: "00000000-0000-4000-8000-000000000037")
    let t = StubTransport(body: threadJSON())
    _ = try await OmniClient(port: 4799, transport: t).reply(
      to: "t1", prompt: "TOOL:4000 tidy this reduce", mode: nil, files: [], requestID: "req-context", context: [record])
    let expected = try JSONDecoder().decode(JSONValue.self, from: Data(try fixture("message-context-request.json").utf8))
    #expect(try bodyJSON(t.requests[0]) == expected)
  }

  @Test func contextGoesInTheBodyOnlyWhenThereIsSome() async throws {
    let t = StubTransport(body: threadJSON())
    let client = OmniClient(port: 4799, transport: t)
    _ = try await client.reply(to: "t1", prompt: "", mode: nil, files: [], requestID: "req-1", context: [record("r1", note: "this one")])
    _ = try await client.reply(to: "t1", prompt: "hi", mode: nil, files: [], requestID: "req-2", context: [])
    let sent = try bodyJSON(t.requests[0])
    #expect(sent["prompt"] == .string("") && sent["request_id"] == .string("req-1"))
    guard case .array(let records)? = sent["context"], let r = records.first else {
      Issue.record("no context in \(sent)")
      return
    }
    #expect(records.count == 1)
    #expect(r["id"] == .string("r1") && r["kind"] == .string("diff_selection") && r["v"] == .number(1))
    #expect(r["label"] == .string("src/cart.ts:4") && r["note"] == .string("this one"))
    #expect(r["body"]?["old_path"] == .null, "nulls are sent, not left out")
    #expect(r["body"]?["rows"] == .array([.object(["kind": .string("add"), "text": .string("x"), "old": .null, "new": .number(4)])]))
    #expect(try bodyJSON(t.requests[1]) == .object(["prompt": .string("hi"), "request_id": .string("req-2")]))
  }

  @Test func theRetryKeyAddsRecordIDsOnlyWhenThereAreSome() {
    #expect(PendingRequest.key(prompt: "hi", mode: .queue, files: ["/a"]) == "hi\u{1F}queue\u{1F}/a")
    #expect(PendingRequest.key(prompt: "hi", mode: .queue, files: ["/a"], context: []) == "hi\u{1F}queue\u{1F}/a")
    #expect(PendingRequest.key(prompt: "", mode: nil, files: [], context: ["r1", "r2"]) == "\u{1F}\u{1F}r1\u{1F}r2")
  }

  @Test func filesGoAsMultipartWithAPayloadField() async throws {
    let t = StubTransport(body: threadJSON())
    let client = OmniClient(port: 4799, transport: t)
    _ = try await client.reply(
      to: "t1", prompt: "look", mode: .queue, files: [UploadFile(name: "a \"b\".png", mime: "image/png", data: Data("PNG".utf8))])
    let req = try #require(t.requests.first)
    let type = try #require(req.value(forHTTPHeaderField: "Content-Type"))
    #expect(type.hasPrefix("multipart/form-data; boundary="))
    let boundary = String(type.dropFirst("multipart/form-data; boundary=".count))
    let body = String(decoding: try #require(req.httpBody), as: UTF8.self)
    let expected = [
      "--\(boundary)",
      #"Content-Disposition: form-data; name="payload""#,
      "",
      #"{"mode":"queue","prompt":"look"}"#,
      "--\(boundary)",
      #"Content-Disposition: form-data; name="files"; filename="a %22b%22.png""#,
      "Content-Type: image/png",
      "",
      "PNG",
      "--\(boundary)--",
      "",
    ].joined(separator: "\r\n")
    #expect(body == expected)
  }
}
