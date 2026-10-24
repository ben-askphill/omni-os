import Foundation
import Synchronization
import Testing
import OmniKit

private let installToken = "install-token"
private let recordedCredential = "omni_s1.session-id.session-secret"

/// The auth routes as the recorded server answers them. GET /api/auth: the install token gets `auth-token.json`, the
/// live session `auth-session.json`, any other bearer 401. Finish answers 202 `pending` times first, then makes the
/// recorded credential the live session. Sign out ends the live session. The devices are `devices-signed-in.json`, less
/// the revoked ones; this Mac's (the recorded session's device) is `current` only when the live session asks.
private final class AuthServer: Sendable {
  final class State: Sendable {
    let live = Mutex<String?>(nil)
    let pending = Mutex(0)
    let refuseStart = Mutex<(status: Int, body: String)?>(nil)
    let down = Mutex(false)
    let googleOff = Mutex(false)
    let revoked = Mutex<Set<String>>([])
  }

  let state: State
  let transport: StubTransport

  init() {
    let state = State()
    self.state = state
    transport = StubTransport { req in
      if state.down.withLock({ $0 }) { throw URLError(.cannotConnectToHost) }
      let bearer = req.value(forHTTPHeaderField: "Authorization")?.replacingOccurrences(of: "Bearer ", with: "")
      let unauthorized = StubTransport.Reply(status: 401, body: #"{"error":"Unauthorized"}"#)
      let byToken = bearer == installToken
      let bySession = bearer != nil && bearer == state.live.withLock { $0 }
      func google(_ text: String) -> String {
        state.googleOff.withLock { $0 } ? text.replacingOccurrences(of: #""loopback": true"#, with: #""loopback": false"#) : text
      }
      let path = req.url?.path() ?? ""
      switch (req.httpMethod, path) {
      case ("GET", "/api/auth"):
        if byToken { return StubTransport.Reply(body: google(try fixture("auth-token.json"))) }
        if bySession { return StubTransport.Reply(body: google(try fixture("auth-session.json"))) }
        return unauthorized
      case ("GET", "/api/auth/devices"):
        guard byToken || bySession else { return unauthorized }
        guard case .array(let rows) = try json(try fixture("devices-signed-in.json")) else { return unauthorized }
        let gone = state.revoked.withLock { $0 }
        let shown: [JSONValue] = rows.compactMap { row in
          guard case .object(var o) = row, let id = o["id"]?.stringValue, !gone.contains(id) else { return nil }
          o["current"] = .bool(bySession && id == thisMac)
          return .object(o)
        }
        return StubTransport.Reply(body: String(decoding: try JSONEncoder().encode(shown), as: UTF8.self))
      case ("DELETE", _) where path.hasPrefix("/api/auth/devices/"):
        guard byToken || bySession else { return unauthorized }
        let id = String(path.dropFirst("/api/auth/devices/".count))
        let known = [thisMac, "00000000-0000-4000-8000-000000000038"].contains(id)
        guard known, state.revoked.withLock({ $0.insert(id).inserted }) else {
          return StubTransport.Reply(status: 404, body: #"{"error":"No such signed-in device."}"#)
        }
        if id == thisMac { state.live.withLock { $0 = nil } }
        return StubTransport.Reply(body: #"{"ok":true,"current":\#(bySession && id == thisMac)}"#)
      case ("POST", "/api/auth/google/start"):
        if let r = state.refuseStart.withLock({ $0 }) { return StubTransport.Reply(status: r.status, body: r.body) }
        return StubTransport.Reply(body: try fixture("signin-start.json"))
      case ("POST", "/api/auth/google/finish"):
        let wait = state.pending.withLock { n in
          defer { n = max(0, n - 1) }
          return n > 0
        }
        if wait { return StubTransport.Reply(status: 202, body: #"{"pending":true}"#) }
        state.live.withLock { $0 = recordedCredential }
        return StubTransport.Reply(body: try fixture("signin-finished.json"))
      case ("POST", "/api/auth/signout"):
        guard bySession else { return unauthorized }
        state.live.withLock { $0 = nil }
        state.revoked.withLock { _ = $0.insert(thisMac) }
        return StubTransport.Reply(body: try fixture("signout.json"))
      default:
        return StubTransport.Reply(status: 404, body: #"{"error":"not found"}"#)
      }
    }
  }

  var client: OmniClient { OmniClient(port: 4799, token: .fixed(installToken), transport: transport) }

  func asked(_ path: String) -> [URLRequest] { transport.requests.filter { $0.url?.path() == path } }
}

private func json(_ text: String) throws -> JSONValue {
  try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
}

/// The recorded session's device, "Ada's MacBook Pro".
private let thisMac = "00000000-0000-4000-8000-000000000037"

private let key = "127.0.0.1:4799"
private let callback = URL(string: "omni://signin?attempt=attempt-id")!

@MainActor @Suite struct AccountTests {
  private func model(_ server: AuthServer, store: MemorySessionStore = MemorySessionStore()) -> AccountModel {
    let account = AccountModel(sessions: store, deviceName: "Ada's MacBook Pro", retryDelay: .zero)
    account.connect(api: server.client, key: key)
    return account
  }

  // MARK: Client

  @Test func readsWhoTheTokenIs() async throws {
    let server = AuthServer()
    let auth = try await server.client.authState()
    #expect(auth.via == .token)
    #expect(auth.user == nil && auth.device == nil)
    #expect(auth.google.loopback && !auth.google.broker)
    let req = try #require(server.asked("/api/auth").first)
    #expect(req.httpMethod == "GET")
    #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer \(installToken)")
  }

  @Test func sendsTheSessionInPlaceOfTheToken() async throws {
    let server = AuthServer()
    server.state.live.withLock { $0 = recordedCredential }
    let auth = try await server.client.authState(session: SessionCredential(recordedCredential))
    #expect(auth.via == .session)
    #expect(auth.user?.email == "ada@example.com")
    #expect(auth.device?.kind == .mac)
    #expect(auth.google.allowedEmails == ["ada@example.com"])
    let req = try #require(server.asked("/api/auth").first)
    #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer \(recordedCredential)")
  }

  @Test func startsWithTheRecordedBody() async throws {
    let server = AuthServer()
    let start = try await server.client.startSignIn(deviceName: "Ada's MacBook Pro")
    #expect(start.attempt == "attempt-id")
    #expect(start.claim == "claim-secret")
    #expect(start.mode == .loopback)
    #expect(start.url.host() == "accounts.google.com")
    let req = try #require(server.asked("/api/auth/google/start").first)
    #expect(req.httpMethod == "POST")
    #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer \(installToken)")
    #expect(try bodyJSON(req) == json(try fixture("signin-start-request.json")))
  }

  @Test func finishesOnceGoogleHasAnswered() async throws {
    let server = AuthServer()
    server.state.pending.withLock { $0 = 1 }
    #expect(try await server.client.finishSignIn(attempt: "attempt-id", claim: "claim-secret") == nil)
    let done = try #require(try await server.client.finishSignIn(attempt: "attempt-id", claim: "claim-secret"))
    #expect(done.user.email == "ada@example.com")
    #expect(done.device.name == "Ada's MacBook Pro")
    #expect(done.claimed)
    #expect(done.credential == SessionCredential(recordedCredential))
    #expect(done.expiresAt == OmniJSON.parseDate("2026-01-05T09:00:00.000Z"))
    let req = try #require(server.asked("/api/auth/google/finish").first)
    #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer \(installToken)")
    #expect(try bodyJSON(req) == .object(["attempt": .string("attempt-id"), "claim": .string("claim-secret")]))
  }

  @Test func signsOutWithTheSession() async throws {
    let server = AuthServer()
    server.state.live.withLock { $0 = recordedCredential }
    try await server.client.signOut(session: SessionCredential(recordedCredential))
    let req = try #require(server.asked("/api/auth/signout").first)
    #expect(req.httpMethod == "POST")
    #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer \(recordedCredential)")
    #expect(try bodyJSON(req) == .object([:]))
    #expect(server.state.live.withLock { $0 } == nil)
  }

  @Test func listsDevicesWithTheSessionOrTheToken() async throws {
    let server = AuthServer()
    server.state.live.withLock { $0 = recordedCredential }
    let mine = try await server.client.signedInDevices(session: SessionCredential(recordedCredential))
    #expect(mine.map(\.name) == ["Ada's iMac", "Ada's MacBook Pro"])
    #expect(mine.map(\.current) == [false, true])
    let byToken = try await server.client.signedInDevices(session: nil)
    #expect(!byToken.contains { $0.current }, "the install token is no device")
    #expect(server.asked("/api/auth/devices").map { $0.value(forHTTPHeaderField: "Authorization") } == [
      "Bearer \(recordedCredential)", "Bearer \(installToken)",
    ])
  }

  @Test func revokesADeviceWithTheRecordedAnswer() async throws {
    let t = StubTransport(body: try fixture("device-revoked.json"))
    let client = OmniClient(port: 4799, token: .fixed(installToken), transport: t)
    let current = try await client.revokeDevice(id: "00000000-0000-4000-8000-000000000038", session: SessionCredential(recordedCredential))
    #expect(!current)
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "DELETE")
    #expect(req.url?.path() == "/api/auth/devices/00000000-0000-4000-8000-000000000038")
    #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer \(recordedCredential)")
    #expect(req.httpBody == nil)
  }

  @Test func saysWhenADeviceWasLastSeen() throws {
    let devices = try decodeFixture([SignedInDevice].self, "devices-signed-in.json")
    let utc = TimeZone(identifier: "UTC")!
    let fiveMinutesOn = try #require(OmniJSON.parseDate("2026-01-05T09:05:00.000Z"))
    #expect(devices[0].detail(now: fiveMinutesOn, timeZone: utc) == "ada@example.com · last seen 5m ago")
    #expect(devices[1].detail(now: fiveMinutesOn, timeZone: utc) == "ada@example.com · This device")
    #expect(devices[0].kind == .mac)
  }

  @Test func neverPrintsTheCredential() throws {
    let done = try decodeFixture(SignInFinished.self, "signin-finished.json")
    for text in ["\(done)", String(reflecting: done), "\(done.credential)"] {
      #expect(!text.contains("session-secret"), "\(text)")
    }
  }

  @Test func saysWhoMaySignIn() throws {
    func google(_ emails: [String], _ hd: String?) throws -> GoogleSignIn {
      let hdJSON = hd.map { "\"\($0)\"" } ?? "null"
      let list = emails.map { "\"\($0)\"" }.joined(separator: ",")
      return try OmniJSON.decoder().decode(
        GoogleSignIn.self, from: Data(#"{"loopback":true,"broker":false,"allowedEmails":[\#(list)],"allowedHd":\#(hdJSON)}"#.utf8))
    }
    #expect(try google([], nil).whoMaySignIn == "Nobody has signed in yet. The first Google account to sign in from this Mac owns this Omni.")
    #expect(try google(["ada@example.com"], nil).whoMaySignIn == "Who can sign in: ada@example.com.")
    #expect(try google([], "example.org").whoMaySignIn == "Who can sign in: anyone at example.org.")
    #expect(
      try google(["ada@example.com", "bob@example.com"], "example.org").whoMaySignIn
        == "Who can sign in: ada@example.com, bob@example.com and anyone at example.org.")
  }

  // MARK: Model

  @Test func signedOutUntilTheMacSignsIn() async {
    let server = AuthServer()
    let account = model(server)
    #expect(account.google == nil)
    #expect(!account.offersSignIn, "nothing is known before the server answers")
    await account.refresh()
    #expect(account.state == .signedOut)
    #expect(account.google?.loopback == true)
    #expect(account.offersSignIn)
  }

  @Test func signedInWithTheStoredSession() async throws {
    let server = AuthServer()
    server.state.live.withLock { $0 = recordedCredential }
    let account = model(server, store: MemorySessionStore([key: SessionCredential(recordedCredential)]))
    await account.refresh()
    guard case .signedIn(let user, let device) = account.state else {
      Issue.record("\(account.state)")
      return
    }
    #expect(user.email == "ada@example.com")
    #expect(device.name == "Ada's MacBook Pro")
    #expect(account.google?.allowedEmails == ["ada@example.com"])
    #expect(server.asked("/api/auth").map { $0.value(forHTTPHeaderField: "Authorization") } == ["Bearer \(recordedCredential)"])
  }

  @Test func dropsASessionTheServerNoLongerTakes() async {
    let server = AuthServer()
    let store = MemorySessionStore([key: SessionCredential("omni_s1.revoked.secret")])
    let account = model(server, store: store)
    await account.refresh()
    #expect(account.state == .signedOut)
    #expect(store.load(key) == nil)
    #expect(account.google?.loopback == true, "asked again with the install token")
  }

  @Test func keepsWhatItShowsWhileTheServerIsDown() async {
    let server = AuthServer()
    server.state.live.withLock { $0 = recordedCredential }
    let store = MemorySessionStore([key: SessionCredential(recordedCredential)])
    let account = model(server, store: store)
    await account.refresh()
    let shown = account.state
    server.state.down.withLock { $0 = true }
    await account.refresh()
    #expect(account.state == shown)
    #expect(store.load(key) != nil)
  }

  @Test func signsInThroughTheSheet() async throws {
    let server = AuthServer()
    server.state.pending.withLock { $0 = 2 }
    let store = MemorySessionStore()
    let account = model(server, store: store)
    await account.refresh()
    let opened = Mutex<URL?>(nil)
    await account.signIn { url in
      opened.withLock { $0 = url }
      return callback
    }
    guard case .signedIn(let user, _) = account.state else {
      Issue.record("\(account.state)")
      return
    }
    #expect(user.email == "ada@example.com")
    #expect(opened.withLock { $0 }?.host() == "accounts.google.com")
    #expect(store.load(key) == SessionCredential(recordedCredential))
    #expect(server.asked("/api/auth/google/finish").count == 3, "two pending answers, then the session")
    #expect(account.google?.allowedEmails == ["ada@example.com"], "the claim made Ada the allowlist")
  }

  @Test func givingUpOnTheSheetIsNoFailure() async {
    let server = AuthServer()
    let store = MemorySessionStore()
    let account = model(server, store: store)
    await account.signIn { _ in throw CancellationError() }
    #expect(account.state == .signedOut)
    #expect(store.load(key) == nil)
    #expect(server.asked("/api/auth/google/finish").isEmpty)
  }

  @Test func refusesACallbackForAnotherSignIn() async {
    let server = AuthServer()
    let account = model(server)
    await account.signIn { _ in URL(string: "omni://signin?attempt=someone-else")! }
    #expect(account.state == .failed("Google sent back another sign-in. Try again."))
    #expect(server.asked("/api/auth/google/finish").isEmpty)
  }

  @Test func showsTheServersRefusal() async {
    let server = AuthServer()
    server.state.refuseStart.withLock { $0 = (403, #"{"error":"The Mac app signs in with the install token."}"#) }
    let account = model(server)
    await account.signIn { _ in callback }
    #expect(account.state == .failed("The Mac app signs in with the install token."))
  }

  @Test func signsOut() async {
    let server = AuthServer()
    let store = MemorySessionStore()
    let account = model(server, store: store)
    await account.signIn { _ in callback }
    await account.signOut()
    #expect(account.state == .signedOut)
    #expect(store.load(key) == nil)
    #expect(server.state.live.withLock { $0 } == nil, "the server revoked the device")
    #expect(server.asked("/api/auth/signout").first?.value(forHTTPHeaderField: "Authorization") == "Bearer \(recordedCredential)")
  }

  @Test func signsOutHereWhenTheServerCannotBeTold() async {
    let server = AuthServer()
    let store = MemorySessionStore()
    let account = model(server, store: store)
    await account.signIn { _ in callback }
    server.state.down.withLock { $0 = true }
    await account.signOut()
    #expect(store.load(key) == nil)
    guard case .failed(let message) = account.state else {
      Issue.record("\(account.state)")
      return
    }
    #expect(message.hasPrefix("Signed out on this Mac."))
  }

  @Test func anotherServerStartsSignedOut() async {
    let server = AuthServer()
    let account = model(server)
    await account.signIn { _ in callback }
    #expect(account.offersSignIn)
    account.connect(api: AuthServer().client, key: "127.0.0.1:4800")
    #expect(account.state == .signedOut)
    #expect(account.google == nil)
  }

  @Test func listsTheDevicesWhileGoogleIsSetUp() async {
    let server = AuthServer()
    let account = model(server)
    await account.refresh()
    #expect(account.devices?.map(\.name) == ["Ada's iMac", "Ada's MacBook Pro"])
    #expect(account.devices?.contains { $0.current } == false, "asked with the install token")
    await account.signIn { _ in callback }
    #expect(account.devices?.first { $0.current }?.name == "Ada's MacBook Pro", "asked with this Mac's session")
  }

  @Test func listsNoDevicesWithoutGoogle() async {
    let server = AuthServer()
    server.state.googleOff.withLock { $0 = true }
    let account = model(server)
    await account.refresh()
    #expect(account.google?.loopback == false)
    #expect(account.devices == nil)
    #expect(server.asked("/api/auth/devices").isEmpty)
  }

  @Test func signsAnotherDeviceOut() async throws {
    let server = AuthServer()
    let account = model(server)
    await account.signIn { _ in callback }
    let imac = try #require(account.devices?.first { !$0.current })
    await account.revoke(imac)
    #expect(account.devices?.map(\.name) == ["Ada's MacBook Pro"])
    guard case .signedIn = account.state else {
      Issue.record("\(account.state)")
      return
    }
  }

  @Test func signingThisMacOutOfTheListSignsItOutHere() async throws {
    let server = AuthServer()
    let store = MemorySessionStore()
    let account = model(server, store: store)
    await account.signIn { _ in callback }
    let mine = try #require(account.devices?.first { $0.current })
    await account.revoke(mine)
    #expect(account.state == .signedOut)
    #expect(store.load(key) == nil)
    #expect(account.devices?.map(\.name) == ["Ada's iMac"])
    #expect(server.asked("/api/auth/signout").isEmpty, "the revoke already ended the session")
  }

  @Test func aDeviceAlreadyGoneLeavesTheList() async throws {
    let server = AuthServer()
    let account = model(server)
    await account.refresh()
    let imac = try #require(account.devices?.first)
    server.state.revoked.withLock { _ = $0.insert(imac.id) }
    await account.revoke(imac)
    #expect(account.devicesError == nil)
    #expect(account.devices?.map(\.name) == ["Ada's MacBook Pro"])
  }

  @Test func saysWhyADeviceStaysSignedIn() async throws {
    let server = AuthServer()
    let account = model(server)
    await account.refresh()
    let imac = try #require(account.devices?.first)
    server.state.down.withLock { $0 = true }
    await account.revoke(imac)
    #expect(account.devicesError == OmniAPIError.unreachable("").message)
    #expect(account.devices?.count == 2)
  }

  @Test func signingOutDropsThisMacFromTheList() async {
    let server = AuthServer()
    let account = model(server)
    await account.signIn { _ in callback }
    await account.signOut()
    #expect(account.devices?.map(\.name) == ["Ada's iMac"])
  }

  // MARK: QA

  @Test func qaFollowsTheRedirectsToTheApp() async throws {
    let t = StubTransport { req in
      let url = req.url!.absoluteString
      if url.hasPrefix("https://accounts.google.com") {
        return StubTransport.Reply(status: 302, contentType: nil, body: "", location: "http://127.0.0.1:4799/api/auth/google/callback?state=attempt-id&code=c")
      }
      return StubTransport.Reply(status: 302, contentType: nil, body: "", location: "omni://signin?attempt=attempt-id")
    }
    let start = try decodeFixture(SignInStart.self, "signin-start.json")
    let end = try await QASignIn.follow(start.url, hint: "ada@example.com", transport: t)
    #expect(end == callback)
    #expect(t.requests.first?.url?.absoluteString == start.url.absoluteString + "&login_hint=ada@example.com")
    #expect(t.requests.count == 2)
  }

  @Test func qaStopsWhereGoogleShowsAPage() async throws {
    let t = StubTransport(contentType: "text/html", body: "<h1>Choose an account</h1>")
    let start = try decodeFixture(SignInStart.self, "signin-start.json")
    await #expect(throws: QAScriptError.self) { try await QASignIn.follow(start.url, hint: "nobody@example.com", transport: t) }
  }
}
