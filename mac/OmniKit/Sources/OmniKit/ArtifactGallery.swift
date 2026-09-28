import Foundation

/// A row of GET /api/artifacts: an artifact with the title and channel of its thread.
public struct GalleryArtifact: Decodable, Hashable, Sendable, Identifiable {
  public let artifact: Artifact
  public let threadTitle: String
  public let channelID: String

  public var id: Int { artifact.id }

  enum CodingKeys: String, CodingKey {
    case threadTitle = "thread_title"
    case channelID = "channel_id"
  }

  public init(from decoder: any Decoder) throws {
    artifact = try Artifact(from: decoder)
    let c = try decoder.container(keyedBy: CodingKeys.self)
    threadTitle = try c.decode(String.self, forKey: .threadTitle)
    channelID = try c.decode(String.self, forKey: .channelID)
  }

  init(_ artifact: Artifact, threadTitle: String, channelID: String) {
    self.artifact = artifact
    self.threadTitle = threadTitle
    self.channelID = channelID
  }
}

/// The Artifacts page's filter tabs, with `matches` from web/src/pages/Artifacts.tsx.
public enum ArtifactFilter: String, CaseIterable, Hashable, Sendable, Identifiable {
  case all, pages, images, docs, data

  public var id: String { rawValue }

  public var label: String {
    switch self {
    case .all: "All"
    case .pages: "Pages"
    case .images: "Images"
    case .docs: "Docs"
    case .data: "Data"
    }
  }

  public func matches(_ kind: String) -> Bool {
    switch self {
    case .all: true
    case .pages: kind == "html" || kind == "svg"
    case .images: kind == "image"
    case .docs: kind == "markdown" || kind == "pdf" || kind == "text"
    case .data: kind == "csv" || kind == "json"
    }
  }
}

/// The recent artifacts across threads, newest change first, kept current from the feed. The list is what
/// GET /api/artifacts sends (screenshots left out, at most 60), and a feed `artifact` message joins it by
/// these rules:
/// - A screenshot is ignored: the page never lists them.
/// - One already listed is replaced and moves to its new place, unless the list has a newer copy.
/// - A new one needs its thread's title and channel, which the feed message lacks. They come from another
///   artifact of the same thread, else from `thread`. With neither, the list can't show it: `.needsReload`.
/// - A new one older than everything in a full list is ignored. Beyond the limit the oldest drop off.
public struct ArtifactGallery: Hashable, Sendable {
  public static let limit = 60

  public enum Outcome: Hashable, Sendable {
    case applied, ignored, needsReload
  }

  public private(set) var items: [GalleryArtifact]

  public init(_ items: [GalleryArtifact] = []) {
    self.items = items
  }

  public func items(matching filter: ArtifactFilter) -> [GalleryArtifact] {
    filter == .all ? items : items.filter { filter.matches($0.artifact.kind) }
  }

  public func count(matching filter: ArtifactFilter) -> Int {
    filter == .all ? items.count : items.reduce(0) { $0 + (filter.matches($1.artifact.kind) ? 1 : 0) }
  }

  /// - Parameter thread: the title and channel of a thread, when the caller knows them.
  @discardableResult
  public mutating func upsert(_ a: Artifact, thread: (String) -> (title: String, channelID: String)? = { _ in nil }) -> Outcome {
    guard a.kind != "screenshot" else { return .ignored }
    let existing = items.first { $0.id == a.id }
    if let existing, existing.artifact.updatedAt > a.updatedAt { return .ignored }
    let known = existing.map { ($0.threadTitle, $0.channelID) }
      ?? items.first { $0.artifact.threadID == a.threadID }.map { ($0.threadTitle, $0.channelID) }
      ?? thread(a.threadID).map { ($0.title, $0.channelID) }
    guard let (title, channel) = known else { return .needsReload }
    items.removeAll { $0.id == a.id }
    let at = items.firstIndex { $0.artifact.updatedAt <= a.updatedAt } ?? items.endIndex
    guard at < Self.limit else { return .ignored }
    items.insert(GalleryArtifact(a, threadTitle: title, channelID: channel), at: at)
    if items.count > Self.limit { items.removeLast(items.count - Self.limit) }
    return .applied
  }
}

extension OmniClient {
  /// The recent artifacts of all threads, screenshots left out.
  public func artifacts() async throws(OmniAPIError) -> [GalleryArtifact] {
    let data = try await file(url("/api/artifacts"))
    do {
      return try OmniJSON.decoder().decode([GalleryArtifact].self, from: data)
    } catch {
      throw .decoding(Self.describe(error))
    }
  }
}
