import Foundation
import Synchronization
import Testing
import OmniKit

private func statusJSON(_ patch: [String: String] = [:]) throws -> String {
  var json = try fixture("sync-status.json")
  for (key, value) in patch {
    json = json.replacingOccurrences(
      of: #""\#(key)": [^,\n]+"#, with: #""\#(key)": \#(value)"#, options: .regularExpression)
  }
  return json
}

/// The /api/sync routes as the server answers them. A failure set for a path answers every write to it.
private final class SyncServer: Sendable {
  private struct State {
    var status: String
    var map = #"{"map":{}}"#
    var setup = #"{"state":"signed_in","email":"ben@example.com"}"#
    var failures: [String: (status: Int, body: String)] = [:]
  }

  private final class Box: Sendable {
    let state: Mutex<State>
    init(_ state: State) { self.state = Mutex(state) }
  }

  private let box: Box
  let transport: StubTransport

  init() throws {
    let box = Box(State(status: try statusJSON()))
    self.box = box
    transport = StubTransport { req in
      let path = req.url!.path
      let s = box.state.withLock { $0 }
      if req.httpMethod != "GET", let f = s.failures[path] { return StubTransport.Reply(status: f.status, body: f.body) }
      switch (req.httpMethod ?? "GET", path) {
      case ("GET", "/api/sync/status"): return StubTransport.Reply(body: s.status)
      case (_, "/api/sync/path-map"): return StubTransport.Reply(body: s.map)
      case ("POST", "/api/sync/setup"): return StubTransport.Reply(body: s.setup)
      default: return StubTransport.Reply(body: #"{"ok":true,"status":\#(s.status)}"#)
      }
    }
  }

  func status(_ json: String) { box.state.withLock { $0.status = json } }
  func map(_ json: String) { box.state.withLock { $0.map = json } }
  func setup(_ json: String) { box.state.withLock { $0.setup = json } }
  func fail(_ path: String, _ status: Int, _ body: String) { box.state.withLock { $0.failures[path] = (status, body) } }

  var client: OmniClient { OmniClient(port: 4799, transport: transport) }
  var writes: [URLRequest] { transport.requests.filter { $0.httpMethod != "GET" } }
}

@Suite struct SyncStatusTests {
  @Test func decodesTheStatus() throws {
    let s = try OmniJSON.decoder().decode(SyncStatus.self, from: Data(try statusJSON().utf8))
    #expect(s.configured && s.enabled && !s.running && !s.signedOut)
    #expect(s.machineId == "3f9c2a1e7b4d")
    #expect(s.lastSyncAt == OmniJSON.parseDate("2026-09-28T09:15:02.123Z"))
    #expect(s.lastError == nil)
    #expect((s.pending, s.held, s.deferred, s.cursor) == (2, 0, 1, 418))
    #expect(s.phase == .waiting)
    #expect(s.phaseLabel == "Waiting to push")
    #expect(!s.needsSignIn)
  }

  @Test func phaseFollowsTheWebPage() throws {
    func phase(_ patch: [String: String]) throws -> SyncStatus.Phase {
      try OmniJSON.decoder().decode(SyncStatus.self, from: Data(try statusJSON(patch).utf8)).phase
    }
    #expect(try phase(["enabled": "false", "running": "true"]) == .paused)
    #expect(try phase(["running": "true", "lastError": #""relay down""#]) == .syncing)
    #expect(try phase(["lastError": #""relay down""#]) == .failing)
    #expect(try phase(["lastSyncAt": "null"]) == .starting)
    #expect(try phase(["pending": "0"]) == .upToDate)
  }

  @Test func signInShowsWhenOffOrSignedOut() throws {
    let off = try OmniJSON.decoder().decode(SyncStatus.self, from: Data(try statusJSON(["configured": "false"]).utf8))
    let out = try OmniJSON.decoder().decode(SyncStatus.self, from: Data(try statusJSON(["signedOut": "true"]).utf8))
    #expect(off.needsSignIn && out.needsSignIn)
  }
}

@Suite struct SyncClientTests {
  @Test func actionsPostAndReturnTheStatus() async throws {
    let server = try SyncServer()
    let c = server.client
    _ = try await c.syncNow()
    _ = try await c.disableSync()
    _ = try await c.disableSync(forget: true)
    _ = try await c.enableSync()
    let w = server.writes
    #expect(w.map { "\($0.httpMethod!) \($0.url!.path)" } == [
      "POST /api/sync/now", "POST /api/sync/disable", "POST /api/sync/disable", "POST /api/sync/enable",
    ])
    #expect(try bodyJSON(w[0]) == .object([:]))
    #expect(try bodyJSON(w[1]) == .object(["forget": .bool(false)]))
    #expect(try bodyJSON(w[2]) == .object(["forget": .bool(true)]))
  }

  @Test func setupSendsOnlyWhatIsGiven() async throws {
    let server = try SyncServer()
    server.setup(#"{"state":"code_sent","email":"ben@example.com"}"#)
    let r = try await server.client.setupSync(SyncSetup(url: "https://x.supabase.co", anonKey: "anon", email: "ben@example.com"))
    #expect(r == .codeSent(email: "ben@example.com"))
    let body = try bodyJSON(try #require(server.writes.first))
    #expect(body == .object(["url": .string("https://x.supabase.co"), "anonKey": .string("anon"), "email": .string("ben@example.com")]))
  }

  @Test func pathMapRoundTrips() async throws {
    let server = try SyncServer()
    server.map(#"{"map":{"/Users/ben/Code":"~/Projects"}}"#)
    #expect(try await server.client.syncPathMap() == ["/Users/ben/Code": "~/Projects"])
    _ = try await server.client.setSyncPathMap(["/a": "/b"])
    let put = try #require(server.writes.first)
    #expect(put.httpMethod == "PUT")
    #expect(try bodyJSON(put) == .object(["map": .object(["/a": .string("/b")])]))
  }

  @Test func aFailingRelayCarriesTheServerMessage() async throws {
    let server = try SyncServer()
    server.fail("/api/sync/now", 502, #"{"error":"relay down","status":{}}"#)
    await #expect(throws: OmniAPIError.http(status: 502, message: "relay down")) { try await server.client.syncNow() }
  }
}

@MainActor @Suite struct SyncModelTests {
  private func loaded(_ server: SyncServer) async -> SyncModel {
    let m = SyncModel(client: server.client)
    await m.load()
    return m
  }

  private func fill(_ m: SyncModel) {
    m.url = " https://x.supabase.co "
    m.anonKey = "anon"
    m.email = "ben@example.com"
  }

  @Test func loadsStatusAndPathMapSorted() async throws {
    let server = try SyncServer()
    server.map(#"{"map":{"/b":"~/b","/a":"~/a"}}"#)
    let m = await loaded(server)
    #expect(m.loadState == .loaded)
    #expect(m.status?.cursor == 418)
    #expect(m.mappings.map(\.from) == ["/a", "/b"])
    #expect(m.mappingsLoaded && !m.mappingsSaved)
  }

  @Test func anUnreachableServerFailsTheLoad() async {
    let m = SyncModel(client: OmniClient(port: 4799, transport: StubTransport { _ in throw URLError(.cannotConnectToHost) }))
    await m.load()
    #expect(m.loadState == .failed(OmniAPIError.unreachable("").message))
  }

  @Test func passwordSignInClearsThePassword() async throws {
    let server = try SyncServer()
    server.status(try statusJSON(["configured": "false"]))
    let m = await loaded(server)
    fill(m)
    #expect(!m.canSignIn)
    m.password = "hunter2 "
    #expect(m.canSignIn)
    #expect(m.signInTitle == "Sign In and Sync")
    server.status(try statusJSON())
    await m.signIn()
    let body = try bodyJSON(try #require(server.writes.first))
    #expect(body == .object([
      "url": .string("https://x.supabase.co"), "anonKey": .string("anon"), "email": .string("ben@example.com"),
      "password": .string("hunter2 "),
    ]))
    #expect(m.password.isEmpty)
    #expect(m.signInError == nil)
    #expect(m.status?.configured == true)
  }

  @Test func aRefusedPasswordStaysToFix() async throws {
    let server = try SyncServer()
    server.fail("/api/sync/setup", 401, #"{"error":"Invalid login credentials"}"#)
    let m = await loaded(server)
    fill(m)
    m.password = "wrong"
    await m.signIn()
    #expect(m.signInError == "Invalid login credentials")
    #expect(m.password == "wrong")
    #expect(!m.isSigningIn)
  }

  @Test func codeSignInEmailsACodeFirst() async throws {
    let server = try SyncServer()
    let m = await loaded(server)
    fill(m)
    m.method = .code
    #expect(m.needsCode && m.canSignIn)
    #expect(m.signInTitle == "Email Me a Code")
    server.setup(#"{"state":"code_sent","email":"ben@example.com"}"#)
    await m.signIn()
    #expect(m.codeSentTo == "ben@example.com")
    #expect(!m.needsCode && !m.canSignIn)

    m.code = " 123456 "
    server.setup(#"{"state":"signed_in","email":"ben@example.com"}"#)
    await m.signIn()
    let bodies = try server.writes.map(bodyJSON)
    guard case .object(let first) = bodies[0], case .object(let second) = bodies[1] else { Issue.record("not objects"); return }
    #expect(first["code"] == nil && first["password"] == nil)
    #expect(second["code"] == .string("123456"))
    #expect(second["password"] == nil)
    #expect(m.code.isEmpty && m.codeSentTo == nil)
  }

  @Test func anotherEmailAsksForANewCode() async throws {
    let server = try SyncServer()
    server.setup(#"{"state":"code_sent","email":"ben@example.com"}"#)
    let m = await loaded(server)
    fill(m)
    m.method = .code
    await m.signIn()
    #expect(m.codeSentTo != nil)
    m.email = "other@example.com"
    #expect(m.needsCode)
  }

  @Test func pauseResumeAndSignOut() async throws {
    let server = try SyncServer()
    let m = await loaded(server)
    server.status(try statusJSON(["enabled": "false"]))
    await m.togglePause()
    #expect(m.status?.phase == .paused)
    server.status(try statusJSON())
    await m.togglePause()
    await m.signOut()
    let w = server.writes
    #expect(w.map(\.url!.path) == ["/api/sync/disable", "/api/sync/enable", "/api/sync/disable"])
    #expect(try bodyJSON(w[2]) == .object(["forget": .bool(true)]))
    #expect(m.busy == nil)
  }

  @Test func aFailedSyncNowShowsWhyAndReloads() async throws {
    let server = try SyncServer()
    let m = await loaded(server)
    server.fail("/api/sync/now", 502, #"{"error":"relay down"}"#)
    server.status(try statusJSON(["lastError": #""relay down""#]))
    await m.syncNow()
    #expect(m.actionError == "relay down")
    #expect(m.status?.phase == .failing)
  }

  @Test func savesTheRowsWithText() async throws {
    let server = try SyncServer()
    let m = await loaded(server)
    m.addMapping()
    m.mappings[0].from = " /Users/ben/Code/ "
    m.mappings[0].to = "~/Projects"
    m.addMapping()
    m.addMapping()
    m.removeMapping(m.mappings[2].id)
    server.map(#"{"map":{"/Users/ben/Code":"~/Projects"}}"#)
    await m.saveMappings()
    let put = try #require(server.writes.first)
    #expect(try bodyJSON(put) == .object(["map": .object(["/Users/ben/Code/": .string("~/Projects")])]))
    #expect(m.mappings.map(\.from) == ["/Users/ben/Code"])
    #expect(m.mappingsSaved)
    m.mappings[0].to = "~/Elsewhere"
    #expect(!m.mappingsSaved)
  }

  @Test func aRefusedMapKeepsTheRows() async throws {
    let server = try SyncServer()
    let m = await loaded(server)
    m.addMapping()
    m.mappings[0].from = "relative"
    m.mappings[0].to = "~/x"
    server.fail("/api/sync/path-map", 400, #"{"error":"Paths start with / or ~"}"#)
    await m.saveMappings()
    #expect(m.mappingsError == "Paths start with / or ~")
    #expect(m.mappings.count == 1)
  }
}
