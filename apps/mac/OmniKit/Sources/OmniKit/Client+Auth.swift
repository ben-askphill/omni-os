import Foundation

// Sign in with Google (apps/server/auth-api.ts, sign-in.ts). The Mac app starts and finishes with the install token,
// and gets a session credential of its own, its identity in Devices. Every other call keeps the install token.

/// How a request got in: the install token, or a Google sign-in session.
public struct AccessVia: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let token: Self = "token"
  public static let session: Self = "session"
}

/// loopback: Google returns to this server. broker: Google returns to the OAuth broker, which sends the browser back.
public struct SignInMode: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let loopback: Self = "loopback"
  public static let broker: Self = "broker"
}

public struct AuthDeviceKind: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let browser: Self = "browser"
  public static let mac: Self = "mac"
}

/// A session credential (`omni_s1....`). Kept in the Keychain and sent as Bearer only by the auth calls. Prints
/// redacted, so a log or a dump never shows it.
public struct SessionCredential: Hashable, Sendable, Decodable, CustomStringConvertible, CustomDebugStringConvertible {
  public let value: String

  public init(_ value: String) { self.value = value }

  public init(from decoder: any Decoder) throws {
    value = try decoder.singleValueContainer().decode(String.self)
  }

  public var description: String { "SessionCredential(redacted)" }
  public var debugDescription: String { description }
}

public struct AuthUser: Decodable, Hashable, Sendable {
  public let email: String
  public let name: String?

  enum CodingKeys: String, CodingKey { case email, name }
}

/// The browser or Mac a session belongs to.
public struct AuthDevice: Decodable, Hashable, Sendable {
  public let id: String
  public let name: String
  public let kind: AuthDeviceKind

  enum CodingKeys: String, CodingKey { case id, name, kind }
}

/// What this install set up for Google, and who may sign in.
public struct GoogleSignIn: Decodable, Hashable, Sendable {
  /// A Desktop OAuth client: Google can return to this server, so this Mac can sign in.
  public let loopback: Bool
  /// The broker: a browser on another device can sign in.
  public let broker: Bool
  public let allowedEmails: [String]
  /// A Workspace domain whose accounts may all sign in.
  public let allowedHd: String?

  enum CodingKeys: String, CodingKey { case loopback, broker, allowedEmails, allowedHd }

  /// The muted line under Account.
  public var whoMaySignIn: String {
    var who = allowedEmails
    if let allowedHd { who.append("anyone at \(allowedHd)") }
    guard !who.isEmpty else { return "Nobody has signed in yet. The first Google account to sign in from this Mac owns this Omni." }
    let list = who.count == 1 ? who[0] : who.dropLast().joined(separator: ", ") + " and " + who[who.count - 1]
    return "Who can sign in: \(list)."
  }
}

/// GET /api/auth. `user` and `device` are set only when `via` is `.session`.
public struct AuthState: Decodable, Hashable, Sendable {
  public let via: AccessVia
  public let user: AuthUser?
  public let device: AuthDevice?
  public let google: GoogleSignIn

  enum CodingKeys: String, CodingKey { case via, user, device, google }
}

/// GET /api/auth/google: whether a client here can sign in with Google now, and why not.
public struct SignInAvailability: Decodable, Hashable, Sendable {
  public let mode: SignInMode
  /// False: this install never set Google up for this address. Say nothing about Google then.
  public let configured: Bool
  public let available: Bool
  public let reason: String?

  enum CodingKeys: String, CodingKey { case mode, configured, available, reason }
}

/// POST /api/auth/google/start for the Mac app: the Google URL to open and the claim that finishes it.
public struct SignInStart: Decodable, Hashable, Sendable {
  public let attempt: String
  public let url: URL
  public let mode: SignInMode
  public let claim: String

  enum CodingKeys: String, CodingKey { case attempt, url, mode, claim }
}

/// POST /api/auth/google/finish for the Mac app.
public struct SignInFinished: Decodable, Hashable, Sendable {
  public let user: AuthUser
  public let device: AuthDevice
  /// This sign-in made its address the allowlist: nobody owned the install before.
  public let claimed: Bool
  public let credential: SessionCredential
  public let expiresAt: Date

  enum CodingKeys: String, CodingKey { case user, device, claimed, credential, expiresAt }
}

/// A browser or Mac signed in with Google: a row of Settings > Account > Devices (GET /api/auth/devices).
public struct SignedInDevice: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  public let name: String
  public let kind: AuthDeviceKind
  /// The Google account it signed in with.
  public let email: String
  public let createdAt: Date
  public let lastSeenAt: Date
  public let expiresAt: Date
  /// The device whose session asked. Never set for the install token.
  public let current: Bool

  enum CodingKeys: String, CodingKey { case id, name, kind, email, createdAt, lastSeenAt, expiresAt, current }

  /// The row's second line: "ada@example.com · last seen 5m ago", or "· This device" for the one asking.
  public func detail(now: Date = .now, timeZone: TimeZone = .current) -> String {
    "\(email) · " + (current ? "This device" : "last seen \(RelTime.label(lastSeenAt, now: now, timeZone: timeZone))")
  }
}

/// The body of POST /api/auth/google/start. `signin-start-request.json` is the recorded one.
private struct SignInStartRequest: Encodable, Sendable {
  let client = "mac"
  let deviceName: String

  enum CodingKeys: String, CodingKey { case client, deviceName }
}

private struct SignInFinishRequest: Encodable, Sendable {
  let attempt: String
  let claim: String
}

/// 202 `{pending: true}` while Google has not sent the browser back, else the finished sign-in.
private enum FinishReply: Decodable {
  case pending
  case finished(SignInFinished)

  enum CodingKeys: String, CodingKey { case pending }

  init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self = try c.decodeIfPresent(Bool.self, forKey: .pending) == true ? .pending : .finished(SignInFinished(from: decoder))
  }
}

private struct SignedOut: Decodable {
  let ok: Bool
}

/// DELETE /api/auth/devices/:id.
private struct DeviceRevoked: Decodable {
  let current: Bool
}

/// The calls `AccountModel` makes.
public protocol AccountAPI: Sendable {
  func authState() async throws(OmniAPIError) -> AuthState
  func authState(session: SessionCredential) async throws(OmniAPIError) -> AuthState
  func startSignIn(deviceName: String) async throws(OmniAPIError) -> SignInStart
  func finishSignIn(attempt: String, claim: String) async throws(OmniAPIError) -> SignInFinished?
  func signOut(session: SessionCredential) async throws(OmniAPIError)
  func signedInDevices(session: SessionCredential?) async throws(OmniAPIError) -> [SignedInDevice]
  func revokeDevice(id: String, session: SessionCredential?) async throws(OmniAPIError) -> Bool
}

extension OmniClient: AccountAPI {
  /// With the install token.
  public func authState() async throws(OmniAPIError) -> AuthState {
    try await send("GET", "/api/auth")
  }

  /// With the session instead of the install token. The server slides a live session; a dead one is 401.
  public func authState(session: SessionCredential) async throws(OmniAPIError) -> AuthState {
    try await bearing(session).send("GET", "/api/auth")
  }

  public func startSignIn(deviceName: String) async throws(OmniAPIError) -> SignInStart {
    try await send("POST", "/api/auth/google/start", body: SignInStartRequest(deviceName: deviceName))
  }

  /// nil while Google has not sent the browser back yet (202): ask again in a second.
  public func finishSignIn(attempt: String, claim: String) async throws(OmniAPIError) -> SignInFinished? {
    let reply: FinishReply = try await send("POST", "/api/auth/google/finish", body: SignInFinishRequest(attempt: attempt, claim: claim))
    if case .finished(let done) = reply { return done }
    return nil
  }

  /// Revokes the session's device on the server.
  public func signOut(session: SessionCredential) async throws(OmniAPIError) {
    let _: SignedOut = try await bearing(session).send("POST", "/api/auth/signout", body: [String: String]())
  }

  /// Every device signed in with Google, most recently seen first. With this Mac's session, its own row is `current`;
  /// with nil, the install token asks and no row is.
  public func signedInDevices(session: SessionCredential?) async throws(OmniAPIError) -> [SignedInDevice] {
    try await bearing(session).send("GET", "/api/auth/devices")
  }

  /// Revokes the device: its session stops working at once. True when it was the asking session's own device.
  /// 404 when it is not a live device.
  public func revokeDevice(id: String, session: SessionCredential?) async throws(OmniAPIError) -> Bool {
    let answer: DeviceRevoked = try await bearing(session).send("DELETE", "/api/auth/devices/\(uriComponent(id))")
    return answer.current
  }

  /// This client sending `session` as its Bearer in place of the install token. nil keeps the install token.
  private func bearing(_ session: SessionCredential?) -> OmniClient {
    guard let session else { return self }
    return OmniClient(baseURL: baseURL, token: .fixed(session.value), transport: transport)
  }
}
