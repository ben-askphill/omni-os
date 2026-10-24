import Foundation

/// Why a watch stopped polling: `PRWatchStop` in packages/shared/pr-watch.ts.
public struct PRWatchStop: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let stopped: Self = "stopped"
  public static let archived: Self = "archived"
  public static let merged: Self = "merged"
  public static let closed: Self = "closed"
  public static let wakeLimit: Self = "wake_limit"
  public static let commentLimit: Self = "comment_limit"
  public static let errorLimit: Self = "error_limit"
}

public struct PRWatchState: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let watching: Self = "watching"
  public static let stopped: Self = "stopped"
}

/// GET, PUT and DELETE /api/threads/:id/pr-watch: the server polls a thread's PR and wakes the thread when something
/// new needs it. `PRWatchView` in packages/shared/pr-watch.ts.
public struct PRWatch: Decodable, Hashable, Sendable {
  public let threadID: String
  public let repo: String
  public let number: Int
  public let state: PRWatchState
  public let stopReason: PRWatchStop?
  /// The PR head at the last observation.
  public let headSHA: String?
  /// Check counts at the last observation.
  public let checks: PRChecks?
  /// How often this watch woke its thread, of at most `maxWakes`.
  public let wakes: Int
  public let maxWakes: Int
  public let lastWakeAt: Date?
  public let lastPolledAt: Date?
  public let nextPollAt: Date?
  /// The last poll's failure, cleared by the next good one.
  public let error: String?
  public let createdAt: Date
  public let updatedAt: Date

  enum CodingKeys: String, CodingKey {
    case repo, number, state, checks, wakes, error
    case threadID = "thread_id"
    case stopReason = "stop_reason"
    case headSHA = "head_sha"
    case maxWakes = "max_wakes"
    case lastWakeAt = "last_wake_at"
    case lastPolledAt = "last_polled_at"
    case nextPollAt = "next_poll_at"
    case createdAt = "created_at"
    case updatedAt = "updated_at"
  }

  public var isWatching: Bool { state == .watching }

  /// The menu row's two lines: what pressing it does, and the watch's line or what a watch would do. `watchCopy` in
  /// apps/web/src/components/thread/PRWatch.tsx.
  public static func copy(_ w: PRWatch?) -> (action: String, line: String) {
    (w?.isWatching == true ? "Stop watching" : "Watch PR", w?.watchLine ?? "Wakes this thread when a check fails or a review comes in")
  }

  /// The one line a client shows for a watch: what it sees now, or why it stopped. `watchLine` in
  /// packages/shared/pr-watch.ts.
  public var watchLine: String {
    if state == .stopped {
      return switch stopReason ?? .stopped {
      case .archived: "Watch stopped: thread archived"
      case .merged: "Watch ended: PR merged"
      case .closed: "Watch ended: PR closed"
      case .wakeLimit: "Watch stopped after its wake limit"
      case .commentLimit: "Watch stopped after its review wake limit"
      case .errorLimit: "Watch stopped: GitHub kept failing"
      default: "Watch stopped"
      }
    }
    if error != nil { return "Watching checks and reviews, retrying GitHub" }
    guard let c = checks else { return "Watching checks and reviews" }
    if c.failed > 0 { return "Watching checks and reviews: \(c.failed) failing" }
    if c.pending > 0 { return "Watching checks and reviews: \(c.pending) running" }
    if c.passed > 0 { return "Watching checks and reviews: all passed" }
    return "Watching checks and reviews"
  }
}

/// One thing a PR watch's wake was about: a failing check, or a review comment with its author and a bounded excerpt.
/// `PRWakeItem` in packages/shared/pr-watch.ts. The message's `items` hold the first few, `more` counts the rest.
public struct PRWakeItem: Decodable, Hashable, Sendable {
  /// `checks` or `feedback`.
  public let source: String
  /// A check's name, or the comment's author.
  public let label: String
  public let url: String?
  /// Feedback only: the comment cut to size.
  public let excerpt: String?
  /// Feedback only: what it is, e.g. "changes requested".
  public let kind: String?
}

extension OmniClient {
  /// The thread's PR watch, nil when it never had one.
  public func prWatch(forThread id: String) async throws(OmniAPIError) -> PRWatch? {
    try await send("GET", "/api/threads/\(uriComponent(id))/pr-watch")
  }

  /// Watches the open PR of the thread's branch. Starting a stopped watch again resets its wake budget. The server
  /// refuses with a 409 when the thread has no open PR or its channel no GitHub repo.
  public func startPRWatch(forThread id: String) async throws(OmniAPIError) -> PRWatch {
    try await send("PUT", "/api/threads/\(uriComponent(id))/pr-watch", body: [String: String]())
  }

  /// Stops the thread's watch. nil when it never had one.
  public func stopPRWatch(forThread id: String) async throws(OmniAPIError) -> PRWatch? {
    try await send("DELETE", "/api/threads/\(uriComponent(id))/pr-watch")
  }
}
