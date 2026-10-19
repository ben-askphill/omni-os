import Foundation
import Testing
import OmniKit

/// /api/status the way servers before #76 answer it: no `server` object, so nothing to stop or watch.
private let oldStatus = #"{"usage":{},"slots":{},"running":0,"queued":0,"maxConcurrent":4,"maxUploadMb":25}"#

private func threadRow(_ id: String, parent: String? = nil, title: String) -> String {
  """
  {"id":"\(id)","channel_id":"acme","title":"\(title)","status":"running","role":null,"model":null,"harness":"claude-code",
   "effort":"","session_id":null,"has_run":1,"cwd":null,"branch":null,"parent_id":\(parent.map { "\"\($0)\"" } ?? "null"),
   "task_id":null,"source":"manual","automation":null,"last_text":null,"created_at":"2026-09-28T07:57:15Z","updated_at":"2026-09-28T07:58:00Z"}
  """.replacingOccurrences(of: "\n", with: "")
}

private let parentThread = threadRow("p1", title: "Fix the cart")

/// One app model with its own settings, record and log, a scripted feed and a REST side that answers empty lists.
/// The supervisor probes the real port.
@MainActor
private final class Rig {
  let dir = TempDir("appmodel")
  let settings: ServerSettings
  let sse = ScriptedSSETransport()
  let clock = TestClock()
  let http = StubTransport { req in
    switch req.url?.path {
    case "/api/status": StubTransport.Reply(body: oldStatus)
    case "/api/threads/p1": StubTransport.Reply(body: #"{"thread":\#(parentThread),"events":[]}"#)
    case "/api/sync/now": StubTransport.Reply(status: 409, body: #"{"error":"sync is not configured"}"#)
    default: StubTransport.Reply(body: "[]")
    }
  }
  private(set) lazy var model: AppModel = {
    let supervisor = ServerSupervisor(
      settings: settings,
      options: .init(logURL: dir.path("logs/server.log"), recordURL: dir.path("support/server.json"), probeTimeout: .milliseconds(500))
    )
    let http = self.http, sse = self.sse, clock = self.clock
    return AppModel(settings: settings, supervisor: supervisor) { port in
      let client = OmniClient(port: port, transport: http)
      return AppModel.Connection(
        client: client, store: WorkspaceStore(api: client, clock: clock),
        threads: ThreadStoreRegistry(client: client, transport: sse),
        feed: AppFeed(source: client.feedEvents(transport: sse, clock: clock)))
    }
  }()

  init(port: Int) {
    let defaults = UserDefaults(suiteName: "appmodel-\(UUID().uuidString)")!
    settings = ServerSettings(defaults: defaults, arguments: [:])
    settings.port = port
    dir.write("repo/README.md", "not an Omni checkout")
    settings.repoPath = dir.path("repo").path
  }

  var repo: String { dir.path("repo").path }

  func feedURL(_ port: Int) -> URL { URL(string: "http://127.0.0.1:\(port)/api/feed")! }

  deinit { dir.remove() }
}

@MainActor
@Suite(.serialized)
struct AppModelTests {
  @Test func showsTheServerScreenWhenNothingAnswers() async throws {
    let port = freePort()
    let rig = Rig(port: port)
    let model = rig.model
    model.launch()
    #expect(model.serverScreen == .looking(port: port))

    let feed = try await rig.sse.next()
    #expect(feed.request.url == rig.feedURL(port))
    feed.refuse()
    try await waitFor("not running", within: .seconds(3)) { model.supervisor.state == .notRunning }
    #expect(model.serverScreen == .notRunning(port: port, repo: rig.repo))
    try await waitFor("reconnecting") { model.connectionNotice == "Reconnecting" }
  }

  @Test func showsTheRouteWhenAServerAnswers() async throws {
    let server = HTTPResponder(contentType: "application/json", body: oldStatus)
    defer { server.close() }
    let rig = Rig(port: server.port)
    let model = rig.model
    model.launch()
    try await waitFor("running", within: .seconds(3)) { model.supervisor.isRunning }
    #expect(model.serverScreen == nil)
    #expect(model.supervisor.state.label == "Started outside the app")
  }

  @Test func keepsAFailedStartOnScreenUntilTheSettingsChange() async throws {
    let port = freePort()
    let rig = Rig(port: port)
    let model = rig.model
    model.launch()
    try await rig.sse.next().refuse()

    await model.startServer()
    let message = ServerStartError.repoMissing(path: rig.repo).message
    #expect(model.serverScreen == .failed(message: message, logTail: []))

    // Coming back to the app checks again, which finds nothing on the port. The failure stays.
    model.didBecomeActive()
    try await waitFor("not running", within: .seconds(3)) { model.supervisor.state == .notRunning }
    #expect(model.serverScreen == .failed(message: message, logTail: []))

    rig.settings.repoPath = rig.dir.path("other").path
    try await waitFor("the failure cleared", within: .seconds(3)) {
      model.serverScreen == .notRunning(port: port, repo: rig.dir.path("other").path)
    }
  }

  @Test func aBlankRepoShowsTheCheckoutItStandsFor() async throws {
    let port = freePort()
    let rig = Rig(port: port)
    let model = rig.model
    rig.settings.repoPath = ""
    model.launch()
    try await rig.sse.next().refuse()
    try await waitFor("not running", within: .seconds(3)) { model.supervisor.state == .notRunning }
    #expect(model.serverScreen == .notRunning(port: port, repo: ServerSettings.defaultRepoPath))
  }

  @Test func startAttachesToAServerThatAnswersAndReconnectsTheFeedAtOnce() async throws {
    let port = freePort()
    let rig = Rig(port: port)
    let model = rig.model
    model.launch()
    try await rig.sse.next().refuse()
    try await waitFor("not running", within: .seconds(3)) { model.supervisor.state == .notRunning }

    // The server came up some other way: Start attaches instead of starting a second one.
    let server = HTTPResponder(port: port, contentType: "application/json", body: oldStatus)
    defer { server.close() }
    await model.startServer()
    #expect(model.supervisor.state == .running(startedByApp: false, server: nil))
    // The feed waits out its backoff on a clock that never moves, unless Start skips the wait.
    let feed = try await rig.sse.next()
    #expect(feed.request.url == rig.feedURL(port))
    #expect(model.serverScreen == nil)
  }

  @Test func aPortChangeConnectsToTheNewPort() async throws {
    let first = freePort()
    let rig = Rig(port: first)
    let model = rig.model
    model.launch()
    let old = try await rig.sse.next()
    let oldStore = model.store
    let oldThreads = model.threads
    try await waitFor("not running", within: .seconds(3)) { model.supervisor.state == .notRunning }

    let server = HTTPResponder(contentType: "application/json", body: oldStatus)
    defer { server.close() }
    rig.settings.port = server.port
    let feed = try await rig.sse.next()
    #expect(feed.request.url == rig.feedURL(server.port))
    #expect(model.client.baseURL.port == server.port)
    #expect(oldStore.connection == .closed)
    #expect(model.threads !== oldThreads, "thread stores follow the port too")
    #expect(old.isAnswered)
    try await waitFor("running on the new port", within: .seconds(3)) { model.supervisor.isRunning }
    #expect(model.supervisor.port == server.port)
    #expect(model.serverScreen == nil)
  }

  @Test func comingBackToTheAppReconnectsOnlyAQuietFeed() async throws {
    let server = HTTPResponder(contentType: "application/json", body: oldStatus)
    defer { server.close() }
    let rig = Rig(port: server.port)
    let model = rig.model
    model.launch()
    let first = try await rig.sse.next()
    first.accept()
    try await waitFor("open") { model.store.connection == .open }

    model.didBecomeActive()
    await settle()
    #expect(!first.isDropped)
    #expect(rig.sse.count == 1)

    rig.clock.advance(by: .seconds(26))
    model.didBecomeActive()
    try await waitFor("dropped") { first.isDropped }
    let second = try await rig.sse.next()
    #expect(second.request.url == rig.feedURL(server.port))
  }

  @Test func aNetworkChangeOrAWakeReconnectsAtOnce() async throws {
    let server = HTTPResponder(contentType: "application/json", body: oldStatus)
    defer { server.close() }
    let rig = Rig(port: server.port)
    let model = rig.model
    model.launch()
    let first = try await rig.sse.next()
    first.accept()
    try await waitFor("open") { model.store.connection == .open }

    model.networkChanged()
    try await waitFor("dropped") { first.isDropped }
    let second = try await rig.sse.next()
    second.accept()
    try await waitFor("open again") { model.store.connection == .open }

    model.didWake()
    try await waitFor("dropped after the wake") { second.isDropped }
    _ = try await rig.sse.next()
  }

  @Test func aWakeOrANetworkChangeAsksTheServerToSync() async throws {
    let rig = Rig(port: freePort())
    let model = rig.model
    let syncs = { rig.http.requests.filter { $0.httpMethod == "POST" && $0.url?.path == "/api/sync/now" }.count }
    #expect(syncs() == 0)

    // The rig's server has sync off and answers 409. That is nothing to show.
    model.didWake()
    try await waitFor("a sync after the wake") { syncs() == 1 }
    model.networkChanged()
    try await waitFor("a sync after the network change") { syncs() == 2 }

    model.didBecomeActive()
    await settle()
    #expect(syncs() == 2, "coming to the front alone does not")
  }

  @Test func aDroppedFeedChecksTheServerAgain() async throws {
    let server = HTTPResponder(contentType: "application/json", body: oldStatus)
    let rig = Rig(port: server.port)
    let model = rig.model
    model.launch()
    let feed = try await rig.sse.next()
    feed.accept()
    try await waitFor("running", within: .seconds(3)) { model.supervisor.isRunning && model.store.connection == .open }

    // The server goes away. It was not started by the app and says no pid, so only the feed notices.
    server.close()
    feed.end()
    try await waitFor("not running", within: .seconds(3)) { model.supervisor.state == .notRunning }
    #expect(model.serverScreen == .notRunning(port: server.port, repo: rig.repo))
    #expect(model.connectionNotice == "Reconnecting")
  }

  @Test func feedsTheThreadOnScreenAndNamesItForTheSidebar() async throws {
    let rig = Rig(port: freePort())
    let model = rig.model
    model.launch()
    let feed = try await rig.sse.next()
    feed.accept()
    try await waitFor("open") { model.store.connection == .open }

    model.route = .thread(id: "p1")
    #expect(model.openThread == nil, "not loaded yet")
    #expect(model.title == "Thread")
    let store = model.threads.acquire("p1")
    defer { model.threads.release("p1") }
    try await waitFor("the thread") { store.loadState == .loaded }
    #expect(model.openThread?.id == "p1")
    #expect(model.openThread?.channelID == "acme")
    #expect(model.title == "Fix the cart")

    feed.send("data: {\"type\":\"thread\",\"thread\":\(threadRow("c1", parent: "p1", title: "Check it"))}\n\n")
    try await waitFor("the child") { store.children.map(\.id) == ["c1"] }

    model.route = .home
    #expect(model.openThread == nil)
    #expect(model.title == "Home")
  }

  @Test func copiesTheThreadOnScreenAsMarkdownOnceItLoads() async throws {
    let rig = Rig(port: freePort())
    let model = rig.model
    model.route = .thread(id: "p1")
    #expect(model.openThreadMarkdown == nil, "no store yet")
    let store = model.threads.acquire("p1")
    defer { model.threads.release("p1") }
    #expect(model.openThreadMarkdown == nil, "not loaded yet")
    try await waitFor("the thread") { store.loadState == .loaded }
    #expect(model.openThreadMarkdown == "# Fix the cart\n")

    model.route = .home
    #expect(model.openThreadMarkdown == nil)
  }

  @Test func anOpenFeedChecksTheServerAgain() async throws {
    let port = freePort()
    let rig = Rig(port: port)
    let model = rig.model
    model.launch()
    let first = try await rig.sse.next()
    first.refuse()
    try await waitFor("not running", within: .seconds(3)) { model.supervisor.state == .notRunning }

    // Ben starts the server in a terminal; the feed gets through first.
    let server = HTTPResponder(port: port, contentType: "application/json", body: oldStatus)
    defer { server.close() }
    model.networkChanged()
    try await rig.sse.next().accept()
    try await waitFor("running", within: .seconds(3)) { model.supervisor.isRunning }
    #expect(model.serverScreen == nil)
    #expect(model.connectionNotice == nil)
  }

  @Test func twoScreensShareOneFeed() async throws {
    let port = freePort()
    let rig = Rig(port: port)
    let model = rig.model
    model.launch()
    let feed = try await rig.sse.next()
    #expect(feed.request.url == rig.feedURL(port))
    feed.accept()
    try await waitFor("open") { model.store.connection == .open }

    let first = ArtifactsStore(client: model.client) { _ in ("Cart", "acme") }
    let second = ArtifactsStore(client: model.client) { _ in ("Cart", "acme") }
    first.start()
    second.start()
    await settle()
    #expect(rig.sse.count == 1, "opening Artifacts does not open another /api/feed")
    try await waitFor("the galleries loaded") { first.loadState == .loaded && second.loadState == .loaded }

    feed.send(
      "data: {\"type\":\"artifact\",\"artifact\":{\"id\":7,\"thread_id\":\"t1\",\"path\":\"/x/7\",\"name\":\"a.html\",\"kind\":\"html\",\"size\":10,\"created_at\":\"2026-09-28T07:57:15Z\",\"updated_at\":\"2026-09-28T07:57:15Z\"}}\n\n"
    )
    try await waitFor("both screens") {
      first.gallery.items.map(\.id) == [7] && second.gallery.items.map(\.id) == [7]
    }

    feed.send(
      "data: {\"type\":\"tasks\",\"tasks\":[{\"thread_id\":\"t1\",\"channel_id\":\"acme\",\"task_id\":\"task-1\",\"description\":\"Check the cart\",\"background\":true,\"started_at\":\"2026-09-28T07:57:15Z\"}]}\n\n"
    )
    try await waitFor("the agents") { model.store.tasks.map(\.description) == ["Check the cart"] }

    first.stop()
    second.stop()
    await settle()
    #expect(rig.sse.count == 1)
    #expect(model.store.connection == .open, "closing Artifacts leaves the app's feed up")
  }
}
