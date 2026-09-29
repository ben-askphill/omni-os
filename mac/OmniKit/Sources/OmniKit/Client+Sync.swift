import Foundation

/// `{}`, what the Web UI's api.post sends when there is nothing to say.
private struct EmptyBody: Encodable, Sendable {}

private struct ForgetBody: Encodable, Sendable {
  let forget: Bool
}

private struct PathMapBody: Codable, Sendable {
  let map: [String: String]
}

/// The answers of /now, /disable and /enable carry the status after the action.
private struct StatusReply: Decodable {
  let status: SyncStatus
}

extension OmniClient {
  public func syncStatus() async throws(OmniAPIError) -> SyncStatus {
    try await send("GET", "/api/sync/status")
  }

  /// Pushes and pulls now. A relay that fails answers 502 with its error; sync off answers 409.
  public func syncNow() async throws(OmniAPIError) -> SyncStatus {
    let reply: StatusReply = try await send("POST", "/api/sync/now", body: EmptyBody())
    return reply.status
  }

  /// Signs in and turns sync on, or emails a code when the body has neither a password nor a code.
  /// The password goes in the body only; the server uses it once and keeps the sign-in token in the Keychain.
  public func setupSync(_ setup: SyncSetup) async throws(OmniAPIError) -> SyncSetupResult {
    try await send("POST", "/api/sync/setup", body: setup)
  }

  /// Pauses syncing. `forget` also removes the credentials from the Keychain.
  public func disableSync(forget: Bool = false) async throws(OmniAPIError) -> SyncStatus {
    let reply: StatusReply = try await send("POST", "/api/sync/disable", body: ForgetBody(forget: forget))
    return reply.status
  }

  public func enableSync() async throws(OmniAPIError) -> SyncStatus {
    let reply: StatusReply = try await send("POST", "/api/sync/enable", body: EmptyBody())
    return reply.status
  }

  /// This Mac's path map: a folder on the other Mac, and where it lives here.
  public func syncPathMap() async throws(OmniAPIError) -> [String: String] {
    let reply: PathMapBody = try await send("GET", "/api/sync/path-map")
    return reply.map
  }

  /// Replaces the path map. Returns it as the server kept it, trailing slashes dropped.
  public func setSyncPathMap(_ map: [String: String]) async throws(OmniAPIError) -> [String: String] {
    let reply: PathMapBody = try await send("PUT", "/api/sync/path-map", body: PathMapBody(map: map))
    return reply.map
  }
}
