import Foundation

private struct EnabledBody: Encodable, Sendable {
  let enabled: Bool
}

/// `{}`, what the Web UI's api.post sends when there is nothing to say.
private struct EmptyBody: Encodable, Sendable {}

private struct OKBody: Decodable {
  let ok: Bool
}

extension OmniClient {
  /// Every file in automations/, with its next run and last five runs.
  public func automations() async throws(OmniAPIError) -> [Automation] {
    try await send("GET", "/api/automations")
  }

  /// Starts a run now. The thread it makes is in the automation's channel.
  public func runAutomation(_ id: String) async throws(OmniAPIError) -> OmniThread {
    try await send("POST", "/api/automations/\(uriComponent(id))/run", body: EmptyBody())
  }

  /// Writes `enabled` into the automation's file and schedules it again.
  public func setAutomationEnabled(_ id: String, _ enabled: Bool) async throws(OmniAPIError) {
    let _: OKBody = try await send("POST", "/api/automations/\(uriComponent(id))/enabled", body: EnabledBody(enabled: enabled))
  }
}
