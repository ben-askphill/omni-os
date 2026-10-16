import Foundation

// Needs you (server/db/repos/needs-you.ts): unread results and blockers across every thread that is not archived.
// web/src/needs-you.ts is the Web UI's copy of the rules below.

/// The newest result of a thread that Ben has not seen. `uid` names it when the app says it was shown.
public struct NeedsYouResult: Decodable, Hashable, Sendable {
  public let uid: String
  /// done, failed or stopped.
  public let status: ThreadStatus
  /// The synced uid of the thread's newest event when the turn ended.
  public let eventUID: String?
  public let at: Date

  enum CodingKeys: String, CodingKey {
    case uid, status, at
    case eventUID = "event_uid"
  }

  public init(uid: String, status: ThreadStatus, eventUID: String? = nil, at: Date) {
    self.uid = uid
    self.status = status
    self.eventUID = eventUID
    self.at = at
  }
}

/// What holds a thread up until Ben acts.
public struct NeedsYouBlocker: Decodable, Hashable, Sendable {
  public struct Kind: OpenEnum {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }

    /// Its worktree could not be prepared. `detail` says why.
    public static let setup: Self = "setup"
    /// Messages a restart kept for Resume.
    public static let recovered: Self = "recovered"
    /// A message a harness may have read before a restart, sent again only when Ben says so.
    public static let uncertain: Self = "uncertain"
    /// Its harness stopped the turn at the plan's usage limit.
    public static let limited: Self = "limited"
  }

  public let kind: Kind
  public let detail: String?
  /// How many messages, for recovered and uncertain.
  public let count: Int
  /// Limited: when the harness said the limit resets. Nil when it did not say.
  public let resetsAt: Date?
  /// Limited: Ben scheduled the continuation for that time.
  public let scheduled: Bool

  enum CodingKeys: String, CodingKey {
    case kind, detail, count, scheduled
    case resetsAt = "resets_at"
  }

  public init(kind: Kind, detail: String? = nil, count: Int = 0, resetsAt: Date? = nil, scheduled: Bool = false) {
    self.kind = kind
    self.detail = detail
    self.count = count
    self.resetsAt = resetsAt
    self.scheduled = scheduled
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    kind = try c.decode(Kind.self, forKey: .kind)
    detail = try c.decodeIfPresent(String.self, forKey: .detail)
    count = try c.decodeIfPresent(Int.self, forKey: .count) ?? 0
    resetsAt = try c.decodeIfPresent(Date.self, forKey: .resetsAt)
    scheduled = try c.decodeIfPresent(Bool.self, forKey: .scheduled) ?? false
  }
}

public struct NeedsYouItem: Decodable, Hashable, Sendable, Identifiable {
  public let thread: OmniThread
  /// Nil when only a blocker brings the thread here.
  public var result: NeedsYouResult?
  public let blockers: [NeedsYouBlocker]
  /// When it came to need Ben. The list is newest first.
  public let at: Date

  public var id: String { thread.id }

  public init(thread: OmniThread, result: NeedsYouResult?, blockers: [NeedsYouBlocker], at: Date) {
    self.thread = thread
    self.result = result
    self.blockers = blockers
    self.at = at
  }

  /// How a row draws it: the thread glyph it gets, as reasonOf in web/src/needs-you.ts.
  public enum Tone: Hashable, Sendable {
    case needs, done, settled
  }

  /// Why it is here, and the line under that. A blocker comes first: it waits on Ben whether he read the result or not.
  public var reason: (tone: Tone, label: String, detail: String?) {
    let preview = thread.lastText.map { String($0.split(whereSeparator: \.isWhitespace).joined(separator: " ").prefix(240)) }
      .flatMap { $0.isEmpty ? nil : $0 }
    let many = { (n: Int, one: String, more: String) in n == 1 ? one : more.replacingOccurrences(of: "#", with: String(n)) }
    if let b = blockers.first {
      switch b.kind {
      case .setup: return (.needs, "Worktree could not be prepared", b.detail)
      case .uncertain: return (.needs, many(b.count, "A message may not have been sent", "# messages may not have been sent"), preview)
      case .recovered: return (.needs, many(b.count, "A message waits for Resume", "# messages wait for Resume"), preview)
      case .limited:
        let at = b.resetsAt.map { LimitStop.resetLabel($0) }
        return (.needs, "Usage limit reached", at.map { "\(b.scheduled ? "Resumes" : "Resets") at \($0)" } ?? "No reset time given")
      default: break
      }
    }
    switch result?.status {
    case .failed: return (.needs, "Failed", preview)
    case .stopped: return (.settled, "Stopped", preview)
    default: return (.done, "Finished", preview)
    }
  }
}

/// GET /api/needs-you.
public struct NeedsYou: Decodable, Hashable, Sendable {
  public let items: [NeedsYouItem]
  /// Unread results, and threads with a blocker.
  public let unread: Int
  public let blocked: Int

  public static let empty = NeedsYou(items: [])

  public init(items: [NeedsYouItem]) {
    self.items = items
    unread = items.filter { $0.result != nil }.count
    blocked = items.filter { !$0.blockers.isEmpty }.count
  }

  /// One channel's part, with its own counts.
  public func inChannel(_ channelID: String) -> NeedsYou {
    NeedsYou(items: items.filter { $0.thread.channelID == channelID })
  }

  /// The result an open thread shows, to mark read: the inbox's unread one for it, once the thread is not running.
  /// A running thread is still writing, and the turn brings a newer result.
  public func shownResult(threadID: String, status: ThreadStatus?) -> String? {
    guard let status, !status.isActive else { return nil }
    return items.first { $0.thread.id == threadID }?.result?.uid
  }

  /// The inbox once a result is read, before the server answers: the result goes, its blockers stay.
  public func withoutResult(_ uid: String) -> NeedsYou {
    NeedsYou(items: items.compactMap { i in
      guard i.result?.uid == uid else { return i }
      guard !i.blockers.isEmpty else { return nil }
      var kept = i
      kept.result = nil
      return kept
    })
  }
}

/// POST /api/needs-you/read: the thread's item as it is now, nil when nothing about it needs Ben.
public struct NeedsYouRead: Decodable, Hashable, Sendable {
  public let threadID: String
  public let item: NeedsYouItem?

  enum CodingKeys: String, CodingKey {
    case item
    case threadID = "thread_id"
  }
}

struct ReadBody: Encodable, Sendable {
  let uid: String
}

extension OmniClient {
  /// Unread results and blockers across every thread, newest first.
  public func needsYou() async throws(OmniAPIError) -> NeedsYou {
    try await send("GET", "/api/needs-you")
  }

  /// Ben saw this result. Only it and older ones count as read, so a turn that ended after it stays unread.
  public func readResult(_ uid: String) async throws(OmniAPIError) -> NeedsYouRead {
    try await send("POST", "/api/needs-you/read", body: ReadBody(uid: uid))
  }
}
