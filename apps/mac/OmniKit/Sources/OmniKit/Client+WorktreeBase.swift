import Foundation

extension OmniClient: BasesAPI {
  /// What the new-thread composer offers as a worktree's base in a channel.
  public func channelBases(_ id: String) async throws(OmniAPIError) -> BaseOptions {
    try await send("GET", "/api/channels/\(uriComponent(id))/bases")
  }
}

extension OmniClient {
  /// Where a worktree thread's branch starts. nil for a thread with no worktree.
  public func threadBase(_ id: String) async throws(OmniAPIError) -> ThreadBaseView? {
    try await send("GET", "/api/threads/\(uriComponent(id))/base")
  }
}
