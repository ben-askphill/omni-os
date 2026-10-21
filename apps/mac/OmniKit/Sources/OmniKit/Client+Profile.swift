import Foundation

/// Who uses this Omni: the name the greeting and the agent prompts use, pronouns, email and timezone.
/// `GET /api/status` carries it too (`Status.profile`), so the app learns it with the rest of the workspace.
/// The server keeps it in the user config (data/omni.config.json, apps/server/user-config.ts).
public struct Profile: Codable, Hashable, Sendable {
  public let name: String
  public let pronouns: String?
  public let email: String?
  public let timezone: String?
  /// False until onboarding finished (web, Mac or `npm run setup`). Older servers leave it out: treat that as done.
  public let onboarded: Bool?

  public init(name: String, pronouns: String? = nil, email: String? = nil, timezone: String? = nil, onboarded: Bool? = nil) {
    self.name = name
    self.pronouns = pronouns
    self.email = email
    self.timezone = timezone
    self.onboarded = onboarded
  }

  /// What the Web UI's Settings page allows: trimmed, one line, at most this long.
  public static let nameMax = 60

  /// The onboarding sheet shows: the server said so. A server from before onboarding never asks.
  public var needsOnboarding: Bool { onboarded == false }
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
