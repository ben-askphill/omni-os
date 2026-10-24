import Foundation
import Synchronization
import Testing
import OmniKit

private let installToken = "install-token"
private let recordedCredential = "omni_s1.session-id.session-secret"

/// The auth routes as the recorded server answers them. GET /api/auth: the install token gets `auth-token.json`, the
/// live session `auth-session.json`, any other bearer 401. Finish answers 202 `pending` times first, then makes the
/// recorded credential the live session. Sign out ends the live session.
private final class AuthServer: Sendable {
  final class State: Sendable {
    let live = Mutex<String?>(nil)
    let pending = Mutex(0)
    let refuseStart = Mutex<(status: Int, body: String)?>(nil)
    let down = Mutex(false)
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
      switch (req.httpMethod, req.url?.path()) {
      case ("GET", "/api/auth"):
        if bearer == installToken { return StubTransport.Reply(body: try fixture("auth-token.json")) }
        if let bearer, bearer == state.live.withLock({ $0 }) { return StubTransport.Reply(body: try fixture("auth-session.json")) }
        return unauthorized
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
        guard let bearer, bearer == state.live.withLock({ $0 }) else { return unauthorized }
        state.live.withLock { $0 = nil }
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
