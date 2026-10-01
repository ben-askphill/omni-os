import Foundation
import Synchronization
import Testing
import OmniKit

private let start = Date(timeIntervalSince1970: 1_790_582_400)

/// A time `minutes` after a fixed start, as the server prints it.
private func iso(_ minutes: Int) -> String {
  ISO8601DateFormatter().string(from: start.addingTimeInterval(Double(minutes) * 60))
}

/// A GET /api/channels row. Its `active` threads are listed oldest first.
func channelRow(_ id: String, kind: String = "client", running: Int = 0, active: [String] = []) -> String {
  let stubs = active.enumerated().map { i, t in
    #"{"id":"\#(t)","channel_id":"\#(id)","title":"\#(t)","status":"running","created_at":"\#(iso(i))"}"#
  }
  return """
    {"id":"\(id)","name":"\(id)","kind":"\(kind)","repo_path":null,"github_repo":null,"use_worktree":0,"base_dir":null,
     "store_domain":null,"portal_slug":null,"browser_headless":0,"notes":null,"archived":0,"created_at":"\(iso(0))",
     "running":\(running),"active":[\(stubs.joined(separator: ","))]}
    """
}

func channelList(_ rows: String...) throws -> [ChannelWithRunning] {
  try decode([ChannelWithRunning].self, "[\(rows.joined(separator: ","))]")
}

private func thread(_ id: String, status: String = "running", updated: Int) throws -> OmniThread {
  try decode(OmniThread.self, """
    {"id":"\(id)","channel_id":"acme","title":"\(id)","status":"\(status)","role":null,"model":null,"harness":"claude-code",
     "effort":"","session_id":null,"has_run":0,"cwd":null,"branch":null,"parent_id":null,"task_id":null,"source":"manual",
     "automation":null,"last_text":null,"created_at":"\(iso(0))","updated_at":"\(iso(updated))"}
    """)
}

private func usage(_ utilization: Double) throws -> Usage {
  try decode(Usage.self, #"{"five_hour":{"utilization":\#(utilization),"resetsAt":1790600000},"status":"allowed"}"#)
}

private func status(running: Int = 0, usage: String = "{}") throws -> Status {
  try decode(Status.self, #"{"usage":\#(usage),"slots":{},"running":\#(running),"queued":0,"maxConcurrent":4,"maxUploadMb":25}"#)
}

/// The server's REST side, answering with whatever the test set last.
final class FakeWorkspaceAPI: WorkspaceAPI {
  private struct State {
    var channels: Result<[ChannelWithRunning], OmniAPIError> = .success([])
    var status: Status?
    var crew: [CrewRole] = []
    var recent: [OmniThread] = []
    var harnesses: [HarnessInfo] = []
    var tasks: [BackgroundTask] = []
    var calls: [String: Int] = [:]
    var recentLimits: [Int?] = []
    var channelsHold: Gate?
    var recentHold: Gate?
  }
  private let state = Mutex(State())

  init() {}

  /// A workspace like the fixtures: Conductor and acme, the recorded status, crew and harnesses, one recent thread.
  static func standard() throws -> FakeWorkspaceAPI {
    let api = FakeWorkspaceAPI()
    api.channels = .success(try channelList(channelRow("conductor", kind: "system"), channelRow("acme")))
    api.status = try decodeFixture(Status.self, "status.json")
    api.crew = try decodeFixture([CrewRole].self, "crew.json")
    api.recent = [try thread("t0", updated: 1)]
    api.harnesses = try decodeFixture([HarnessInfo].self, "harnesses.json")
    return api
  }

  var channels: Result<[ChannelWithRunning], OmniAPIError> {
    get { state.withLock { $0.channels } }
    set { state.withLock { $0.channels = newValue } }
  }
  var status: Status? {
    get { state.withLock { $0.status } }
    set { state.withLock { $0.status = newValue } }
  }
  var crew: [CrewRole] {
    get { state.withLock { $0.crew } }
    set { state.withLock { $0.crew = newValue } }
  }
  var recent: [OmniThread] {
    get { state.withLock { $0.recent } }
    set { state.withLock { $0.recent = newValue } }
  }
  var harnesses: [HarnessInfo] {
    get { state.withLock { $0.harnesses } }
    set { state.withLock { $0.harnesses = newValue } }
  }
  var recentLimits: [Int?] { state.withLock { $0.recentLimits } }

  func calls(_ endpoint: String) -> Int { state.withLock { $0.calls[endpoint, default: 0] } }

  var allCalls: [String: Int] { state.withLock { $0.calls } }

  /// The next channels call answers with the list set now, but only once the gate opens.
  func holdNextChannels() -> Gate {
    let gate = Gate()
    state.withLock { $0.channelsHold = gate }
    return gate
  }

  /// The next recent call answers with the list set now, but only once the gate opens.
  func holdNextRecent() -> Gate {
    let gate = Gate()
    state.withLock { $0.recentHold = gate }
    return gate
  }

  func channels(archived: Bool) async throws(OmniAPIError) -> [ChannelWithRunning] {
    let (reply, gate) = state.withLock { s in
      s.calls["channels", default: 0] += 1
      defer { s.channelsHold = nil }
      return (s.channels, s.channelsHold)
    }
    await gate?.wait()
    return try reply.get()
  }

  func status() async throws(OmniAPIError) -> Status {
    let reply = state.withLock { s in
      s.calls["status", default: 0] += 1
      return s.status
    }
    guard let reply else { throw .unreachable("no status") }
    return reply
  }

  func crew() async throws(OmniAPIError) -> [CrewRole] {
    state.withLock { s in
      s.calls["crew", default: 0] += 1
      return s.crew
    }
  }

  func recent(limit: Int?) async throws(OmniAPIError) -> [OmniThread] {
    let (reply, gate) = state.withLock { s in
      s.calls["recent", default: 0] += 1
      s.recentLimits.append(limit)
      defer { s.recentHold = nil }
      return (s.recent, s.recentHold)
    }
    await gate?.wait()
    return reply
  }

  func harnesses() async throws(OmniAPIError) -> [HarnessInfo] {
    state.withLock { s in
      s.calls["harnesses", default: 0] += 1
      return s.harnesses
    }
  }

  func tasks() async throws(OmniAPIError) -> [BackgroundTask] {
    state.withLock { s in
      s.calls["tasks", default: 0] += 1
      return s.tasks
    }
  }
}

private let endpoints = ["channels", "status", "crew", "recent", "harnesses", "tasks"]

@MainActor
private func makeStore(
  _ api: FakeWorkspaceAPI
) -> (WorkspaceStore, AsyncStream<SSEEvent<FeedEvent>>.Continuation, TestClock) {
  let clock = TestClock()
  let (events, feed) = AsyncStream<SSEEvent<FeedEvent>>.makeStream()
  let store = WorkspaceStore(api: api, feed: events, clock: clock)
  store.start()
  return (store, feed, clock)
}

@MainActor
private func loaded(_ store: WorkspaceStore, _ api: FakeWorkspaceAPI) async throws {
  try await waitFor("the first load") {
    let s = store.snapshot
    return store.loadState == .loaded && s.status != nil && !s.crew.isEmpty && !s.recent.isEmpty && !s.harnesses.isEmpty
      && api.calls("tasks") >= 1
  }
}

@MainActor @Suite struct WorkspaceStoreTests {
  @Test func loadsTheWorkspaceOnStart() async throws {
    let api = try FakeWorkspaceAPI.standard()
    let (store, feed, _) = makeStore(api)
    defer { store.stop(); feed.finish() }
    #expect(store.loadState == .loading)
    #expect(store.connection == .connecting)

    try await loaded(store, api)
    let s = store.snapshot
    #expect(s.channels.map(\.id) == ["conductor", "acme"])
    #expect(s.channel("acme")?.kind == .client)
    #expect(s.status?.running == 1)
    #expect(s.usage[.claudeCode]?.fiveHour != nil)
    #expect(s.crew.map(\.id).contains("conductor"))
    #expect(s.recent.map(\.id) == ["t0"])
    #expect(s.harnesses.map(\.id) == [.claudeCode, .codex, .cursor, .hermes])
    #expect(api.recentLimits == [60])
    for e in endpoints { #expect(api.calls(e) == 1, "\(e)") }
  }

  @Test func saysWhyTheChannelsDidNotLoad() async throws {
    let api = try FakeWorkspaceAPI.standard()
    api.channels = .failure(.unreachable("refused"))
    let (store, feed, _) = makeStore(api)
    defer { store.stop(); feed.finish() }
    try await waitFor("the error") { store.loadState == .failed(.unreachable("refused")) }

    api.channels = .success(try channelList(channelRow("acme")))
    await store.refresh()
    #expect(store.loadState == .loaded)
    #expect(store.snapshot.channels.map(\.id) == ["acme"])

    api.channels = .failure(.http(status: 500, message: "boom"))
    await store.reloadChannels()
    #expect(store.loadState == .failed(.http(status: 500, message: "boom")))
    #expect(store.snapshot.channels.map(\.id) == ["acme"], "the last list stays up")
  }

  @Test func followsTheFeedConnection() async throws {
    let (store, feed, _) = makeStore(try FakeWorkspaceAPI.standard())
    defer { store.stop(); feed.finish() }
    feed.yield(.state(.open))
    try await waitFor("open") { store.connection == .open }
    feed.yield(.state(.reconnecting(attempt: 2, nextDelay: .seconds(2))))
    try await waitFor("reconnecting") { store.connection == .reconnecting(attempt: 2, nextDelay: .seconds(2)) }
  }

  @Test func refetchesCountsOnceAfterABurstOfThreadEvents() async throws {
    let api = try FakeWorkspaceAPI.standard()
    let (store, feed, clock) = makeStore(api)
    defer { store.stop(); feed.finish() }
    try await loaded(store, api)
    feed.yield(.state(.open))
    #expect(store.snapshot.channel("acme")?.running == 0)

    api.channels = .success(try channelList(channelRow("conductor", kind: "system"), channelRow("acme", running: 2, active: ["t2", "t3"])))
    for i in 1...3 {
      feed.yield(.message(.thread(try thread("t\(i)", updated: 10 + i))))
    }
    try await waitFor("the events read") { store.snapshot.recent.first?.id == "t3" }
    clock.advance(by: .milliseconds(499))
    await settle()
    #expect(api.calls("channels") == 1)
    #expect(api.calls("status") == 1)

    clock.advance(by: .milliseconds(1))
    try await waitFor("the counts") { store.snapshot.channel("acme")?.running == 2 }
    #expect(store.snapshot.channel("acme")?.active.map(\.id) == ["t2", "t3"])
    #expect(api.calls("channels") == 2)
    try await waitFor("the status") { api.calls("status") == 2 }
    for e in ["crew", "recent", "harnesses"] { #expect(api.calls(e) == 1, "\(e)") }

    feed.yield(.message(.thread(try thread("t4", updated: 20))))
    try await waitFor("the next event read") { store.snapshot.recent.first?.id == "t4" }
    clock.advance(by: .milliseconds(500))
    try await waitFor("the next refetch") { api.calls("channels") == 3 }
  }

  @Test func storesTasksFromTheFeed() async throws {
    let api = try FakeWorkspaceAPI.standard()
    let (store, feed, _) = makeStore(api)
    defer { store.stop(); feed.finish() }
    try await loaded(store, api)
    let running = try decode([BackgroundTask].self, """
      [{"thread_id":"t1","channel_id":"acme","task_id":"task-1","tool_use_id":"tu1","description":"Check the cart","background":true,
        "started_at":"2026-09-28T07:57:15Z","last_tool":"Read","tool_uses":2}]
      """)
    feed.yield(.message(.tasks(running)))
    try await waitFor("the agents") { store.tasks == running }
    #expect(store.snapshot.tasks.map(\.description) == ["Check the cart"])

    feed.yield(.message(.tasks([])))
    try await waitFor("cleared") { store.tasks.isEmpty }
  }

  @Test func passesEachFeedMessageOn() async throws {
    let (store, feed, _) = makeStore(try FakeWorkspaceAPI.standard())
    defer { store.stop(); feed.finish() }
    var got: [FeedEvent] = []
    store.onFeed = { got.append($0) }
    let t = try thread("t1", updated: 1)
    feed.yield(.state(.open))
    feed.yield(.message(.thread(t)))
    feed.yield(.message(.unknown(.string("x"))))
    try await waitFor("both messages") { got.count == 2 }
    #expect(got == [.thread(t), .unknown(.string("x"))])
  }

  @Test func keepsRecentThreadsInStepWithTheFeed() async throws {
    let api = try FakeWorkspaceAPI.standard()
    api.recent = [try thread("t1", updated: 10), try thread("t2", updated: 9)]
    let (store, feed, _) = makeStore(api)
    defer { store.stop(); feed.finish() }
    try await loaded(store, api)
    #expect(store.snapshot.recent.map(\.id) == ["t1", "t2"])

    feed.yield(.message(.thread(try thread("t2", status: "done", updated: 11))))
    try await waitFor("t2 moved up") { store.snapshot.recent.map(\.id) == ["t2", "t1"] }
    #expect(store.snapshot.recent.first?.status == .done)

    feed.yield(.message(.thread(try thread("t3", updated: 1))))
    try await waitFor("t3 added") { store.snapshot.recent.map(\.id) == ["t2", "t1", "t3"] }
  }

  @Test func keepsSixtyRecentThreads() async throws {
    let api = try FakeWorkspaceAPI.standard()
    api.recent = try (0..<60).map { try thread("r\($0)", updated: 200 - $0) }
    let (store, feed, _) = makeStore(api)
    defer { store.stop(); feed.finish() }
    try await loaded(store, api)

    feed.yield(.message(.thread(try thread("new", updated: 300))))
    try await waitFor("the new thread") { store.snapshot.recent.first?.id == "new" }
    #expect(store.snapshot.recent.count == 60)
    #expect(store.snapshot.recent.last?.id == "r58")
  }

  @Test func mergesUsageFromTheStatusAndTheFeed() async throws {
    let api = try FakeWorkspaceAPI.standard()
    api.status = try status(usage: #"{"claude-code":{"five_hour":{"utilization":0.1,"resetsAt":1790600000}}}"#)
    let (store, feed, _) = makeStore(api)
    defer { store.stop(); feed.finish() }
    try await loaded(store, api)
    #expect(store.snapshot.usage[.claudeCode]?.fiveHour?.utilization == 0.1)

    feed.yield(.message(.usage(harness: .codex, usage: try usage(0.3))))
    try await waitFor("codex usage") { store.snapshot.usage[.codex] != nil }
    feed.yield(.message(.usage(harness: .claudeCode, usage: try usage(0.5))))
    try await waitFor("claude usage") { store.snapshot.usage[.claudeCode]?.fiveHour?.utilization == 0.5 }

    api.status = try status(usage: #"{"claude-code":{"five_hour":{"utilization":0.6,"resetsAt":1790600000}},"codex":null}"#)
    await store.refresh()
    #expect(store.snapshot.usage[.claudeCode]?.fiveHour?.utilization == 0.6)
    #expect(store.snapshot.usage[.codex] == (try usage(0.3)), "a status without it keeps the feed's")

    feed.yield(.message(.usage(harness: .codex, usage: nil)))
    try await waitFor("codex cleared") { store.snapshot.usage[.codex] == nil }
  }

  @Test func refetchesEverythingAfterAReconnect() async throws {
    let api = try FakeWorkspaceAPI.standard()
    let (store, feed, _) = makeStore(api)
    defer { store.stop(); feed.finish() }
    try await loaded(store, api)
    feed.yield(.state(.open))
    try await waitFor("open") { store.connection == .open }
    await settle()
    for e in endpoints { #expect(api.calls(e) == 1, "the first open loads nothing more: \(e)") }

    api.channels = .success(try channelList(channelRow("conductor", kind: "system", running: 1), channelRow("acme", running: 3)))
    api.recent = [try thread("t9", updated: 50)]
    feed.yield(.state(.reconnecting(attempt: 1, nextDelay: .seconds(1))))
    feed.yield(.state(.open))
    try await waitFor("the missed changes") {
      store.snapshot.channel("acme")?.running == 3 && store.snapshot.recent.map(\.id) == ["t9"]
    }
    try await waitFor("every endpoint again") { endpoints.allSatisfy { api.calls($0) == 2 } }
  }

  @Test func loadsAgainWhenTheServerComesUp() async throws {
    let api = try FakeWorkspaceAPI.standard()
    api.channels = .failure(.unreachable("refused"))
    let (store, feed, _) = makeStore(api)
    defer { store.stop(); feed.finish() }
    try await waitFor("the error") { store.loadState == .failed(.unreachable("refused")) }

    api.channels = .success(try channelList(channelRow("acme")))
    feed.yield(.state(.reconnecting(attempt: 1, nextDelay: .seconds(1))))
    feed.yield(.state(.open))
    try await waitFor("loaded") { store.loadState == .loaded }
    try await waitFor("every endpoint again") { endpoints.allSatisfy { api.calls($0) == 2 } }
  }

  @Test func keepsTheNewestChannelsWhenLoadsOverlap() async throws {
    let api = try FakeWorkspaceAPI.standard()
    let (store, feed, _) = makeStore(api)
    defer { store.stop(); feed.finish() }
    try await loaded(store, api)

    let gate = api.holdNextChannels()
    api.channels = .success(try channelList(channelRow("acme", running: 1)))
    let slow = Task { await store.reloadChannels() }
    try await waitFor("the slow call") { api.calls("channels") == 2 }
    api.channels = .success(try channelList(channelRow("acme", running: 2)))
    await store.reloadChannels()
    #expect(store.snapshot.channel("acme")?.running == 2)

    gate.open()
    await slow.value
    #expect(store.snapshot.channel("acme")?.running == 2, "the older answer is dropped")
  }

  @Test func keepsFeedThreadsThatComeInWhileRecentLoads() async throws {
    let api = try FakeWorkspaceAPI.standard()
    api.recent = [try thread("x", updated: 1)]
    let (store, feed, _) = makeStore(api)
    defer { store.stop(); feed.finish() }
    try await loaded(store, api)

    // The refetch on a feed reopen: the server answers with x still running, then x ends and the feed
    // says so before the answer lands.
    let gate = api.holdNextRecent()
    let slow = Task { await store.refresh() }
    try await waitFor("the slow call") { api.calls("recent") == 2 }
    feed.yield(.message(.thread(try thread("x", status: "done", updated: 9))))
    feed.yield(.message(.thread(try thread("y", updated: 8))))
    try await waitFor("the events read") { store.snapshot.recent.map(\.id) == ["x", "y"] }

    gate.open()
    await slow.value
    #expect(store.snapshot.recent.map(\.id) == ["x", "y"])
    #expect(store.snapshot.recent.first?.status == .done, "the older answer does not undo the feed")
  }

  @Test func aRecentAnswerNewerThanTheFeedWins() async throws {
    let api = try FakeWorkspaceAPI.standard()
    api.recent = [try thread("x", updated: 1)]
    let (store, feed, _) = makeStore(api)
    defer { store.stop(); feed.finish() }
    try await loaded(store, api)

    // The query ran after the event, so its row is the newer one.
    let gate = api.holdNextRecent()
    let fetched = try thread("x", status: "done", updated: 12)
    api.recent = [fetched]
    let slow = Task { await store.refresh() }
    try await waitFor("the slow call") { api.calls("recent") == 2 }
    let event = try thread("x", updated: 9)
    feed.yield(.message(.thread(event)))
    try await waitFor("the event read") { store.snapshot.recent == [event] }

    gate.open()
    await slow.value
    #expect(store.snapshot.recent == [fetched])
  }

  @Test func readsTheServerFeed() async throws {
    let files = ["/api/channels": "channels.json", "/api/status": "status.json", "/api/crew": "crew.json",
                 "/api/recent": "recent.json", "/api/harnesses": "harnesses.json"]
    let http = StubTransport { req in
      guard let name = files[req.url!.path()] else { return StubTransport.Reply(status: 404, body: #"{"error":"not found"}"#) }
      return StubTransport.Reply(body: try fixture(name))
    }
    let sse = ScriptedSSETransport(), clock = TestClock()
    let store = WorkspaceStore(client: OmniClient(port: 4799, transport: http), transport: sse, clock: clock)
    store.start()
    defer { store.stop() }

    let first = try await sse.next()
    #expect(first.request.url?.absoluteString == "http://127.0.0.1:4799/api/feed")
    first.accept()
    try await waitFor("open") { store.connection == .open }
    try await waitFor("loaded") { store.loadState == .loaded && !store.snapshot.harnesses.isEmpty }
    let channelCalls = { http.requests.filter { $0.url?.path() == "/api/channels" }.count }
    #expect(channelCalls() == 1)

    first.send(try fixture("feed.sse"))
    let threads = try FixtureTests.feed().compactMap { if case .thread(let t) = $0 { t } else { nil } }
    let last = try #require(threads.last)
    try await waitFor("the feed's threads") { store.snapshot.recent.contains(last) }

    store.reconnectNow()
    try await waitFor("the old connection dropped") { first.isDropped }
    try await sse.next().accept()
    try await waitFor("open again") { store.connection == .open }
    try await waitFor("the refetch") { channelCalls() == 2 }

    store.stop()
    #expect(store.connection == .closed)
  }
}

@Suite struct SidebarSectionsTests {
  @Test func groupsChannelsByKind() throws {
    let sections = SidebarSections(try channelList(
      channelRow("conductor", kind: "system", running: 2),
      channelRow("acme"),
      channelRow("ops", kind: "internal"),
      channelRow("lab", kind: "lab"),
      channelRow("beta"),
      channelRow("inbox", kind: "system"),
    ))
    #expect(sections.conductor?.running == 2)
    #expect(sections.groups.map(\.label) == ["Clients", "Internal"], "an empty group is left out")
    #expect(sections.groups.map(\.kind) == [.client, .internal])
    #expect(sections.groups.first?.channels.map(\.id) == ["acme", "beta"])
    #expect(sections.other.map(\.id) == ["lab", "inbox"])
  }

  @Test func listsFiveThreadsNewestFirst() throws {
    let c = try #require(try channelList(channelRow("acme", active: ["a", "b", "c", "d", "e", "f", "g"])).first)
    let links = SidebarSections.threads(of: c)
    #expect(links.shown.map(\.id) == ["g", "f", "e", "d", "c"])
    #expect(links.more == 2)
  }

  @Test func theHighlightedChannelListsItsRecentThreads() throws {
    let recent = (0..<5).map { i in #"{"id":"r\#(i)","channel_id":"acme","title":"r\#(i)","status":"done","created_at":"\#(iso(i + 1))"}"# }
    var row = channelRow("acme", active: ["a"])
    row.removeLast()
    row += #","recent":[\#(recent.joined(separator: ","))]}"#
    let c = try #require(try channelList(row).first)
    let quiet = SidebarSections.threads(of: c)
    #expect(quiet.shown.map(\.id) == ["a"], "finished threads stay hidden until the channel is highlighted")
    #expect(!quiet.seeAll)
    let focused = SidebarSections.threads(of: c, focused: true)
    #expect(focused.shown.map(\.id) == ["r4", "r3", "r2", "r1", "r0"])
    #expect(focused.seeAll)
    #expect(focused.more == 0)
  }

  @Test func keepsTheOpenThreadListed() throws {
    let c = try #require(try channelList(channelRow("acme", active: ["a", "b", "c", "d", "e", "f", "g"])).first)
    let a = try #require(c.active.first)
    let links = SidebarSections.threads(of: c, open: a)
    #expect(links.shown.map(\.id) == ["g", "f", "e", "d", "c", "a"])
    #expect(links.more == 1)

    let done = try decode(ThreadStub.self, #"{"id":"z","channel_id":"acme","title":"z","status":"done","created_at":"2026-01-01T00:00:00Z"}"#)
    #expect(SidebarSections.threads(of: c, open: done).shown.last?.id == "z", "it stays after it stops")
    let elsewhere = try decode(ThreadStub.self, #"{"id":"y","channel_id":"ops","title":"y","status":"running","created_at":"2026-01-01T00:00:00Z"}"#)
    #expect(!SidebarSections.threads(of: c, open: elsewhere).shown.contains { $0.id == "y" })
  }
}
