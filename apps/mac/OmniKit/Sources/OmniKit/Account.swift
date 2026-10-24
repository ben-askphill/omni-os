import Foundation
import Observation
import Security
import Synchronization
import SystemConfiguration

/// Where this Mac keeps its session credential, one per server (`127.0.0.1:4747`).
public protocol SessionStore: Sendable {
  func load(_ key: String) -> SessionCredential?
  func save(_ credential: SessionCredential, for key: String)
  func clear(_ key: String)
}

/// The login Keychain: a generic password per server, under service `com.omni-os.mac.session`.
public struct KeychainSessionStore: SessionStore {
  public static let service = "com.omni-os.mac.session"

  public init() {}

  private func query(_ key: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service, kSecAttrAccount as String: key]
  }

  public func load(_ key: String) -> SessionCredential? {
    var q = query(key)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data,
      let text = String(data: data, encoding: .utf8), !text.isEmpty
    else { return nil }
    return SessionCredential(text)
  }

  public func save(_ credential: SessionCredential, for key: String) {
    clear(key)
    var q = query(key)
    q[kSecValueData as String] = Data(credential.value.utf8)
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    q[kSecAttrLabel as String] = "Omni session (\(key))"
    SecItemAdd(q as CFDictionary, nil)
  }

  public func clear(_ key: String) {
    SecItemDelete(query(key) as CFDictionary)
  }
}

/// For tests and Debug QA runs, which never touch the login Keychain.
public final class MemorySessionStore: SessionStore {
  private let items: Mutex<[String: SessionCredential]>

  public init(_ items: [String: SessionCredential] = [:]) {
    self.items = Mutex(items)
  }

  public func load(_ key: String) -> SessionCredential? { items.withLock { $0[key] } }
  public func save(_ credential: SessionCredential, for key: String) { items.withLock { $0[key] = credential } }
  public func clear(_ key: String) { items.withLock { $0[key] = nil } }
}

/// This Mac's Google sign-in on the server it is connected to (Settings > Account, the onboarding step). The session
/// is the Mac's identity in Devices; every other call keeps the install token. Follows the connection.
@MainActor @Observable
public final class AccountModel {
  public enum State: Hashable, Sendable {
    case signedOut
    case signingIn
    case signedIn(AuthUser, AuthDevice)
    /// Signed out, with what went wrong. Stays until the next sign-in or sign-out.
    case failed(String)
  }

  public private(set) var state = State.signedOut
  /// What the install set up for Google and who may sign in. nil until the server has answered.
  public private(set) var google: GoogleSignIn?
  /// What the server calls this Mac's device.
  public let deviceName: String
  /// Every device signed in with Google, most recently seen first, this Mac's own marked `current`. nil until loaded,
  /// and while the install has no Google sign-in.
  public private(set) var devices: [SignedInDevice]?
  /// Why the list could not load, or a device could not be signed out. Cleared by the next load that works.
  public private(set) var devicesError: String?

  @ObservationIgnored private let sessions: any SessionStore
  @ObservationIgnored private let retryDelay: Duration
  @ObservationIgnored private var api: (any AccountAPI)?
  @ObservationIgnored private var key = ""
  /// Moves on a new connection and on every sign-in or sign-out, so an answer to an older ask is dropped.
  @ObservationIgnored private var generation = 0

  /// - Parameter retryDelay: the wait between finishes while Google has not sent the browser back.
  public init(sessions: any SessionStore, deviceName: String? = nil, retryDelay: Duration = .seconds(1)) {
    self.sessions = sessions
    self.deviceName = deviceName ?? (SCDynamicStoreCopyComputerName(nil, nil) as String?) ?? "Mac"
    self.retryDelay = retryDelay
  }

  /// Onboarding's Sign in step: shown while Google can sign this Mac in, and once it has.
  public var offersSignIn: Bool {
    if case .signedIn = state { return true }
    return google?.loopback == true
  }

  /// The server on `api`, whose session is kept under `key` (`127.0.0.1:4747`).
  public func connect(api: any AccountAPI, key: String) {
    self.api = api
    self.key = key
    generation += 1
    state = .signedOut
    google = nil
    devices = nil
    devicesError = nil
  }

  /// Asks the server who this Mac is, with the stored session (which slides it), then for the devices while Google is
  /// set up. A session the server no longer takes is dropped. An unreachable server leaves the account and the list as
  /// they were, with the reason under the list.
  public func refresh() async {
    guard let api else { return }
    let asked = generation
    do throws(OmniAPIError) {
      var session = sessions.load(key)
      var auth: AuthState?
      if let stored = session {
        do throws(OmniAPIError) {
          let answer = try await api.authState(session: stored)
          if answer.via == .session, answer.user != nil, answer.device != nil { auth = answer }
        } catch .http(status: 401, _) {}
        guard asked == generation else { return }
        if auth == nil {
          sessions.clear(key)
          session = nil
        }
      }
      let answer: AuthState
      if let auth { answer = auth } else { answer = try await api.authState() }
      guard asked == generation else { return }
      google = answer.google
      if let user = answer.user, let device = answer.device, answer.via == .session {
        state = .signedIn(user, device)
      } else if case .signedIn = state {
        state = .signedOut
      }
      guard answer.google.loopback || answer.google.broker else {
        devices = nil
        return
      }
      let list = try await api.signedInDevices(session: session)
      guard asked == generation else { return }
      devices = list
      devicesError = nil
    } catch {
      guard asked == generation, google != nil else { return }
      devicesError = error.message
    }
  }

  /// Signs a device out of Omni, as its row's Sign out does. This Mac's own row signs it out here too.
  public func revoke(_ device: SignedInDevice) async {
    guard let api else { return }
    let asked = generation
    do throws(OmniAPIError) {
      let current = try await api.revokeDevice(id: device.id, session: sessions.load(key))
      guard asked == generation else { return }
      if current || device.current { forgetSession(.signedOut) }
    } catch .http(status: 404, _) {
      guard asked == generation else { return }
    } catch {
      guard asked == generation else { return }
      return devicesError = error.message
    }
    await refresh()
  }

  /// Starts a sign-in, has `open` show Google's page and hand back the `omni://signin?attempt=` URL it ends on,
  /// then finishes it with the claim. `open` throwing `CancellationError` is a sign-in given up, not a failure.
  public func signIn(open: @MainActor (URL) async throws -> URL) async {
    guard let api else { return }
    switch state {
    case .signingIn, .signedIn: return
    case .signedOut, .failed: break
    }
    generation += 1
    let asked = generation
    state = .signingIn
    do {
      let start = try await api.startSignIn(deviceName: deviceName)
      guard asked == generation else { return }
      let callback = try await open(start.url)
      guard asked == generation else { return }
      guard Self.attempt(in: callback) == start.attempt else { return state = .failed("Google sent back another sign-in. Try again.") }
      var done = try await api.finishSignIn(attempt: start.attempt, claim: start.claim)
      for _ in 0..<10 where done == nil {
        try await Task.sleep(for: retryDelay)
        done = try await api.finishSignIn(attempt: start.attempt, claim: start.claim)
      }
      guard asked == generation else { return }
      guard let done else { return state = .failed("Google has not finished signing you in. Try again.") }
      sessions.save(done.credential, for: key)
      generation += 1
      state = .signedIn(done.user, done.device)
      // The first sign-in on an install makes its address the allowlist.
      await refresh()
    } catch {
      guard asked == generation else { return }
      switch error {
      case is CancellationError, OmniAPIError.cancelled: state = .signedOut
      case let e as OmniAPIError: state = .failed(e.message)
      default: state = .failed(error.localizedDescription)
      }
    }
  }

  /// Revokes this Mac's session on the server and forgets it. Forgotten here even when the server can't be told.
  public func signOut() async {
    guard let api else { return }
    guard let session = sessions.load(key) else { return forgetSession(.signedOut) }
    let asked = generation
    var unheard: String?
    do throws(OmniAPIError) {
      try await api.signOut(session: session)
    } catch .http(status: 401, _) {
    } catch {
      unheard = error.message
    }
    guard asked == generation else { return }
    forgetSession(unheard.map { .failed("Signed out on this Mac. The server did not hear it: \($0)") } ?? .signedOut)
    await refresh()
  }

  /// Drops this Mac's session and drops the answers to asks made with it.
  private func forgetSession(_ then: State) {
    sessions.clear(key)
    generation += 1
    state = then
  }

  /// The attempt in `omni://signin?attempt=<id>`, where the server sends the sign-in sheet at the end.
  static func attempt(in url: URL) -> String? {
    guard url.scheme == "omni", url.host() == "signin" else { return nil }
    return URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "attempt" }?.value
  }
}
