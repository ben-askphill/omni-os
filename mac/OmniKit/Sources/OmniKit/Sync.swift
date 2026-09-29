import Foundation
import Observation

/// GET /api/sync/status: whether history syncs with the other Mac, and what waits either way.
public struct SyncStatus: Decodable, Hashable, Sendable {
  /// The credentials are in the Keychain.
  public let configured: Bool
  /// Not paused.
  public let enabled: Bool
  /// A sync is in flight.
  public let running: Bool
  /// This Mac's sync id, nil until sync is set up here.
  public let machineId: String?
  /// Since the server started; nil before its first sync.
  public let lastSyncAt: Date?
  public let lastError: String?
  /// The relay refused this Mac's sign-in token: it takes a new sign-in.
  public let signedOut: Bool
  /// Failed syncs in a row.
  public let failures: Int
  public let nextSyncAt: Date?
  /// Local changes waiting to push.
  public let pending: Int
  /// Changes for an entity with no handler yet. They push once one is registered.
  public let held: Int
  /// Remote changes that could not apply yet, retried after each pull.
  public let deferred: Int
  /// The last relay change this Mac has.
  public let cursor: Int

  public enum Phase: Hashable, Sendable {
    case paused, syncing, failing, starting, waiting, upToDate
  }

  /// Where sync stands, as the Web UI's Sync page words it.
  public var phase: Phase {
    if !enabled { return .paused }
    if running { return .syncing }
    if lastError != nil { return .failing }
    if lastSyncAt == nil { return .starting }
    return pending > 0 ? .waiting : .upToDate
  }

  public var phaseLabel: String {
    switch phase {
    case .paused: "Paused"
    case .syncing: "Syncing"
    case .failing: "Failing"
    case .starting: "Starting"
    case .waiting: "Waiting to push"
    case .upToDate: "Up to date"
    }
  }

  /// The sign-in form shows: never signed in here, or the relay signed this Mac out.
  public var needsSignIn: Bool { !configured || signedOut }
}

/// POST /api/sync/setup. With neither a password nor a code the server emails a code.
public struct SyncSetup: Encodable, Hashable, Sendable {
  public var url: String
  public var anonKey: String
  public var email: String
  public var password: String?
  public var code: String?

  public init(url: String, anonKey: String, email: String, password: String? = nil, code: String? = nil) {
    self.url = url
    self.anonKey = anonKey
    self.email = email
    self.password = password
    self.code = code
  }
}

public enum SyncSetupResult: Decodable, Hashable, Sendable {
  case codeSent(email: String)
  case signedIn(email: String)

  private enum CodingKeys: String, CodingKey { case state, email }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let email = try c.decode(String.self, forKey: .email)
    switch try c.decode(String.self, forKey: .state) {
    case "code_sent": self = .codeSent(email: email)
    default: self = .signedIn(email: email)
    }
  }
}

/// A row of the path map editor: a folder on the other Mac, and where it lives on this one.
public struct SyncPathMapping: Hashable, Sendable, Identifiable {
  public let id: UUID
  public var from: String
  public var to: String

  public init(id: UUID = UUID(), from: String = "", to: String = "") {
    self.id = id
    self.from = from
    self.to = to
  }
}

/// The Sync tab, like the Web UI's Sync page: the status, sync now, pause, sign in and out, and the path map.
/// The password and the code are held only while typed and sent; a sign-in that works clears them.
@MainActor @Observable
public final class SyncModel {
  public enum LoadState: Hashable, Sendable {
    case loading
    case loaded
    case failed(String)
  }

  public enum Method: String, CaseIterable, Hashable, Sendable {
    case password, code
  }

  public enum Busy: Hashable, Sendable {
    case syncing, pausing, signingOut
  }

  public private(set) var status: SyncStatus?
  public private(set) var loadState = LoadState.loading
  public private(set) var busy: Busy?
  /// What the last action failed with, like a relay that is down on Sync Now.
  public private(set) var actionError: String?

  // MARK: Sign-in form
  public var url = ""
  public var anonKey = ""
  public var email = "" {
    didSet { if email != oldValue { codeSentTo = nil } }
  }
  public var method = Method.password {
    didSet { signInError = nil }
  }
  public var password = ""
  public var code = ""
  /// The email a code went to. Until then the code method sends one.
  public private(set) var codeSentTo: String?
  public private(set) var isSigningIn = false
  public private(set) var signInError: String?

  // MARK: Path map
  public var mappings: [SyncPathMapping] = [] {
    didSet { mappingsSaved = false }
  }
  public private(set) var mappingsLoaded = false
  public private(set) var mappingsError: String?
  public private(set) var mappingsSaved = false
  public private(set) var isSavingMappings = false

  @ObservationIgnored private let client: OmniClient
  @ObservationIgnored private var loads = 0

  public init(client: OmniClient) {
    self.client = client
  }

  // MARK: Status

  /// Loads the status and the path map.
  public func load() async {
    await refresh()
    do throws(OmniAPIError) {
      let map = try await client.syncPathMap()
      mappings = map.sorted { $0.key < $1.key }.map { SyncPathMapping(from: $0.key, to: $0.value) }
      mappingsLoaded = true
      mappingsSaved = false
    } catch {
      guard error != .cancelled else { return }
      mappingsError = error.message
    }
  }

  /// Loads the status again. When loads overlap, the latest one's answer wins.
  public func refresh() async {
    loads += 1
    let load = loads
    do throws(OmniAPIError) {
      let s = try await client.syncStatus()
      guard load == loads else { return }
      status = s
      loadState = .loaded
    } catch {
      guard load == loads, error != .cancelled else { return }
      if status == nil { loadState = .failed(error.message) }
    }
  }

  public func syncNow() async {
    await act(.syncing) { c throws(OmniAPIError) in try await c.syncNow() }
  }

  /// Pauses a running sync, resumes a paused one. The credentials stay.
  public func togglePause() async {
    let paused = status?.enabled == false
    await act(.pausing) { c throws(OmniAPIError) in try await paused ? c.enableSync() : c.disableSync() }
  }

  /// Stops syncing and removes the credentials from the Keychain. History stays on this Mac.
  public func signOut() async {
    await act(.signingOut) { c throws(OmniAPIError) in try await c.disableSync(forget: true) }
  }

  private func act(_ what: Busy, _ run: (OmniClient) async throws(OmniAPIError) -> SyncStatus) async {
    guard busy == nil else { return }
    busy = what
    actionError = nil
    defer { busy = nil }
    do throws(OmniAPIError) {
      status = try await run(client)
    } catch {
      if error != .cancelled { actionError = error.message }
      await refresh()
    }
  }

  // MARK: Sign-in

  /// The code method's first step: no code yet, so the button emails one.
  public var needsCode: Bool { method == .code && codeSentTo == nil }

  public var canSignIn: Bool {
    guard !isSigningIn, !trimmed(url).isEmpty, !trimmed(anonKey).isEmpty, !trimmed(email).isEmpty else { return false }
    switch method {
    case .password: return !password.isEmpty
    case .code: return needsCode || !trimmed(code).isEmpty
    }
  }

  public var signInTitle: String { needsCode ? "Email Me a Code" : "Sign In and Sync" }

  /// Sends the form. A password or code that works is cleared; a refused one stays, to fix and send again.
  public func signIn() async {
    guard canSignIn else { return }
    var body = SyncSetup(url: trimmed(url), anonKey: trimmed(anonKey), email: trimmed(email))
    switch method {
    case .password: body.password = password
    case .code where !needsCode: body.code = trimmed(code)
    case .code: break
    }
    isSigningIn = true
    signInError = nil
    defer { isSigningIn = false }
    let result: SyncSetupResult
    do throws(OmniAPIError) {
      result = try await client.setupSync(body)
    } catch {
      if error != .cancelled { signInError = error.message }
      return
    }
    switch result {
    case .codeSent(let email):
      codeSentTo = email
    case .signedIn:
      clearSecrets()
      codeSentTo = nil
      await refresh()
    }
  }

  /// Asks for a new code on the next sign-in.
  public func resetCode() {
    codeSentTo = nil
    code = ""
  }

  /// Drops a password or code that was typed and not used, as when the tab closes.
  public func clearSecrets() {
    password = ""
    code = ""
  }

  // MARK: Path map

  public func addMapping() {
    mappings.append(SyncPathMapping())
  }

  public func removeMapping(_ id: SyncPathMapping.ID) {
    mappings.removeAll { $0.id == id }
  }

  /// Saves the rows that have anything in them. The server tidies them, and the rows show what it kept.
  public func saveMappings() async {
    guard !isSavingMappings else { return }
    var map: [String: String] = [:]
    for m in mappings where !trimmed(m.from).isEmpty || !trimmed(m.to).isEmpty { map[trimmed(m.from)] = trimmed(m.to) }
    isSavingMappings = true
    mappingsError = nil
    defer { isSavingMappings = false }
    do throws(OmniAPIError) {
      let kept = try await client.setSyncPathMap(map)
      mappings = kept.sorted { $0.key < $1.key }.map { SyncPathMapping(from: $0.key, to: $0.value) }
      mappingsSaved = true
    } catch {
      if error != .cancelled { mappingsError = error.message }
    }
  }

  private func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
}
