import Foundation

extension OmniClient {
  /// A thread with its newest page of events (`history` says which), as the thread screen opens it.
  public func threadOpen(_ id: String) async throws(OmniAPIError) -> ThreadDetail {
    try await send("GET", "/api/threads/\(uriComponent(id))", query: [("history", "recent")])
  }

  /// One page of a thread's events.
  public func threadHistory(_ id: String, _ cursor: HistoryCursor) async throws(OmniAPIError) -> HistoryPage {
    try await send("GET", "/api/threads/\(uriComponent(id))/history", query: cursor.query)
  }

  /// One event of a thread, whole: in place of a page's clipped copy.
  public func threadEvent(_ id: String, eventID: Int) async throws(OmniAPIError) -> EventRow {
    try await send("GET", "/api/threads/\(uriComponent(id))/events/\(eventID)")
  }
}
