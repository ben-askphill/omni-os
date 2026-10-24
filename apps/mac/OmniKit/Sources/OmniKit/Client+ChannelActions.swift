import Foundation

private struct OKBody: Decodable {
  let ok: Bool
}

extension OmniClient {
  /// The channel's actions, in their order.
  public func channelActions(_ channel: String) async throws(OmniAPIError) -> [ChannelAction] {
    try await send("GET", "/api/channels/\(uriComponent(channel))/actions")
  }

  /// Refused with 409 when the channel has an action of that name, 400 with the server's reason otherwise.
  public func createChannelAction(_ channel: String, _ input: ChannelActionInput) async throws(OmniAPIError) -> ChannelAction {
    try await send("POST", "/api/channels/\(uriComponent(channel))/actions", body: input)
  }

  public func updateChannelAction(
    _ channel: String, action: String, _ input: ChannelActionInput
  ) async throws(OmniAPIError) -> ChannelAction {
    try await send("PATCH", "/api/channels/\(uriComponent(channel))/actions/\(uriComponent(action))", body: input)
  }

  /// Its past runs stay, without their action.
  public func deleteChannelAction(_ channel: String, action: String) async throws(OmniAPIError) {
    let _: OKBody = try await send("DELETE", "/api/channels/\(uriComponent(channel))/actions/\(uriComponent(action))")
  }

  public func threadActions(_ thread: String) async throws(OmniAPIError) -> ThreadActions {
    try await send("GET", "/api/threads/\(uriComponent(thread))/actions")
  }

  /// Starts the action in the thread's checkout. 409 while the thread is blocked or a fixed port is taken.
  public func runAction(_ action: String, thread: String) async throws(OmniAPIError) -> ActionRun {
    try await send("POST", "/api/threads/\(uriComponent(thread))/actions/\(uriComponent(action))/run")
  }

  /// Answers once the run has ended.
  public func stopActionRun(_ run: String, thread: String) async throws(OmniAPIError) -> ActionRun? {
    try await send("POST", "/api/threads/\(uriComponent(thread))/action-runs/\(uriComponent(run))/stop")
  }

  /// Runs the run's action again, with its current command.
  public func retryActionRun(_ run: String, thread: String) async throws(OmniAPIError) -> ActionRun {
    try await send("POST", "/api/threads/\(uriComponent(thread))/action-runs/\(uriComponent(run))/retry")
  }
}
