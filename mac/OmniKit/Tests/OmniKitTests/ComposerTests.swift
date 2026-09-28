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
  var sent: [(id: String, prompt: String, mode: SendMode?, files: [String])] = []
  nonisolated func reply(to id: String, prompt: String, mode: SendMode?, files: [UploadFile]) async throws(OmniAPIError) -> OmniThread {
    let names = files.map(\.name)
    let fail = await MainActor.run { () -> OmniAPIError? in
      self.sent.append((id, prompt, mode, names))
      return self.failWith
    }
    if let fail { throw fail }
    return try! OmniJSON.decoder().decode(OmniThread.self, from: Data(threadJSON(status: "running").utf8))
  }
}

@MainActor
@Suite struct ReplyComposerModelTests {
  private func make(_ api: FakeReplyAPI, _ dir: TempDir) -> ReplyComposerModel {
    ReplyComposerModel(
      threadID: "t1", api: api, drafts: DraftStore(directory: dir.url),
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

  @Test func blankTextSendsNothing() async {
    let dir = TempDir("drafts")
    let api = FakeReplyAPI()
    let m = make(api, dir)
    m.text = "  \n "
    #expect(await m.send(mode: nil) == nil)
    #expect(api.sent.isEmpty)
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
