import Foundation

/// What POST /api/sync/now answers. The app only needs to know it went through.
private struct SyncAnswer: Decodable {}

extension OmniClient {
  /// Asks the server to push and pull with the other Mac now. 409 while sync is off, 502 when the relay failed.
  public func syncNow() async throws(OmniAPIError) {
    let _: SyncAnswer = try await send("POST", "/api/sync/now")
  }
}
