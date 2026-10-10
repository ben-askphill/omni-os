import Foundation
import Synchronization
import Testing
import OmniKit

private let base = Date(timeIntervalSince1970: 1_790_582_400)

private func iso(_ seconds: Int) -> String {
  ISO8601DateFormatter().string(from: base.addingTimeInterval(Double(seconds)))
}

/// A thread row, `updated` seconds after a fixed start.
private func row(_ status: String = "running", updated: Int = 0, id: String = "t1", parent: String? = nil, title: String = "Fix cart") -> String {
  """
  {"id":"\(id)","channel_id":"acme","title":"\(title)","status":"\(status)","role":null,"model":"sonnet","harness":"claude-code",
   "effort":"","session_id":"s1","has_run":1,"cwd":"/tmp/x","branch":null,"parent_id":\(parent.map { "\"\($0)\"" } ?? "null"),
   "task_id":null,"source":"manual","automation":null,"last_text":null,"created_at":"\(iso(0))","updated_at":"\(iso(updated))"}
  """
}

private func artifact(_ id: Int, kind: String = "html", updated: Int = 0) -> String {
  #"{"id":\#(id),"thread_id":"t1","path":"/tmp/x/a\#(id)","name":"a\#(id)","kind":"\#(kind)","size":10,"created_at":"\#(iso(0))","updated_at":"\#(iso(updated))"}"#
}

private func pendingMsg(_ state: String, mode: String = "steer") -> String {
  #"{"uuid":"p-\#(state)","kind":"user","text":"more","mode":"\#(mode)","state":"\#(state)"}"#
}

private func ev(_ id: Int, _ kind: String = "assistant_text", _ payload: String = #"{"text":"ok"}"#) -> String {
  eventJSON(kind: kind, payload: payload, id: id)
}

private func detail(
  _ thread: String = row(), events: [String] = [], artifacts: [String] = [], pending: [String] = [], live: Bool = false,
  children: [String] = [], parent: String? = nil
) throws -> ThreadDetail {
  try decode(ThreadDetail.self, """
    {"thread":\(thread),"channel":\(channelJSON),"events":[\(events.joined(separator: ","))],"artifacts":[\(artifacts.joined(separator: ","))],
     "children":[\(children.joined(separator: ","))],"parent":\(parent ?? "null"),"pending":[\(pending.joined(separator: ","))],"live":\(live)}
    """)
}

/// SSE text for stream messages, on one line as the server sends them: an event with its id, or any other
/// message without one.
private func sse(event json: String, id: Int) -> String { "data: \(oneLine(json))\nid: \(id)\n\n" }
private func sse(_ json: String) -> String { "data: \(oneLine(json))\n\n" }
private func oneLine(_ json: String) -> String { json.replacingOccurrences(of: "\n", with: " ") }
private func threadMessage(_ thread: String, pending: [String]? = nil, live: Bool? = nil) -> String {
  var s = #"{"kind":"thread","thread":\#(thread)"#
  if let pending { s += #","pending":[\#(pending.joined(separator: ","))]"# }
  if let live { s += #","live":\#(live)"# }
  return s + "}"
}

/// The server's thread endpoints for one store, answering with whatever the test set last.
final class FakeThreadAPI: ThreadAPI {
  private struct State {
    var detail: Result<ThreadDetail, OmniAPIError> = .failure(.unreachable("not set"))
    var stop: Result<Void, OmniAPIError> = .success(())
    var calls: [String: Int] = [:]
    var hold: Gate?
  }
  private let state = Mutex(State())

  init(_ detail: ThreadDetail? = nil) {
    if let detail { self.detail = .success(detail) }
  }

  var detail: Result<ThreadDetail, OmniAPIError> {
    get { state.withLock { $0.detail } }
    set { state.withLock { $0.detail = newValue } }
  }
  var stop: Result<Void, OmniAPIError> {
    get { state.withLock { $0.stop } }
    set { state.withLock { $0.stop = newValue } }
  }

  func calls(_ endpoint: String) -> Int { state.withLock { $0.calls[endpoint, default: 0] } }

  /// The next snapshot answers with the detail set when the gate opens.
  func holdNext() -> Gate {
    let gate = Gate()
    state.withLock { $0.hold = gate }
    return gate
  }

  func thread(_ id: String) async throws(OmniAPIError) -> ThreadDetail {
    let gate = state.withLock { s in
      s.calls["thread", default: 0] += 1
      defer { s.hold = nil }
      return s.hold
    }
    await gate?.wait()
    return try detail.get()
  }

  func stopThread(_ id: String) async throws(OmniAPIError) -> OmniThread {
    state.withLock { $0.calls["stop", default: 0] += 1 }
    try stop.get()
    return try! decode(OmniThread.self, row())
  }
}

@MainActor
private func makeStore(_ api: FakeThreadAPI, frame: Duration = .zero) -> (ThreadStore, ScriptedSSETransport, TestClock) {
  let t = ScriptedSSETransport(), clock = TestClock()
  let client = OmniClient(port: 4799)
  let store = ThreadStore(id: "t1", api: api, clock: clock, frame: frame) { after in
    client.threadEvents("t1", after: after, transport: t, clock: clock)
  }
  store.start()
  return (store, t, clock)
}

/// A store loaded from `api`, with its stream open.
@MainActor
private func openStore(_ api: FakeThreadAPI, frame: Duration = .zero) async throws -> (ThreadStore, ScriptedSSETransport.Connection, ScriptedSSETransport, TestClock) {
  let (store, t, clock) = makeStore(api, frame: frame)
  try await waitFor("the load") { store.loadState == .loaded }
  let conn = try await t.next()
  conn.accept()
  try await waitFor("the stream") { store.connection == .open }
  return (store, conn, t, clock)
}

private let turn = [
  ev(1, "user", #"{"text":"fix it"}"#),
  ev(2, "tool_use", #"{"id":"a","name":"Bash","input":{"command":"ls"}}"#),
  ev(3, "tool_result", #"{"tool_use_id":"a","text":"x","is_error":false,"truncated":false}"#),
]

@MainActor @Suite struct ThreadStoreTests {
  @Test func loadsTheThreadThenStreamsFromItsLastEvent() async throws {
    let api = FakeThreadAPI(try detail(events: turn, artifacts: [artifact(1)], pending: [pendingMsg("held")], live: true, parent: row(id: "p1")))
    let (store, t, _) = makeStore(api)
    defer { store.stop() }
    #expect(store.loadState == .loading)
    try await waitFor("the load") { store.loadState == .loaded }
    #expect(store.thread?.title == "Fix cart")
    #expect(store.channel?.id == "acme")
    #expect(store.parent?.id == "p1")
    #expect(store.events.map(\.id) == [1, 2, 3])
    #expect(store.transcript.items.map(\.id) == [.event(1), .event(2)])
    #expect(store.artifacts.map(\.id) == [1])
    #expect(store.pending.map(\.state) == [.held])
    #expect(store.warm == true)
    #expect(store.running)

    let conn = try await t.next()
    #expect(conn.after == "3")
    #expect(!store.isReconnecting, "not while the first connection is under way")
    conn.accept()
    try await waitFor("open") { store.connection == .open }
    conn.send(sse(event: ev(4), id: 4))
    try await waitFor("the new event") { store.events.map(\.id) == [1, 2, 3, 4] }
    #expect(store.transcript.items.map(\.id) == [.event(1), .event(2), .event(4)])
  }

  @Test func keepsEachEventOnceAndInOrder() async throws {
    let api = FakeThreadAPI(try detail(events: turn))
    let (store, conn, _, _) = try await openStore(api)
    defer { store.stop() }
    conn.send(sse(event: ev(3, "tool_result", #"{"tool_use_id":"a","text":"x","is_error":false,"truncated":false}"#), id: 3))
    conn.send(sse(event: ev(6, "user", #"{"text":"again"}"#), id: 6))
    conn.send(sse(event: ev(5, "result", #"{"ok":true,"subtype":"success","turns":1}"#), id: 5))
    conn.send(sse(event: ev(6, "user", #"{"text":"again"}"#), id: 6))
    conn.send(sse(event: ev(4), id: 4))
    try await waitFor("every event") { store.events.count == 6 }
    await settle()
    #expect(store.events.map(\.id) == [1, 2, 3, 4, 5, 6])
    #expect(store.transcript.items == Transcript.build(store.events))
  }

  @Test func takesTheNewerThread() async throws {
    let api = FakeThreadAPI(try detail(row(updated: 10), pending: [pendingMsg("held")], live: true))
    let (store, conn, _, _) = try await openStore(api)
    defer { store.stop() }

    conn.send(sse(threadMessage(row("done", updated: 5), pending: [], live: false)))
    conn.send(sse(event: ev(1), id: 1))
    try await waitFor("the stream read") { store.events.count == 1 }
    #expect(store.thread?.status == .running, "an older row is dropped")
    #expect(store.pending.count == 1, "with its pending messages")
    #expect(store.warm == true)

    conn.send(sse(threadMessage(row(updated: 10, title: "Same time"), pending: [pendingMsg("sent")])))
    try await waitFor("a tie applies") { store.thread?.title == "Same time" }
    #expect(store.pending.map(\.state) == [.sent])
    #expect(store.warm == true, "live left out keeps what we had")

    #expect(!store.merge(try decode(OmniThread.self, row(updated: 10, title: "Reply")), isReply: true), "a reply loses a tie")
    #expect(store.thread?.title == "Same time")
    #expect(store.merge(try decode(OmniThread.self, row("done", updated: 11, title: "Reply")), isReply: true))
    #expect(store.thread?.status == .done)
    #expect(!store.running)
    #expect(!store.merge(try decode(OmniThread.self, row("done", updated: 99, id: "other"))), "another thread's row")
  }

  @Test func refetchesTheThreadAfterAReconnect() async throws {
    let api = FakeThreadAPI(try detail(events: turn, artifacts: [artifact(1)]))
    let (store, conn, t, clock) = try await openStore(api)
    defer { store.stop() }
    await settle()
    #expect(api.calls("thread") == 1, "the first open loads nothing more")

    conn.end()
    try await waitFor("reconnecting") { store.isReconnecting }
    api.detail = .success(try detail(row("done", updated: 20), events: turn + [ev(4), ev(5, "result", #"{"ok":true,"subtype":"success","turns":1}"#)],
                                     artifacts: [artifact(1), artifact(2, kind: "markdown")], children: [row(id: "c1", parent: "t1")]))
    clock.advance(by: .seconds(1))
    let again = try await t.next()
    #expect(again.after == "3")
    again.accept()
    try await waitFor("the missed events") { store.events.map(\.id) == [1, 2, 3, 4, 5] }
    #expect(!store.isReconnecting)
    #expect(api.calls("thread") == 2)
    #expect(store.thread?.status == .done)
    #expect(store.artifacts.map(\.id) == [1, 2])
    #expect(store.children.map(\.id) == ["c1"])
    #expect(store.transcript.items == Transcript.build(store.events))
    #expect(store.refreshError == nil)
  }

  @Test func keepsWhatTheStreamBroughtWhileTheRefetchWasOut() async throws {
    let api = FakeThreadAPI(try detail(artifacts: [artifact(1), artifact(2, updated: 1)]))
    let (store, conn, t, clock) = try await openStore(api)
    defer { store.stop() }
    conn.end()
    try await waitFor("reconnecting") { store.isReconnecting }

    // The refetch answers with what the server had before the stream said more.
    let gate = api.holdNext()
    api.detail = .success(try detail(artifacts: [artifact(1), artifact(2, updated: 9)]))
    clock.advance(by: .seconds(1))
    let again = try await t.next()
    again.accept()
    try await waitFor("the refetch") { api.calls("thread") == 2 }
    again.send(sse(#"{"kind":"artifact","artifact":\#(artifact(2, updated: 5))}"#))
    again.send(sse(#"{"kind":"artifact","artifact":\#(artifact(3, kind: "markdown"))}"#))
    try await waitFor("the new artifact") { store.artifacts.map(\.id) == [1, 2, 3] }
    #expect(store.artifacts[1].updatedAt == base.addingTimeInterval(5))

    gate.open()
    try await waitFor("the answer applied") { store.artifacts.first(where: { $0.id == 2 })?.updatedAt == base.addingTimeInterval(9) }
    #expect(store.artifacts.map(\.id) == [1, 2, 3], "an artifact the answer predates stays")
  }

  @Test func showsABurstInOneUpdate() async throws {
    let api = FakeThreadAPI(try detail(events: turn))
    let (store, conn, _, clock) = try await openStore(api, frame: .milliseconds(16))
    defer { store.stop() }
    conn.send(sse(event: ev(4), id: 4) + sse(event: ev(5), id: 5) + sse(threadMessage(row("done", updated: 3))))
    await settle()
    #expect(store.events.count == 3, "nothing shows before the frame ends")
    #expect(store.running)
    // The stream reads on its own task, so a slow machine may split the burst: move time until it is all in.
    try await waitFor("the burst") {
      clock.advance(by: .milliseconds(16))
      return store.events.count == 5 && !store.running
    }
  }

  @Test func appliesWhatCameBeforeTheConnectionDropped() async throws {
    let api = FakeThreadAPI(try detail(events: turn))
    let (store, conn, _, _) = try await openStore(api, frame: .seconds(60))
    defer { store.stop() }
    conn.send(sse(event: ev(4), id: 4))
    await settle()
    conn.end()
    try await waitFor("reconnecting") { store.isReconnecting }
    #expect(store.events.count == 4, "a state change flushes first")
  }

  @Test func saysWhenTheThreadIsGone() async throws {
    let api = FakeThreadAPI()
    api.detail = .failure(.http(status: 404, message: "not found"))
    let (store, t, _) = makeStore(api)
    defer { store.stop() }
    try await waitFor("not found") { store.loadState == .notFound }
    await settle()
    #expect(t.count == 0, "no stream for a thread that is not there")
  }

  @Test func triesAgainAfterAFailedLoad() async throws {
    let api = FakeThreadAPI()
    api.detail = .failure(.unreachable("refused"))
    let (store, t, _) = makeStore(api)
    defer { store.stop() }
    try await waitFor("the error") { store.loadState == .failed(.unreachable("refused")) }
    #expect(t.count == 0)

    api.detail = .success(try detail(events: turn))
    await store.reload()
    #expect(store.loadState == .loaded)
    #expect(store.events.count == 3)
    #expect(try await t.next().after == "3")
  }

  @Test func keepsTheThreadUpWhenARefetchFails() async throws {
    let api = FakeThreadAPI(try detail(events: turn))
    let (store, _, _, _) = try await openStore(api)
    defer { store.stop() }
    api.detail = .failure(.http(status: 500, message: "boom"))
    await store.reload()
    #expect(store.loadState == .loaded)
    #expect(store.refreshError == .http(status: 500, message: "boom"))
    #expect(store.events.count == 3)

    api.detail = .success(try detail(events: turn))
    await store.reload()
    #expect(store.refreshError == nil)
  }

  @Test func interruptsUntilTheTurnEnds() async throws {
    let api = FakeThreadAPI(try detail(events: turn))
    let (store, conn, _, _) = try await openStore(api)
    defer { store.stop() }
    #expect(!store.interrupting)
    await store.interrupt()
    #expect(api.calls("stop") == 1)
    #expect(store.stopping)
    #expect(store.interrupting)

    conn.send(sse(event: ev(4, "result", #"{"ok":false,"subtype":"error_during_execution","stopped":true,"turns":1}"#), id: 4))
    try await waitFor("a new result ends it") { !store.stopping }
    #expect(store.running, "the thread can run on with queued messages")

    await store.interrupt()
    conn.send(sse(threadMessage(row("stopped", updated: 5))))
    try await waitFor("the thread stopping ends it") { !store.stopping }
  }

  @Test func givesUpInterruptingAfterFifteenSeconds() async throws {
    let api = FakeThreadAPI(try detail(events: turn))
    let (store, _, _, clock) = try await openStore(api)
    defer { store.stop() }
    await store.interrupt()
    clock.advance(by: .milliseconds(14_999))
    await settle()
    #expect(store.stopping)
    clock.advance(by: .milliseconds(1))
    try await waitFor("the timer") { !store.stopping }
  }

  @Test func showsModToastsUntilTheyTimeOut() async throws {
    let api = FakeThreadAPI(try detail(events: turn))
    let (store, conn, _, clock) = try await openStore(api)
    defer { store.stop() }
    for n in 1...4 {
      conn.send(sse(#"{"kind":"mod_toast","thread_id":"t1","plugin":"omni-tool","text":"toast \#(n)","timeout_ms":\#(n * 1000)}"#))
    }
    try await waitFor("the toasts") { store.toasts.last?.toast.text == "toast 4" }
    #expect(store.toasts.map(\.toast.text) == ["toast 2", "toast 3", "toast 4"], "three at most, the newest")
    #expect(store.events.count == 3, "a toast is not a transcript event")
    await settle()
    clock.advance(by: .seconds(2))
    try await waitFor("the first times out") { store.toasts.map(\.toast.text) == ["toast 3", "toast 4"] }
    store.dismissToast(store.toasts[0].id)
    #expect(store.toasts.map(\.toast.text) == ["toast 4"])
    clock.advance(by: .seconds(2))
    try await waitFor("the last times out") { store.toasts.isEmpty }
  }

  @Test func saysWhyItCouldNotInterrupt() async throws {
    let api = FakeThreadAPI(try detail(events: turn))
    api.stop = .failure(.http(status: 404, message: "not found"))
    let (store, _, _, _) = try await openStore(api)
    defer { store.stop() }
    await store.interrupt()
    #expect(!store.stopping)
    #expect(store.actionError == .http(status: 404, message: "not found"))
    api.stop = .success(())
    await store.interrupt()
    #expect(store.actionError == nil)
  }

  @Test func countsAnInterruptAndSendAsInterrupting() async throws {
    let api = FakeThreadAPI(try detail(events: turn, pending: [pendingMsg("sent", mode: "interrupt")]))
    let (store, _, _, _) = try await openStore(api)
    defer { store.stop() }
    #expect(store.interrupting)
    #expect(!store.stopping)
  }

  @Test func followsItsChildrenAndParentOnTheFeed() async throws {
    let api = FakeThreadAPI(try detail(children: [row("running", id: "c1", parent: "t1")], parent: row(id: "p1")))
    let (store, _, _, _) = try await openStore(api)
    defer { store.stop() }
    store.apply(feed: .thread(try decode(OmniThread.self, row("done", updated: 5, id: "c1", parent: "t1"))))
    store.apply(feed: .thread(try decode(OmniThread.self, row(id: "c2", parent: "t1"))))
    store.apply(feed: .thread(try decode(OmniThread.self, row("done", id: "p1", title: "Parent"))))
    store.apply(feed: .thread(try decode(OmniThread.self, row("done", updated: 50, title: "Not from the feed"))))
    store.apply(feed: .thread(try decode(OmniThread.self, row(id: "x", parent: "other"))))
    #expect(store.children.map(\.id) == ["c1", "c2"])
    #expect(store.children.first?.status == .done)
    #expect(store.parent?.title == "Parent")
    #expect(store.thread?.title == "Fix cart", "its own row comes on the stream, with pending messages")
  }

  @Test func pointsOutANewHTMLArtifact() async throws {
    let api = FakeThreadAPI(try detail(artifacts: [artifact(1), artifact(2, kind: "screenshot")]))
    let (store, conn, _, _) = try await openStore(api)
    defer { store.stop() }
    #expect(store.arrivedHTML == nil)
    #expect(store.files.map(\.id) == [1])
    #expect(store.screenshots.map(\.id) == [2])

    conn.send(sse(#"{"kind":"artifact","artifact":\#(artifact(1, updated: 3))}"#))
    conn.send(sse(#"{"kind":"artifact","artifact":\#(artifact(3, kind: "markdown"))}"#))
    try await waitFor("the artifacts") { store.artifacts.count == 3 }
    #expect(store.arrivedHTML == nil, "an update or another kind is not new HTML")
    conn.send(sse(#"{"kind":"artifact","artifact":\#(artifact(4))}"#))
    try await waitFor("the new page") { store.arrivedHTML?.id == 4 }
  }

  @Test(arguments: [
    ([] as [(Int, String)], nil as Int?),
    ([(1, "screenshot")], nil),
    ([(1, "html"), (2, "markdown"), (3, "screenshot")], 1),
    ([(1, "markdown"), (2, "csv"), (3, "screenshot")], 2),
    ([(1, "html"), (2, "html"), (3, "pdf")], 2),
  ])
  func picksTheArtifactToShowFirst(_ list: [(Int, String)], _ want: Int?) throws {
    let artifacts = try list.map { try decode(Artifact.self, artifact($0.0, kind: $0.1)) }
    #expect(ThreadStore.defaultArtifact(artifacts)?.id == want)
  }

  @Test func saysWhatTheTurnIsDoing() async throws {
    let api = FakeThreadAPI(try detail(events: [ev(1, "user", #"{"text":"go"}"#)]))
    let (store, conn, _, _) = try await openStore(api)
    defer { store.stop() }
    #expect(!store.betweenTurns)
    #expect(store.statusLabel == nil)
    #expect(store.workingLine == "Working")

    conn.send(sse(event: ev(2, "status", #"{"text":"Compacting the conversation"}"#), id: 2))
    try await waitFor("the status") { store.statusLabel == "Compacting the conversation" }
    #expect(store.workingLine == "Compacting the conversation")

    conn.send(sse(event: ev(3, "tool_use", #"{"id":"a","name":"Bash","input":{}}"#), id: 3))
    try await waitFor("the call") { store.events.count == 3 }
    #expect(store.workingLine == "Compacting the conversation", "a status stays up through the calls")

    conn.send(sse(event: ev(4, "result", #"{"ok":true,"subtype":"success","turns":1}"#), id: 4))
    conn.send(sse(threadMessage(row("done", updated: 9))))
    try await waitFor("the end") { !store.running }
    #expect(store.betweenTurns)
    #expect(store.workingLine == nil)
  }

  @Test func shortensPathsToTheFolderTheSessionStartedIn() async throws {
    let api = FakeThreadAPI(try detail(events: turn))
    let (store, conn, _, _) = try await openStore(api)
    defer { store.stop() }
    #expect(store.cwd == "/tmp/x", "the thread's folder before a session starts")
    conn.send(sse(event: ev(4, "init", #"{"model":"m","cwd":"/w/one","tools":1,"mcp":[]}"#), id: 4))
    conn.send(sse(event: ev(5, "init", #"{"model":"m","cwd":"/w/two","tools":1,"mcp":[]}"#), id: 5))
    try await waitFor("the sessions") { store.events.count == 5 }
    #expect(store.cwd == "/w/two")
  }

  @Test func closesTheStreamOnStop() async throws {
    let api = FakeThreadAPI(try detail(events: turn))
    let (store, conn, _, _) = try await openStore(api)
    store.stop()
    #expect(store.connection == .closed)
    try await waitFor("the connection dropped") { conn.isDropped }
  }

  @Test func closesTheStreamWhenLetGo() async throws {
    let api = FakeThreadAPI(try detail(events: turn))
    var (store, conn, _, _): (ThreadStore?, ScriptedSSETransport.Connection, ScriptedSSETransport, TestClock) = try await openStore(api)
    #expect(store?.connection == .open)
    store = nil
    try await waitFor("the connection dropped") { conn.isDropped }
  }

  @Test func sharesOneStorePerThread() async throws {
    let api = FakeThreadAPI(try detail(children: [], parent: nil))
    let t = ScriptedSSETransport(), clock = TestClock()
    var made: [String] = []
    let registry = ThreadStoreRegistry { id in
      made.append(id)
      return ThreadStore(id: id, api: api, clock: clock, frame: .zero) { after in
        OmniClient(port: 4799).threadEvents(id, after: after, transport: t, clock: clock)
      }
    }
    let a = registry.acquire("t1")
    let b = registry.acquire("t1")
    #expect(a === b)
    #expect(made == ["t1"])
    try await waitFor("started") { a.loadState == .loaded }

    registry.apply(feed: .thread(try decode(OmniThread.self, row(id: "c9", parent: "t1"))))
    #expect(a.children.map(\.id) == ["c9"])

    registry.release("t1")
    #expect(registry.store("t1") === a, "still held once")
    registry.release("t1")
    #expect(registry.store("t1") == nil)
    #expect(a.connection == .closed)
    let c = registry.acquire("t1")
    #expect(c !== a)
    #expect(made == ["t1", "t1"])
    registry.release("t1")
    registry.release("t1")
  }
}
