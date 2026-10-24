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

/// A thread snapshot. `from`: the head page's first id, as `?history=recent` answers; nil for a server that sends
/// every row.
private func detail(
  _ thread: String = row(), events: [String] = [], artifacts: [String] = [], pending: [String] = [], live: Bool = false,
  children: [String] = [], parent: String? = nil, from: Int? = nil, resultsBelow: Int = 0
) throws -> ThreadDetail {
  let history = from.map { #","history":{"from":\#($0),"to":null,"results_below":\#(resultsBelow)}"# } ?? ""
  return try decode(ThreadDetail.self, """
    {"thread":\(thread),"channel":\(channelJSON),"events":[\(events.joined(separator: ","))],"artifacts":[\(artifacts.joined(separator: ","))],
     "children":[\(children.joined(separator: ","))],"parent":\(parent ?? "null"),"pending":[\(pending.joined(separator: ","))],"live":\(live)\(history)}
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
    var pages: [HistoryCursor: Result<HistoryPage, OmniAPIError>] = [:]
    var cursors: [HistoryCursor] = []
    var holdPage: Gate?
    var rows: [Int: EventRow] = [:]
    var handoff: Result<HandoffAnswer, OmniAPIError> = .failure(.unreachable("not set"))
    var handoffs: [String] = []
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

  /// The page each cursor answers with. A cursor with none fails.
  func setPage(_ cursor: HistoryCursor, _ page: Result<HistoryPage, OmniAPIError>) {
    state.withLock { $0.pages[cursor] = page }
  }
  /// The cursors the store asked for, in order.
  var cursors: [HistoryCursor] { state.withLock { $0.cursors } }
  /// The next page answers when the gate opens.
  func holdNextPage() -> Gate {
    let gate = Gate()
    state.withLock { $0.holdPage = gate }
    return gate
  }
  /// What `threadEvent` answers for each id.
  func setRow(_ row: EventRow) {
    state.withLock { $0.rows[row.id] = row }
  }

  func threadHistory(_ id: String, _ cursor: HistoryCursor) async throws(OmniAPIError) -> HistoryPage {
    let gate = state.withLock { s in
      s.calls["history", default: 0] += 1
      s.cursors.append(cursor)
      defer { s.holdPage = nil }
      return s.holdPage
    }
    await gate?.wait()
    return try state.withLock { $0.pages[cursor] ?? .failure(.http(status: 404, message: "no page")) }.get()
  }

  func threadEvent(_ id: String, eventID: Int) async throws(OmniAPIError) -> EventRow {
    state.withLock { $0.calls["event", default: 0] += 1 }
    guard let row = state.withLock({ $0.rows[eventID] }) else { throw .http(status: 404, message: "no event") }
    return row
  }

  /// The snapshot, newest page first: counted as "thread".
  func threadOpen(_ id: String) async throws(OmniAPIError) -> ThreadDetail {
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

  var handoff: Result<HandoffAnswer, OmniAPIError> {
    get { state.withLock { $0.handoff } }
    set { state.withLock { $0.handoff = newValue } }
  }

  /// The Macs the store asked to hand to, then "cancel" for each cancel.
  var handoffs: [String] { state.withLock { $0.handoffs } }

  func handOff(_ id: String, to: String) async throws(OmniAPIError) -> HandoffAnswer {
    state.withLock { $0.handoffs.append(to) }
    return try handoff.get()
  }

  func cancelHandoff(_ id: String) async throws(OmniAPIError) -> HandoffAnswer {
    state.withLock { $0.handoffs.append("cancel") }
    return try handoff.get()
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

  @Test func keepsTheNewestContextReading() async throws {
    let api = FakeThreadAPI(try detail(events: turn))
    let (store, conn, _, _) = try await openStore(api)
    defer { store.stop() }
    #expect(store.context == nil)
    for used in [30_000, 41_500] {
      conn.send(sse(#"{"kind":"context","context":{"used":\#(used),"max":200000,"source":"claude-stream","updated_at":"2026-10-10T08:00:00.000Z"}}"#))
    }
    try await waitFor("the reading") { store.context?.used == 41_500 }
    #expect(store.context?.source == "claude-stream")
    #expect(store.events.count == 3, "a reading is not a transcript event")
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

private func blockedDetail(_ thread: String = row(), handoff: String? = nil) throws -> ThreadDetail {
  try decode(ThreadDetail.self, #"{"thread":\#(thread),"events":[],"pending":[],"live":true,"handoff":\#(handoff ?? "null")}"#)
}

private func handoffAnswer(_ thread: String, _ state: String) throws -> HandoffAnswer {
  try decode(HandoffAnswer.self, #"{"thread":\#(thread),"handoff":\#(handoffJSON(state))}"#)
}

@MainActor @Suite struct ThreadStoreHandoffTests {
  @Test func canHandOffOnlyATurnRunningHere() async throws {
    let api = FakeThreadAPI(try blockedDetail())
    let (store, conn, _, _) = try await openStore(api)
    defer { store.stop() }
    #expect(store.canHandOff)

    conn.send(sse(#"{"kind":"thread","thread":\#(row(updated: 1)),"blocked":"This thread is running on Ben's MacBook Pro."}"#))
    try await waitFor("the block") { store.blocked != nil }
    #expect(!store.canHandOff)

    conn.send(sse(#"{"kind":"thread","thread":\#(row(updated: 2)),"handoff":\#(handoffJSON(#"{"phase":"preparing","step":"stopping"}"#))}"#))
    try await waitFor("the handoff") { store.handoff != nil }
    #expect(store.blocked == nil, "a thread message says the block is gone by leaving it out")
    #expect(!store.canHandOff, "not while one is under way")

    conn.send(sse(threadMessage(row("stopped", updated: 3))))
    try await waitFor("the stop") { store.thread?.status == .stopped }
    #expect(store.handoff == nil)
    #expect(!store.canHandOff)
  }

  @Test func anOlderThreadRowLeavesTheHandoffAsItWas() async throws {
    let api = FakeThreadAPI(try blockedDetail(row(updated: 10), handoff: handoffJSON(#"{"phase":"offered","stale":false}"#)))
    let (store, conn, _, _) = try await openStore(api)
    defer { store.stop() }
    conn.send(sse(threadMessage(row(updated: 5))))
    conn.send(sse(event: ev(1), id: 1))
    try await waitFor("the stream read") { store.events.count == 1 }
    #expect(store.handoff?.state == .offered(stale: false))
  }

  @Test func showsTheAnswerAtOnceAndTheRefusalAboveTheComposer() async throws {
    let api = FakeThreadAPI(try blockedDetail())
    let (store, _, _, _) = try await openStore(api)
    defer { store.stop() }

    api.handoff = .failure(.http(status: 409, message: "Ben's MacBook Pro is offline."))
    await store.handOff(to: "m-pro")
    #expect(store.actionError?.message == "Ben's MacBook Pro is offline.")
    #expect(store.handoff == nil)
    #expect(!store.handingOff)

    api.handoff = .success(try handoffAnswer(row(updated: 1), #"{"phase":"preparing","step":"stopping"}"#))
    await store.handOff(to: "m-pro")
    #expect(store.actionError == nil)
    #expect(store.handoff?.state == .preparing(.stopping))
    #expect(!store.canHandOff)

    api.handoff = .success(try handoffAnswer(row("stopped", updated: 2), #"{"phase":"cancelled"}"#))
    await store.cancelHandoff()
    #expect(store.handoff?.state == .cancelled)
    #expect(store.thread?.status == .stopped)
    #expect(api.handoffs == ["m-pro", "m-pro", "cancel"])
  }
}

private func text(_ id: Int, _ words: String = "ok") -> String { ev(id, "assistant_text", #"{"text":"\#(words)"}"#) }
private func ask(_ id: Int, _ words: String = "go") -> String { ev(id, "user", #"{"text":"\#(words)"}"#) }
private func done(_ id: Int) -> String { ev(id, "result", #"{"ok":true,"subtype":"success","turns":1}"#) }

/// A row a page cut down to size.
private func clippedRow(_ id: Int, _ kind: String, _ payload: String, bytes: Int = 90_000) -> String {
  let json = eventJSON(kind: kind, payload: payload, id: id)
  return String(json.dropLast()) + #","clipped":{"bytes":\#(bytes)}}"#
}

private func historyPage(_ rows: [String], from: Int, to: Int?) throws -> HistoryPage {
  try decode(HistoryPage.self, #"{"events":[\#(rows.joined(separator: ","))],"span":{"from":\#(from),"to":\#(to.map(String.init) ?? "null")}}"#)
}

@MainActor @Suite struct ThreadStoreHistoryTests {
  @Test func opensOnTheHeadThenLoadsEarlierRevealsAndJoinsTheStream() async throws {
    let api = FakeThreadAPI(try detail(events: [ask(50), text(51), done(52)], from: 50, resultsBelow: 2))
    let (store, conn, t, clock) = try await openStore(api)
    defer { store.stop() }
    #expect(api.calls("thread") == 1)
    #expect(store.history.spans == [HistorySpan(from: 50, to: nil)])
    #expect(!store.history.atStart)
    #expect(store.history.turnCount == 3)
    #expect(store.transcript.items.map(\.id) == [.event(50), .event(51), .event(52)])

    api.setPage(.newest(before: 50), .success(try historyPage([ask(20), text(21), done(22)], from: 20, to: 50)))
    await store.loadEarlier()
    #expect(api.cursors == [.newest(before: 50)])
    #expect(store.transcript.items.map(\.id) == [.event(20), .event(21), .event(22), .event(50), .event(51), .event(52)])
    #expect(store.loadingEdges.isEmpty)
    #expect(store.history.edges([20, 21, 22, 50]) == [20: .earlier])

    api.setPage(.at(2, before: 20), .success(try historyPage([ask(1), text(2, "the needle")], from: 0, to: 20)))
    await store.reveal(2)
    #expect(store.revealTarget == .event(2))
    #expect(store.history.atStart)
    store.revealShown()
    #expect(store.revealTarget == nil)

    conn.send(sse(event: text(53), id: 53))
    try await waitFor("the live row") { store.transcript.items.last?.id == .event(53) }

    conn.end()
    try await waitFor("reconnecting") { store.isReconnecting }
    api.detail = .success(try detail(events: [text(53), text(54)], from: 53, resultsBelow: 3))
    clock.advance(by: .seconds(1))
    let again = try await t.next()
    #expect(again.after == "53", "the stream resumes after the last row it sent")
    again.accept()
    try await waitFor("the fresh head") { store.events.last?.id == 54 }
    #expect(store.events.map(\.id) == [1, 2, 20, 21, 22, 50, 51, 52, 53, 54])
    #expect(store.history.spans == [HistorySpan(from: 0, to: nil)])
    try await waitFor("laid out") { store.transcript.items.last?.id == .event(54) }
    #expect(store.transcript.items == Transcript.build(store.events, spans: store.history.spans))
  }

  @Test func showsAFailedPageOnItsEdgeAndAsksOnceAtATime() async throws {
    let api = FakeThreadAPI(try detail(events: [ask(50), text(51)], from: 50))
    let (store, _, _, _) = try await openStore(api)
    defer { store.stop() }

    await store.loadEarlier()
    #expect(store.edgeErrors[.earlier] != nil)
    #expect(store.loadingEdges.isEmpty)

    api.setPage(.newest(before: 50), .success(try historyPage([ask(1), text(2)], from: 0, to: 50)))
    let gate = api.holdNextPage()
    async let first: Void = store.loadEarlier()
    try await waitFor("asking") { store.loadingEdges == [.earlier] }
    #expect(store.edgeErrors[.earlier] == nil, "a retry clears the error")
    await store.loadEarlier()
    #expect(api.calls("history") == 2, "one request per edge")
    gate.open()
    await first
    #expect(store.history.atStart)
    #expect(store.transcript.items.map(\.id) == [.event(1), .event(2), .event(50), .event(51)])
  }

  @Test func loadsAClippedRowWhole() async throws {
    let call = ev(50, "tool_use", #"{"id":"a","name":"Bash","input":{"command":"ls"}}"#)
    let api = FakeThreadAPI(try detail(events: [
      call, clippedRow(51, "tool_result", #"{"tool_use_id":"a","text":"cut…","is_error":false,"truncated":true}"#),
      clippedRow(52, "assistant_text", #"{"text":"long…"}"#, bytes: 1_500_000),
    ], from: 50))
    let (store, _, _, _) = try await openStore(api)
    defer { store.stop() }
    #expect(store.clipped.keys.sorted() == [51, 52])
    #expect(store.clipped[52]?.bytes == 1_500_000)
    #expect(store.clippedResults == ["a": 51])

    api.setRow(try decode(EventRow.self, text(52, "the whole reply")))
    await store.showAll(52)
    #expect(store.clipped.keys.sorted() == [51])
    #expect(store.showingAll.isEmpty)
    #expect(store.transcript.items.last == .text(eventID: 52, at: store.events.last!.createdAt, "the whole reply"))

    await store.showAll(51)
    #expect(store.showAllErrors[51] != nil, "the server had no such row")
    #expect(store.clipped[51] != nil)
  }

  @Test func handsARevealToTheStoreItMakes() async throws {
    let api = FakeThreadAPI(try detail(events: [ask(50), text(51)], from: 50))
    api.setPage(.at(2, before: 50), .success(try historyPage([ask(1), text(2)], from: 0, to: 50)))
    let t = ScriptedSSETransport(), clock = TestClock()
    let client = OmniClient(port: 4799)
    let registry = ThreadStoreRegistry { id in
      ThreadStore(id: id, api: api, clock: clock, frame: .zero) { after in client.threadEvents(id, after: after, transport: t, clock: clock) }
    }
    registry.reveal("t1", at: 2)
    let store = registry.acquire("t1")
    defer { registry.release("t1") }
    try await waitFor("the hit") { store.revealTarget == .event(2) }
    #expect(api.cursors == [.at(2, before: 50)])

    api.setPage(.at(1, before: 2), .success(try historyPage([], from: 0, to: 2)))
    registry.reveal("t1", at: 51)
    try await waitFor("a hit already held") { store.revealTarget == .event(51) }
    #expect(api.cursors.count == 1, "nothing to load")
  }
}
