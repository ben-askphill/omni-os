import Foundation

/// The parts of an artifact a window or a URL needs. Codable so a window can be reopened with it.
public struct ArtifactRef: Codable, Hashable, Sendable, Identifiable {
  public let id: Int
  public let name: String
  public let kind: String
  public let size: Int
  public let updatedAt: Date

  public init(_ a: Artifact) {
    id = a.id
    name = a.name
    kind = a.kind
    size = a.size
    updatedAt = a.updatedAt
  }

  /// Rendered in a web view, not natively.
  public var isWeb: Bool { kind == "html" || kind == "svg" }
}

extension OmniClient {
  public func artifactURL(_ ref: ArtifactRef, download: Bool = false) -> URL {
    var query = [("v", Self.stamp(ref.updatedAt))]
    if download { query.append(("download", "1")) }
    return url("/api/artifacts/\(ref.id)/raw", query: query)
  }

  public func artifactData(_ ref: ArtifactRef) async throws(OmniAPIError) -> Data {
    try await file(artifactURL(ref))
  }
}
