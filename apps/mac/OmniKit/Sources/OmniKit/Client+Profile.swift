import Foundation

/// Who uses this Omni: the name the greeting and the agent prompts use. `GET /api/status` carries it too
/// (`Status.profile`), so the app learns it with the rest of the workspace. Empty until the first-run step sets it.
public struct Profile: Codable, Hashable, Sendable {
  public let name: String

  public init(name: String) { self.name = name }

  /// What the Web UI's Settings page allows: trimmed, one line, at most this long.
  public static let nameMax = 60
}

extension OmniClient {
  public func profile() async throws(OmniAPIError) -> Profile {
    try await send("GET", "/api/profile")
  }

  /// Saves the name. The server trims it and refuses an empty or too long one with a 400.
  public func setProfile(name: String) async throws(OmniAPIError) -> Profile {
    try await send("PUT", "/api/profile", body: Profile(name: name))
  }
}
