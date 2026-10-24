import Foundation

/// `{}`, what the Web UI's api.post sends when there is nothing to say.
private struct EmptyBody: Encodable, Sendable {}

/// POST /api/worktrees/scan/cancel answers the scan too, with whether one was running.
private struct CancelReply: Decodable {
  let scan: WorktreeScan?
  let summary: InventorySummary?
  let cancelled: Bool
}

extension OmniClient {
  /// The running scan, or the last one finished. `scan` is nil before the first.
  public func worktreeScan() async throws(OmniAPIError) -> WorktreeScanReply {
    try await send("GET", "/api/worktrees/scan")
  }

  /// Starts a scan, or returns the one already running. It lists and measures; it deletes nothing.
  public func startWorktreeScan() async throws(OmniAPIError) -> WorktreeScanReply {
    try await send("POST", "/api/worktrees/scan", body: EmptyBody())
  }

  public func cancelWorktreeScan() async throws(OmniAPIError) -> WorktreeScanReply {
    let r: CancelReply = try await send("POST", "/api/worktrees/scan/cancel", body: EmptyBody())
    return WorktreeScanReply(scan: r.scan, summary: r.summary)
  }
}
