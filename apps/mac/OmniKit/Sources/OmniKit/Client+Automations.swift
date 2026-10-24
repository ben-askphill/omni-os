import Foundation

private struct EnabledBody: Encodable, Sendable {
  let enabled: Bool
}

/// `{}`, what the Web UI's api.post sends when there is nothing to say.
private struct EmptyBody: Encodable, Sendable {}

/// PUT /api/automations/:id/webhook-secret. The value goes in the body only, and the body is dropped with the request.
private struct WebhookSecretBody: Encodable, Sendable {
  let value: String
}

private struct OKBody: Decodable {
  let ok: Bool
}

/// POST /api/deliveries/:id/retry or skip. The attempt is the one the row showed, so a click on a copy that has since
/// moved on is refused instead of acting on the newer one.
private struct AttemptBody: Encodable, Sendable {
  let attempt: Int
}

/// What a retry or skip answers with.
private struct DeliveryBody: Decodable {
  let delivery: TriggerDelivery
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

  /// Stores a webhook automation's signing secret in this Mac's Keychain. The server trims it.
  public func setAutomationWebhookSecret(_ id: String, value: String) async throws(OmniAPIError) {
    let _: OKBody = try await send("PUT", "/api/automations/\(uriComponent(id))/webhook-secret", body: WebhookSecretBody(value: value))
  }

  public func removeAutomationWebhookSecret(_ id: String) async throws(OmniAPIError) {
    let _: OKBody = try await send("DELETE", "/api/automations/\(uriComponent(id))/webhook-secret")
  }

  /// Older deliveries of an automation, newest first, after the one with id `before`.
  public func automationDeliveries(_ id: String, limit: Int = 20, before: String? = nil) async throws(OmniAPIError) -> DeliveryPage {
    var query = [("limit", String(limit))]
    if let before { query.append(("before", before)) }
    return try await send("GET", "/api/automations/\(uriComponent(id))/deliveries", query: query)
  }

  /// One delivery as it is now.
  public func delivery(_ id: String) async throws(OmniAPIError) -> TriggerDelivery {
    try await send("GET", "/api/deliveries/\(uriComponent(id))")
  }

  /// Goes again as `attempt + 1`, for a failed delivery that made no thread. A 409 says why it cannot, such as an
  /// attempt that has moved on or an event past its age limit.
  public func retryDelivery(_ id: String, attempt: Int) async throws(OmniAPIError) -> TriggerDelivery {
    let answer: DeliveryBody = try await send("POST", "/api/deliveries/\(uriComponent(id))/retry", body: AttemptBody(attempt: attempt))
    return answer.delivery
  }

  /// Never starts it. Final.
  public func skipDelivery(_ id: String, attempt: Int) async throws(OmniAPIError) -> TriggerDelivery {
    let answer: DeliveryBody = try await send("POST", "/api/deliveries/\(uriComponent(id))/skip", body: AttemptBody(attempt: attempt))
    return answer.delivery
  }
}
