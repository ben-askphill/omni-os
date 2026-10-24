import Foundation
import Testing
@testable import OmniKit

// thread_reference on the Mac: its body, on the corpus the TypeScript reads (packages/test-fixtures/message-context.json),
// and the picker behind the reply box's button. A reference alone never sends anything: the picker only reads.
private let repoRoot = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

private func cases(_ key: String) throws -> [JSONValue] {
  let corpus = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: repoRoot.appending(path: "packages/test-fixtures/message-context.json")))
  guard case .array(let list)? = corpus[key] else { return [] }
  return list
}

private func candidate(_ id: String, title: String = "Fix the cart total", channel: String = "shop", name: String = "Shop", same: Bool = true) -> ThreadReferenceCandidate {
  ThreadReferenceCandidate(id: id, shortID: String(id.prefix(8)), title: title, channel: channel, channelName: name, status: "done", sameChannel: same)
}

private actor FakeAPI: ThreadReferenceAPI {
  var asked: [(query: String, scope: ThreadReferenceScope)] = []
  var answer: [ThreadReferenceScope: [ThreadReferenceCandidate]] = [:]
  var failure: OmniAPIError?

  func set(_ scope: ThreadReferenceScope, _ rows: [ThreadReferenceCandidate]) { answer[scope] = rows }
  func fail(_ e: OmniAPIError?) { failure = e }

  func threadReferences(thread: String, query: String, scope: ThreadReferenceScope) async throws(OmniAPIError) -> [ThreadReferenceCandidate] {
    asked.append((query, scope))
    if let failure { throw failure }
    return (answer[scope] ?? []).filter { query.isEmpty || $0.title.lowercased().contains(query.lowercased()) || $0.channelName.lowercased().contains(query.lowercased()) }
  }
}

@Suite struct ThreadReferenceTests {
  @Test func checksBodiesAsTheServerDoes() throws {
    let prefix = "context[0].body: "
    var checked = 0
    for c in try cases("parse") {
      guard case .array(let raw)? = c["raw"], let record = raw.first, case .object = record, record["kind"]?.stringValue == "thread_reference" else { continue }
      let name = c["name"]?.stringValue ?? "?"
      var version = 0
      if case .number(let n)? = record["v"], let i = Int(exactly: n) { version = i }
      let got = ThreadReferenceContext.check(record["body"] ?? .null, v: version)
      if case .array(let want)? = c["expect"]?["records"], let first = want.first {
        let body = try got.get()
        #expect(try JSONValue(encoding: body) == first["body"], "\(name)")
        #expect(ThreadReferenceContext.label(body) == first["label"]?.stringValue, "\(name)")
        #expect(ThreadReferenceContext.parse(try JSONValue(encoding: body), v: 1) == body, "\(name) parses again")
        checked += 1
      } else if let error = c["expect"]?["error"]?.stringValue, error.hasPrefix(prefix) {
        #expect(got.failureMessage == String(error.dropFirst(prefix.count)), "\(name)")
        checked += 1
      }
    }
    #expect(checked >= 6)
  }

  /// The body Ben's pick makes: each case is also run through the TypeScript, so the two cannot drift.
  @Test func makesEveryCorpusReferenceBody() throws {
    let refs = try cases("threadReferences")
    #expect(refs.count >= 7)
    for c in refs {
      let name = c["name"]?.stringValue ?? "?"
      let t = try #require(c["thread"])
      let stamp = try #require(c["at"]?.stringValue)
      let at = try #require(OmniJSON.parseDate(stamp))
      let id = try #require(t["id"]?.stringValue)
      let title = try #require(t["title"]?.stringValue)
      let channel = try #require(t["channel"]?.stringValue)
      let channelName = try #require(t["channel_name"]?.stringValue)
      let current = try #require(c["current"]?.stringValue)
      let body = ThreadReferenceContext.referenceBody(.init(id: id, title: title, channel: channel, channelName: channelName), current: current, at: at)
      #expect(try JSONValue(encoding: body) == c["expect"], "\(name)")
      #expect(ThreadReferenceContext.parse(try JSONValue(encoding: body), v: 1) == body, "\(name) parses again")
    }
  }

  @Test func labelsByTitleChannelAndTheStartOfTheID() {
    let a = ThreadReferenceContext.referenceBody(.init(id: "aaaaaaaa-1111", title: "Fix the cart", channel: "shop", channelName: "Shop"), current: "shop", at: Date(timeIntervalSince1970: 0))
    let b = ThreadReferenceContext.referenceBody(.init(id: "bbbbbbbb-2222", title: "Fix the cart", channel: "shop", channelName: "Shop"), current: "shop", at: Date(timeIntervalSince1970: 0))
    #expect(ThreadReferenceContext.label(a) == "Thread: Fix the cart (Shop · aaaaaaaa)")
    #expect(ThreadReferenceContext.label(a) != ThreadReferenceContext.label(b))
    let long = ThreadReferenceContext.referenceBody(
      .init(id: "cccccccc-3333", title: String(repeating: "a", count: 200), channel: "shop", channelName: String(repeating: "S", count: 100)), current: "shop", at: Date(timeIntervalSince1970: 0))
    let label = MessageContext.cutLabel(ThreadReferenceContext.label(long))
    #expect(label.unicodeScalars.count == MessageContext.labelMax)
    #expect(label.hasSuffix("· cccccccc)"))
  }

  @Test func registersAsAKind() throws {
    let body = ThreadReferenceContext.referenceBody(.init(id: "t2", title: "Nails", channel: "pink", channelName: "Pink"), current: "shop", at: Date(timeIntervalSince1970: 1_792_916_130.125))
    let r = MessageContext.make(ThreadReferenceContext.self, body: body, note: " the one ", id: "id-1")
    #expect((r.kind, r.v, r.note) == ("thread_reference", 1, "the one"))
    #expect(body.crossChannel)
    let reading = try #require(ContextReading.read([r], kinds: [ThreadReferenceContext.self]).first)
    #expect(reading.isKnown)
  }

  // MARK: The picker

  @MainActor private func picker(_ api: FakeAPI, channel: String = "shop") -> (ThreadReferencePicker, DraftContextModel) {
    let dir = FileManager.default.temporaryDirectory.appending(path: "omni-thread-ref-\(UUID().uuidString)")
    let draft = DraftContextModel(threadID: "t1", drafts: DraftStore(directory: dir))
    return (ThreadReferencePicker(threadID: "t1", channelID: channel, api: api, draft: draft, now: { Date(timeIntervalSince1970: 1_792_916_130.125) }), draft)
  }

  @MainActor @Test func searchesThisChannelFirstAndAllChannelsOnRequest() async {
    let api = FakeAPI()
    await api.set(.channel, [candidate("7d3e91a0-aaaa"), candidate("9b1c2d3e-bbbb")])
    await api.set(.all, [candidate("7d3e91a0-aaaa"), candidate("1a2b3c4d-cccc", title: "Nails page", channel: "pink", name: "Pink Gellac", same: false)])
    let (p, _) = picker(api)
    await p.search()
    #expect(p.rows.map(\.id) == ["7d3e91a0-aaaa", "9b1c2d3e-bbbb"])
    #expect(p.settled)
    p.scope = .all
    await p.search()
    #expect(p.rows.map(\.title) == ["Fix the cart total", "Nails page"])
    #expect(await api.asked.map(\.scope) == [.channel, .all])
  }

  @MainActor @Test func attachesAPickWithoutTouchingAnythingElse() async throws {
    let api = FakeAPI()
    let (p, draft) = picker(api)
    let c = candidate("7d3e91a0-aaaa")
    #expect(p.attach(c))
    let r = try #require(draft.records.first)
    #expect(r.kind == "thread_reference")
    #expect(r.label == "Thread: Fix the cart total (Shop · 7d3e91a0)")
    let body = try #require(ThreadReferenceContext.parse(r.body, v: 1))
    #expect((body.thread, body.channel, body.crossChannel, body.capturedAt) == ("7d3e91a0-aaaa", "shop", false, "2026-10-25T08:15:30.125Z"))
    #expect(await api.asked.isEmpty)
  }

  @MainActor @Test func marksACrossChannelPickAndRefusesTheSameThreadTwice() throws {
    let (p, draft) = picker(FakeAPI())
    #expect(p.attach(candidate("1a2b3c4d-cccc", title: "Nails page", channel: "pink", name: "Pink Gellac", same: false)))
    let record = try #require(draft.records.first)
    let body = try #require(ThreadReferenceContext.parse(record.body, v: 1))
    #expect(body.crossChannel && body.channel == "pink")
    #expect(p.isAttached("1a2b3c4d-cccc"))
    #expect(!p.attach(candidate("1a2b3c4d-cccc", title: "Nails page", channel: "pink", name: "Pink Gellac", same: false)))
    #expect(p.problem == "That thread is already attached.")
    #expect(draft.records.count == 1)
  }

  @MainActor @Test func tellsTwoThreadsOfOneTitleApartAndStopsAtTheMessageLimit() throws {
    let (p, draft) = picker(FakeAPI())
    #expect(p.attach(candidate("aaaaaaaa-1")) && p.attach(candidate("bbbbbbbb-2")))
    #expect(Set(draft.records.map(\.label)).count == 2)
    for i in 0..<(MessageContext.maxCount - 2) { #expect(p.attach(candidate("cccc000\(i)-x", title: "T\(i)"))) }
    #expect(!p.attach(candidate("dddddddd-9", title: "One too many")))
    #expect(p.problem == "A message holds at most \(MessageContext.maxCount) of these. Send it, or remove one first.")
  }

  @MainActor @Test func saysWhySearchFailedAndResets() async {
    let api = FakeAPI()
    await api.fail(.unreachable("offline"))
    let (p, _) = picker(api)
    p.query = "cart"
    p.scope = .all
    await p.search()
    #expect(p.rows.isEmpty && p.error != nil && p.settled)
    p.reset()
    #expect(p.query.isEmpty && p.scope == .channel && p.problem == nil)
    await api.fail(nil)
    await api.set(.channel, [candidate("7d3e91a0-aaaa")])
    await p.search()
    #expect(p.error == nil && p.rows.count == 1)
  }
}
