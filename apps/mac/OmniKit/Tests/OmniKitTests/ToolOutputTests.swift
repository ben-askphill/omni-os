import Foundation
import Synchronization
import Testing
import OmniKit

// The client half of packages/shared/tool-output.ts (#225). The pure cases follow packages/shared/tests/tool-output.test.ts;
// the fixtures are recorded by apps/server/tests/tool-output-fixtures.test.ts.

private func chunk(_ offset: Int, _ text: String, next: Int?, total: Int = 10, truncated: Bool = false) throws -> OutputChunk {
  let object: [String: Any] = [
    "event_id": 1, "tool_use_id": "c", "offset": offset, "text": text, "next": next ?? NSNull(), "total": total,
    "is_error": false, "truncated": truncated,
  ]
  return try OmniJSON.decoder().decode(OutputChunk.self, from: JSONSerialization.data(withJSONObject: object))
}

private func calls(_ events: [EventRow]) -> [String: ToolCall] {
  var found: [String: ToolCall] = [:]
  for case .tools(let group) in Transcript(events).items {
    for call in group.flat { found[call.callID] = call }
  }
  return found
}

/// Reads chunks by offset (a failure first, when one is queued), and hands out tails the test drives.
private final class FakeToolOutputAPI: ToolOutputAPI {
  private struct State {
    var chunks: [Int: OutputChunk] = [:]
    var failures: [OmniAPIError] = []
    var gate: Gate?
    var offsets: [Int] = []
    var cancelledReads = 0
    var tails: [AsyncStream<TailMessage>.Continuation] = []
    var closedTails = 0
  }
  private let state = Mutex(State())

  init(_ chunks: [OutputChunk] = []) {
    state.withLock { s in for c in chunks { s.chunks[c.offset] = c } }
  }

  var offsets: [Int] { state.withLock { $0.offsets } }
  var cancelledReads: Int { state.withLock { $0.cancelledReads } }
  var closedTails: Int { state.withLock { $0.closedTails } }
  var tails: [AsyncStream<TailMessage>.Continuation] { state.withLock { $0.tails } }

  func fail(_ error: OmniAPIError) { state.withLock { $0.failures.append(error) } }
  /// Holds the next reads until the gate opens.
  func hold() -> Gate {
    let g = Gate()
    state.withLock { $0.gate = g }
    return g
  }

  func toolOutputChunk(threadID: String, eventID: Int, offset: Int) async throws(OmniAPIError) -> OutputChunk {
    let gate = state.withLock { s in
      s.offsets.append(offset)
      return s.gate
    }
    await gate?.wait()
    if Task.isCancelled {
      state.withLock { $0.cancelledReads += 1 }
      throw .cancelled
    }
    let answer = state.withLock { s -> Result<OutputChunk, OmniAPIError> in
      if !s.failures.isEmpty { return .failure(s.failures.removeFirst()) }
      guard let c = s.chunks[offset] else { return .failure(.http(status: 404, message: "tool result not found")) }
      return .success(c)
    }
    return try answer.get()
  }

  func toolTail(threadID: String, toolUseID: String) -> AsyncStream<TailMessage> {
    let (stream, c) = AsyncStream<TailMessage>.makeStream()
    c.onTermination = { [weak self] _ in self?.state.withLock { $0.closedTails += 1 } }
    state.withLock { $0.tails.append(c) }
    return stream
  }
}

@Suite struct ToolOutputTests {
  @Test func decodesTheRecordedChunksAndTail() throws {
    let first = try decodeFixture(OutputChunk.self, "tool-output-chunk.json")
    #expect(first.eventID == 5)
    #expect(first.toolUseID == "call-test")
    #expect(first.offset == 0)
    #expect(first.next == 400)
    #expect(first.total == 11691)
    #expect(first.isError)
    #expect(!first.truncated)
    #expect(first.exitCode == 1)
    #expect(first.text.hasPrefix("Exit code 1\nFAIL src/cart-0.test.ts"))

    let last = try decodeFixture(OutputChunk.self, "tool-output-chunk-end.json")
    #expect(last.offset == 11591)
    #expect(last.next == nil)

    let tail = try decodeFixture([TailMessage].self, "tool-tail.json")
    #expect(tail == [
      .tail(text: "Compiling 1/3\n", reset: true, skipped: 0),
      .tail(text: "Compiling 2/3\n", reset: false, skipped: 0),
      .tail(text: "xxxxxxxx…", reset: false, skipped: 50),
      .end(live: true),
    ])
  }

  @Test func layOutACompactResultBesideAWholeOne() throws {
    let d = try decodeFixture(ThreadDetail.self, "tool-output-open.json")
    let found = calls(d.events)

    let test = try #require(found["call-test"]?.result)
    let output = try #require(test.output)
    #expect(output.chars == 11691)
    #expect(output.lines == 281)
    #expect(output.exitCode == 1)
    #expect(test.exitCode == 1)
    #expect(test.eventID == 5)
    #expect(test.truncated)
    #expect(test.text.unicodeScalars.count == ToolOutputLimit.preview)
    #expect(found["call-test"]?.isFailed == true)
    #expect(ToolOutputSource(found["call-test"]!, threadID: "output", running: false) == .saved(threadID: "output", eventID: 5))

    let ls = try #require(found["call-ls"]?.result)
    #expect(ls.output == nil)
    #expect(ls.text == "cart.ts\ntax.ts\n")
    #expect(ls.exitCode == nil)
    #expect(ls.eventID == 3)
    #expect(ToolOutputSource(found["call-ls"]!, threadID: "output", running: true) == nil)
  }

  @Test func aRunningCallFollowsItsTail() throws {
    let use = try decode(EventRow.self, eventJSON(kind: "tool_use", payload: #"{"id":"cmd","name":"Bash","input":{"command":"make"}}"#, id: 7))
    let call = try #require(calls([use])["cmd"])
    #expect(ToolOutputSource(call, threadID: "t1", running: true) == .live(threadID: "t1", toolUseID: "cmd"))
    #expect(ToolOutputSource(call, threadID: "t1", running: false) == nil)
  }

  @Test func aMalformedOutputLeavesAWholeRow() throws {
    let row = try decode(
      EventRow.self, eventJSON(kind: "tool_result", payload: #"{"tool_use_id":"c","text":"ok","is_error":false,"truncated":true,"output":{"chars":"x"}}"#))
    guard case .toolResult(let r) = row.content else { Issue.record("not a tool result"); return }
    #expect(r.output == nil)
    #expect(r.text == "ok")
  }

  @Test func readsTheExitCodeAFailedCommandStartsWith() {
    #expect(ToolOutput.exitCode(of: "Exit code 2\nboom") == 2)
    #expect(ToolOutput.exitCode(of: "Exit code -1") == -1)
    #expect(ToolOutput.exitCode(of: "ok\nExit code 2") == nil)
    #expect(ToolOutput.exitCode(of: "Exit code two\n") == nil)
    #expect(ToolOutput.exitCode(of: "Exit code 12345678901") == nil)
    #expect(ToolOutput.exitCode(of: "Exit code \n") == nil)
  }

  @Test func writesTheChunkQuery() {
    #expect(ToolOutput.query(offset: 100, limit: 50).map { "\($0.0)=\($0.1)" } == ["offset=100", "limit=50"])
    #expect(ToolOutput.query(offset: 0).map { "\($0.0)=\($0.1)" } == ["offset=0"])
  }

  @Test func joinsChunksInOrderToTheEnd() throws {
    var h = LoadedOutput.empty
    h = h.joining(try chunk(0, "abcde", next: 5))
    #expect(h.left == 5)
    h = h.joining(try chunk(5, "fghij", next: nil))
    #expect(h == LoadedOutput.empty.joining(try chunk(0, "abcdefghij", next: nil)))
    #expect(h.text == "abcdefghij")
    #expect(h.next == nil)
    #expect(h.left == 0)
  }

  @Test func ignoresARepeatAChunkOutOfPlaceAndAnythingAfterTheEnd() throws {
    let one = LoadedOutput.empty.joining(try chunk(0, "abcde", next: 5))
    #expect(one.joining(try chunk(0, "abcde", next: 5)) == one)
    #expect(one.joining(try chunk(7, "zz", next: nil)) == one)
    let done = one.joining(try chunk(5, "fghij", next: nil))
    #expect(done.joining(try chunk(5, "fghij", next: nil)) == done)

    let first = try decodeFixture(OutputChunk.self, "tool-output-chunk.json")
    let held = LoadedOutput.empty.joining(first)
    #expect(held.joining(try decodeFixture(OutputChunk.self, "tool-output-chunk-end.json")) == held)
  }

  @Test func appendsAndAResetStartsOver() {
    #expect(ToolOutput.applyTail("ab", "cd", reset: false) == "abcd")
    #expect(ToolOutput.applyTail("ab", "cd", reset: true) == "cd")
  }

  @Test func keepsTheNewestUnitsAndNeverStartsOnHalfASurrogatePair() {
    #expect(ToolOutput.applyTail("abcdef", "ghi", reset: false, cap: 5) == "efghi")
    let out = ToolOutput.applyTail("", String(repeating: "😀", count: 10), reset: false, cap: 5)
    #expect(out.utf16.count <= 5)
    #expect(out == "😀😀")
    #expect(ToolOutput.applyTail(String(repeating: "x", count: ToolOutputLimit.clientTail), "y", reset: false).utf16.count == ToolOutputLimit.clientTail)
  }

  @Test func saysWhenOlderOutputWasDropped() {
    var t = LiveTail()
    t.apply(text: "one\n", reset: true, skipped: 0, cap: 8)
    #expect(t.text == "one\n")
    #expect(!t.cut)
    t.apply(text: "two\n", reset: false, skipped: 0, cap: 8)
    #expect(!t.cut)
    t.apply(text: "3\n", reset: false, skipped: 0, cap: 8)
    #expect(t.text == "e\ntwo\n3\n")
    #expect(t.cut)
    t.apply(text: "fresh", reset: true, skipped: 0, cap: 8)
    #expect(t.text == "fresh")
    #expect(!t.cut)
    t.apply(text: "!", reset: false, skipped: 50, cap: 8)
    #expect(t.text == "fresh!")
    #expect(t.cut)
    t.apply(text: "late", reset: true, skipped: 12, cap: 8)
    #expect(t.cut)
  }
}

@Suite @MainActor struct ToolOutputModelTests {
  private let source = ToolOutputSource.saved(threadID: "t1", eventID: 5)

  @Test func loadsTheFirstChunkThenOneMorePerAsk() async throws {
    let api = FakeToolOutputAPI([try chunk(0, "abc", next: 3, total: 9), try chunk(3, "def", next: 6, total: 9), try chunk(6, "ghi", next: nil, total: 9, truncated: true)])
    let model = ToolOutputModel()
    let run = Task { await model.run(source, api: api) }
    defer { run.cancel() }

    try await waitFor("the first chunk") { model.saved?.text == "abc" }
    #expect(model.saved?.left == 6)
    await settle()
    #expect(api.offsets == [0])

    model.more()
    try await waitFor("the second chunk") { model.saved?.text == "abcdef" }
    model.more()
    try await waitFor("the last chunk") { model.saved?.next == nil }
    #expect(model.saved?.text == "abcdefghi")
    #expect(model.saved?.truncated == true)

    model.more()
    await settle()
    #expect(api.offsets == [0, 3, 6])
    #expect(!model.loading)
  }

  @Test func aRowBackInViewReadsNothingUnasked() async throws {
    let api = FakeToolOutputAPI([try chunk(0, "abc", next: 3, total: 6), try chunk(3, "def", next: nil, total: 6)])
    let model = ToolOutputModel()
    let first = Task { await model.run(source, api: api) }
    try await waitFor("the first chunk") { model.saved?.text == "abc" }
    first.cancel()
    await first.value

    let again = Task { await model.run(source, api: api) }
    defer { again.cancel() }
    await settle()
    #expect(api.offsets == [0])
    model.more()
    try await waitFor("the asked chunk") { model.saved?.text == "abcdef" }
  }

  @Test func aFailedChunkKeepsWhatWasHeldAndRetries() async throws {
    let api = FakeToolOutputAPI([try chunk(0, "abc", next: 3, total: 6), try chunk(3, "def", next: nil, total: 6)])
    api.fail(.unreachable("down"))
    let model = ToolOutputModel()
    let run = Task { await model.run(source, api: api) }
    defer { run.cancel() }

    try await waitFor("the failure") { model.error != nil }
    #expect(model.saved == nil)
    #expect(model.error?.message == "Cannot reach the Omni server. Is it running?")

    model.more()
    try await waitFor("the retry") { model.saved?.text == "abc" }
    #expect(model.error == nil)

    api.fail(.http(status: 500, message: "boom"))
    model.more()
    try await waitFor("the second failure") { model.error != nil }
    #expect(model.saved?.text == "abc")
    model.more()
    try await waitFor("the end") { model.saved?.next == nil }
    #expect(api.offsets == [0, 0, 3, 3])
  }

  @Test func closingTheRowCancelsTheChunkInFlight() async throws {
    let api = FakeToolOutputAPI([try chunk(0, "abc", next: nil, total: 3)])
    let gate = api.hold()
    let model = ToolOutputModel()
    let run = Task { await model.run(source, api: api) }

    try await waitFor("the read") { model.loading }
    run.cancel()
    gate.open()
    await run.value

    #expect(api.cancelledReads == 1)
    #expect(!model.loading)
    #expect(model.error == nil)
    #expect(model.saved == nil)
  }

  @Test func followsTheTailUntilTheRowCloses() async throws {
    let api = FakeToolOutputAPI()
    let model = ToolOutputModel()
    let run = Task { await model.run(.live(threadID: "t1", toolUseID: "cmd"), api: api) }

    try await waitFor("the tail") { api.tails.count == 1 }
    let tail = try #require(api.tails.first)
    tail.yield(.tail(text: "Compiling 1/3\n", reset: true, skipped: 0))
    tail.yield(.tail(text: "Compiling 2/3\n", reset: false, skipped: 0))
    try await waitFor("two lines") { model.live?.text == "Compiling 1/3\nCompiling 2/3\n" }
    #expect(model.live?.cut == false)
    tail.yield(.tail(text: "x", reset: false, skipped: 50))
    try await waitFor("the skip") { model.live?.cut == true }

    run.cancel()
    await run.value
    try await waitFor("the tail closed") { api.closedTails == 1 }
  }

  @Test func aTailWithNoLiveOutputLeavesWaiting() async throws {
    let api = FakeToolOutputAPI()
    let model = ToolOutputModel()
    let run = Task { await model.run(.live(threadID: "t1", toolUseID: "cmd"), api: api) }
    try await waitFor("the tail") { api.tails.count == 1 }
    api.tails[0].yield(.tail(text: "", reset: true, skipped: 0))
    api.tails[0].yield(.end(live: false))
    await run.value
    #expect(model.live == nil)
  }

  @Test func theResultReplacesTheTail() async throws {
    let api = FakeToolOutputAPI([try chunk(0, "all of it", next: nil, total: 9)])
    let model = ToolOutputModel()
    let live = Task { await model.run(.live(threadID: "t1", toolUseID: "cmd"), api: api) }
    try await waitFor("the tail") { api.tails.count == 1 }
    api.tails[0].yield(.tail(text: "some", reset: true, skipped: 0))
    try await waitFor("the tail's text") { model.live?.text == "some" }

    live.cancel()
    await live.value
    let saved = Task { await model.run(source, api: api) }
    defer { saved.cancel() }
    try await waitFor("the saved output") { model.saved?.text == "all of it" }
    #expect(model.live == nil)
    #expect(api.closedTails == 1)
  }
}

@Suite struct ToolOutputClientTests {
  @Test func readsAChunkFromTheOffsetGiven() async throws {
    let t = StubTransport(body: try fixture("tool-output-chunk.json"))
    let client = OmniClient(port: 4799, token: .fixed("secret"), transport: t)
    let c = try await client.toolOutputChunk(threadID: "t 1", eventID: 5, offset: 400)
    #expect(c.next == 400)
    let req = try #require(t.requests.first)
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/threads/t%201/events/5/output?offset=400")
    #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer secret")
  }

  @Test func followsATailToItsEndAndCloses() async throws {
    let t = ScriptedSSETransport()
    let client = OmniClient(port: 4799, token: .fixed("secret"))
    let tail = client.toolTail(threadID: "t 1", toolUseID: "call/1", transport: t, clock: TestClock())
    let conn = try await t.next()
    #expect(conn.request.url?.absoluteString == "http://127.0.0.1:4799/api/threads/t%201/tools/call%2F1/tail")
    #expect(conn.request.value(forHTTPHeaderField: "Authorization") == "Bearer secret")
    conn.accept()
    conn.send("event: ping\ndata: \n\n")
    let recorded = try #require(try JSONSerialization.jsonObject(with: Data(fixture("tool-tail.json").utf8)) as? [Any])
    for m in recorded {
      conn.send("data: \(String(decoding: try JSONSerialization.data(withJSONObject: m), as: UTF8.self))\n\n")
    }
    var got: [TailMessage] = []
    for await m in tail { got.append(m) }
    #expect(got == (try decodeFixture([TailMessage].self, "tool-tail.json")))
    try await eventually("the connection dropped") { conn.isDropped }
  }

  @Test func endingTheIterationClosesTheConnection() async throws {
    let t = ScriptedSSETransport()
    let tail = OmniClient(port: 4799).toolTail(threadID: "t1", toolUseID: "cmd", transport: t, clock: TestClock())
    let conn = try await t.next()
    conn.accept()
    let reader = Task {
      for await _ in tail {}
    }
    conn.send(#"data: {"kind":"tail","text":"a","reset":true,"skipped":0}"# + "\n\n")
    await settle()
    reader.cancel()
    await reader.value
    try await eventually("the connection dropped") { conn.isDropped }
  }
}
