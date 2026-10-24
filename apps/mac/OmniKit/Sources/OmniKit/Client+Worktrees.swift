import Foundation

/// `{}`, what the Web UI's api.post sends when there is nothing to say.
private struct EmptyBody: Encodable, Sendable {}

private struct CleanupBody: Encodable, Sendable {
  let ids: [String]
}

/// Only the fields given, so a change to one never writes back a stale copy of the other.
private struct RetentionBody: Encodable, Sendable {
  let enabled: Bool?
  let idleDays: Int?
}

extension OmniClient {
  /// The running scan, or the last one finished, and the cleanup state. `scan` is nil before the first.
  public func worktreeScan() async throws(OmniAPIError) -> WorktreeScanReply {
    try await send("GET", "/api/worktrees/scan")
  }

  /// Starts a scan, or returns the one already running. It lists and measures; it deletes nothing. 409 while a cleanup runs.
  public func startWorktreeScan() async throws(OmniAPIError) -> WorktreeScanReply {
    try await send("POST", "/api/worktrees/scan", body: EmptyBody())
  }

  /// Its answer also says whether a scan was running, which the app does not need.
  public func cancelWorktreeScan() async throws(OmniAPIError) -> WorktreeScanReply {
    try await send("POST", "/api/worktrees/scan/cancel", body: EmptyBody())
  }

  /// Removes these worktrees, which Ben reviewed in the last scan's cleanup list, each checked again right before it
  /// goes. The run goes on in the background. 409 while a scan or another cleanup runs, or when one is no longer listed.
  public func startWorktreeCleanup(ids: [String]) async throws(OmniAPIError) -> WorktreeScanReply {
    try await send("POST", "/api/worktrees/cleanup", body: CleanupBody(ids: ids))
  }

  /// This Mac's retention policy, saved on this Mac only. A nil field stays as it is.
  public func setWorktreeRetention(enabled: Bool? = nil, idleDays: Int? = nil) async throws(OmniAPIError) -> WorktreeScanReply {
    try await send("PUT", "/api/worktrees/retention", body: RetentionBody(enabled: enabled, idleDays: idleDays))
  }
}
