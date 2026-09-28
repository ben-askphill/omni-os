import Foundation
import Testing
import OmniKit

/// /api/status the way servers before #76 answer it: no `server` object, so nothing to stop or watch.
private let oldStatus = #"{"usage":{},"slots":{},"running":0,"queued":0,"maxConcurrent":4,"maxUploadMb":25}"#

/// One app model with its own settings, record and log, a scripted feed and a REST side that answers empty lists.
/// The supervisor probes the real port.
@MainActor
private final class Rig {
  let dir = TempDir("appmodel")
  let settings: ServerSettings
  let sse = ScriptedSSETransport()
  let clock = TestClock()
  let http = StubTransport { req in
    StubTransport.Reply(body: req.url?.path == "/api/status" ? oldStatus : "[]")
  }
  private(set) lazy var model: AppModel = {
    let supervisor = ServerSupervisor(
      settings: settings,
      options: .init(logURL: dir.path("logs/server.log"), recordURL: dir.path("support/server.json"), probeTimeout: .milliseconds(500))
    )
    let http = self.http, sse = self.sse, clock = self.clock
    return AppModel(settings: settings, supervisor: supervisor) { port in
      let client = OmniClient(port: port, transport: http)
      return AppModel.Connection(client: client, store: WorkspaceStore(client: client, transport: sse, clock: clock))
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
    try await waitFor("not running", within: .seconds(3)) { model.supervisor.state == .notRunning }

    let server = HTTPResponder(contentType: "application/json", body: oldStatus)
    defer { server.close() }
    rig.settings.port = server.port
    let feed = try await rig.sse.next()
    #expect(feed.request.url == rig.feedURL(server.port))
    #expect(model.client.baseURL.port == server.port)
    #expect(oldStore.connection == .closed)
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
}
