import Foundation

/// The REST calls a thread store makes. `OmniClient` is one; tests pass a fake.
public protocol ThreadAPI: Sendable {
  func thread(_ id: String) async throws(OmniAPIError) -> ThreadDetail
  func stopThread(_ id: String) async throws(OmniAPIError) -> OmniThread
}

extension OmniClient: ThreadAPI {}

extension OmniClient {
  /// An artifact's file. `v` changes when the file does, so a cached copy is never shown stale.
  public func artifactURL(_ a: Artifact, download: Bool = false) -> URL {
    var query = [("v", Self.stamp(a.updatedAt))]
    if download { query.append(("download", "1")) }
    return url("/api/artifacts/\(a.id)/raw", query: query)
  }

  /// A file Ben attached to a message in the thread.
  public func uploadURL(threadID: String, name: String, download: Bool = false) -> URL {
    url("/api/threads/\(uriComponent(threadID))/uploads/\(uriComponent(name))", query: download ? [("download", "1")] : [])
  }

  /// The date as JavaScript's `toISOString` writes it, to the millisecond.
  static func stamp(_ date: Date) -> String {
    let ms = Int64((date.timeIntervalSince1970 * 1000).rounded())
    let (s, frac) = ms.quotientAndRemainder(dividingBy: 1000)
    let whole = Date(timeIntervalSince1970: TimeInterval(frac < 0 ? s - 1 : s))
    let text = whole.formatted(Date.ISO8601FormatStyle())
    return text.dropLast() + String(format: ".%03dZ", frac < 0 ? frac + 1000 : frac)
  }
}
