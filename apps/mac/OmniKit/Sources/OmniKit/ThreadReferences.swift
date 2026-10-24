import Foundation
import Observation

/// One match of GET /api/thread-references (apps/server/thread-references-api.ts).
public struct ThreadReferenceCandidate: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  public let shortID: String
  public let title: String
  public let channel: String
  public let channelName: String
  public let status: String
  public let archived: Bool
  public let updatedAt: String
  /// In the channel of the thread being written in. One with this false is a cross-channel reference.
  public let sameChannel: Bool

  enum CodingKeys: String, CodingKey {
    case id, title, channel, status, archived
    case shortID = "short_id"
    case channelName = "channel_name"
    case updatedAt = "updated_at"
    case sameChannel = "same_channel"
  }

  public init(id: String, shortID: String, title: String, channel: String, channelName: String, status: String, archived: Bool = false, updatedAt: String = "", sameChannel: Bool = true) {
    self.id = id
    self.shortID = shortID
    self.title = title
    self.channel = channel
    self.channelName = channelName
    self.status = status
    self.archived = archived
    self.updatedAt = updatedAt
    self.sameChannel = sameChannel
  }
}

/// Where the picker searches: the thread's own channel, or every channel when Ben chose that.
public enum ThreadReferenceScope: String, CaseIterable, Sendable {
  case channel
  case all

  public var title: String { self == .channel ? "This channel" : "All channels" }
}

/// GET /api/thread-references: the picker's search over thread titles and channel names.
public protocol ThreadReferenceAPI: Sendable {
  func threadReferences(thread: String, query: String, scope: ThreadReferenceScope) async throws(OmniAPIError) -> [ThreadReferenceCandidate]
}

extension OmniClient: ThreadReferenceAPI {
  public func threadReferences(thread: String, query: String, scope: ThreadReferenceScope) async throws(OmniAPIError) -> [ThreadReferenceCandidate] {
    try await send("GET", "/api/thread-references", query: [("thread", thread), ("q", query.trimmingCharacters(in: .whitespacesAndNewlines)), ("scope", scope.rawValue)])
  }
}

/// The picker behind the reply box's thread reference button, as `ThreadReferencePanel` in ThreadReference.tsx: a search
/// over this channel's threads, All channels on request, and a pick that adds a record to the thread's draft. Nothing is
/// sent to, started in or changed on the picked thread.
@MainActor @Observable
public final class ThreadReferencePicker {
  public var query = "" { didSet { if query != oldValue { problem = nil } } }
  public var scope = ThreadReferenceScope.channel { didSet { if scope != oldValue { problem = nil } } }
  public private(set) var rows: [ThreadReferenceCandidate] = []
  public private(set) var error: String?
  /// Why the last pick was refused.
  public private(set) var problem: String?
  /// False until the search for the current query and scope has answered.
  public private(set) var settled = false

  public let threadID: String
  public let channelID: String
  private let api: any ThreadReferenceAPI
  private let draft: DraftContextModel
  private let now: @Sendable () -> Date

  public init(threadID: String, channelID: String, api: any ThreadReferenceAPI, draft: DraftContextModel, now: @escaping @Sendable () -> Date = { Date() }) {
    self.threadID = threadID
    self.channelID = channelID
    self.api = api
    self.draft = draft
    self.now = now
  }

  /// A fresh search: this channel, nothing typed. Run each time the picker opens.
  public func reset() {
    query = ""
    scope = .channel
    problem = nil
  }

  /// Searches for the current query and scope. A slower answer for an earlier search never replaces a newer one.
  public func search() async {
    let asked = (query, scope)
    settled = false
    do {
      let found = try await api.threadReferences(thread: threadID, query: asked.0, scope: asked.1)
      guard asked == (query, scope) else { return }
      rows = found
      error = nil
    } catch {
      guard asked == (query, scope) else { return }
      if case .cancelled = error { return }
      rows = []
      self.error = error.message
    }
    settled = true
  }

  public func isAttached(_ id: String) -> Bool {
    ContextReading.read(draft.records, kinds: [ThreadReferenceContext.self]).contains {
      if case .known(_, let body) = $0, let b = body as? ThreadReferenceContext.Body { b.thread == id } else { false }
    }
  }

  /// Adds `c` to the thread's next message. True when it is on it. A candidate outside the thread's channel is only
  /// ever added from All channels, so `crossChannel` is true only for a pick Ben made there.
  @discardableResult
  public func attach(_ c: ThreadReferenceCandidate) -> Bool {
    guard !isAttached(c.id) else {
      problem = "That thread is already attached."
      return false
    }
    let body = ThreadReferenceContext.referenceBody(
      .init(id: c.id, title: c.title, channel: c.channel, channelName: c.channelName), current: channelID, at: now())
    if let refused = draft.add(.make(ThreadReferenceContext.self, body: body, note: "")) {
      problem = refused
      return false
    }
    problem = nil
    return true
  }
}
