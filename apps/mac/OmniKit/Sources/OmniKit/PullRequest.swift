import Foundation

/// What GET /api/channels/:id/prs lists: `PRSummary` in apps/web/src/api.ts.
public struct PullRequestSummary: Decodable, Hashable, Sendable, Identifiable {
  public let number: Int
  public let title: String
  public let author: PRPerson?
  public let headRefName: String
  public let baseRefName: String
  /// `OPEN`, `MERGED` or `CLOSED`. Absent from an old server's answer, which means open.
  public let state: String?
  public let isDraft: Bool
  public let updatedAt: Date
  public let reviewDecision: String?
  public let url: String
  public let additions: Int
  public let deletions: Int
  public let mergeable: String?
  public let checks: PRChecks

  public var id: Int { number }
  public var isOpen: Bool { PullRequestState.isOpen(state) }
  /// The composer's word for it, as `ThreadPR` in Thread.tsx: open, draft, merged or closed.
  public var badge: String {
    switch state {
    case "MERGED": "merged"
    case "CLOSED": "closed"
    default: isDraft ? "draft" : "open"
    }
  }
}

public struct PRPerson: Decodable, Hashable, Sendable {
  public let login: String
}

public struct PRChecks: Decodable, Hashable, Sendable {
  public let passed: Int
  public let failed: Int
  public let pending: Int

  public var isEmpty: Bool { passed == 0 && failed == 0 && pending == 0 }
}

public enum PullRequestState {
  /// The Web UI's `!p.state || p.state === 'OPEN'`: only an open PR can be merged.
  public static func isOpen(_ state: String?) -> Bool {
    state == nil || state == "OPEN"
  }
}

public enum PRTone: Sendable { case ok, bad, pending }

public struct CheckRun: Decodable, Hashable, Sendable {
  public let name: String
  /// Upper case: `SUCCESS`, `FAILURE`, `IN_PROGRESS`, or empty while it has not started.
  public let state: String
  public let url: String?

  public init(name: String, state: String, url: String?) {
    self.name = name
    self.state = state
    self.url = url
  }

  public var tone: PRTone {
    switch state {
    case "SUCCESS", "NEUTRAL", "SKIPPED": .ok
    case "FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE": .bad
    default: .pending
    }
  }
}

public struct PRFile: Decodable, Hashable, Sendable {
  public let path: String
  public let additions: Int
  public let deletions: Int
}

public struct PRReview: Decodable, Hashable, Sendable {
  public let author: PRPerson?
  public let state: String
  public let body: String?
  public let submittedAt: Date?
}

public struct PRComment: Decodable, Hashable, Sendable {
  public let author: PRPerson?
  public let body: String?
  public let createdAt: Date?
}

/// One line of the PR page's conversation: a comment, or a review that says something or is not a plain comment.
public struct PRConversationItem: Hashable, Sendable, Identifiable {
  public let id: Int
  public let who: String?
  public let at: Date?
  public let body: String
  /// The review's state, nil for a comment.
  public let reviewState: String?
}

/// GET /api/channels/:id/prs/:n. Reads the summary's fields directly, as in `pr.title`.
@dynamicMemberLookup
public struct PullRequestDetail: Decodable, Hashable, Sendable {
  public let summary: PullRequestSummary
  public let body: String
  public let files: [PRFile]
  public let reviews: [PRReview]
  public let comments: [PRComment]
  public let checkRuns: [CheckRun]
  /// The whole unified diff, as `gh pr diff` prints it (the server cuts it at 400 000 characters).
  public let diff: String
  /// The Omni thread on its head branch and the thread that delegated it. nil for a PR opened outside Omni, or from an
  /// older server.
  public let thread: PRThread?

  public subscript<T>(dynamicMember path: KeyPath<PullRequestSummary, T>) -> T {
    summary[keyPath: path]
  }

  enum CodingKeys: String, CodingKey {
    case body, files, reviews, comments, checkRuns, diff, thread
  }

  public init(from decoder: any Decoder) throws {
    summary = try PullRequestSummary(from: decoder)
    let c = try decoder.container(keyedBy: CodingKeys.self)
    body = try c.decodeIfPresent(String.self, forKey: .body) ?? ""
    files = try c.decodeIfPresent([PRFile].self, forKey: .files) ?? []
    reviews = try c.decodeIfPresent([PRReview].self, forKey: .reviews) ?? []
    comments = try c.decodeIfPresent([PRComment].self, forKey: .comments) ?? []
    checkRuns = try c.decodeIfPresent([CheckRun].self, forKey: .checkRuns) ?? []
    diff = try c.decodeIfPresent(String.self, forKey: .diff) ?? ""
    thread = try c.decodeIfPresent(PRThread.self, forKey: .thread)
  }

  /// GitHub hides HTML comments (PR templates, bots); markdown would print them.
  public static func cleanBody(_ text: String?) -> String {
    (text ?? "").replacing(#/<!--[\s\S]*?-->/#, with: "").trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// Reviews that say something or are not a plain comment, and comments, oldest first.
  public var conversation: [PRConversationItem] {
    var items: [(who: String?, at: Date?, body: String, state: String?)] = []
    for r in reviews where !(r.body ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || r.state != "COMMENTED" {
      items.append((r.author?.login, r.submittedAt, Self.cleanBody(r.body), r.state))
    }
    for c in comments {
      items.append((c.author?.login, c.createdAt, Self.cleanBody(c.body), nil))
    }
    let sorted = items.enumerated().sorted { a, b in
      let (x, y) = (a.element.at ?? .distantPast, b.element.at ?? .distantPast)
      return x == y ? a.offset < b.offset : x < y
    }
    return sorted.enumerated().map { i, entry in
      PRConversationItem(id: i, who: entry.element.who, at: entry.element.at, body: entry.element.body, reviewState: entry.element.state)
    }
  }
}

public enum PullRequestListState: String, CaseIterable, Sendable {
  case open, merged, closed, all
}

public enum MergeMethod: String, CaseIterable, Sendable, Encodable {
  case squash, merge, rebase
}

private struct MergeBody: Encodable {
  let method: MergeMethod
  let deleteBranch: Bool
  /// The API refuses a merge without it.
  let confirm = true

  enum CodingKeys: String, CodingKey {
    case method, confirm
    case deleteBranch = "delete_branch"
  }
}

private struct MergeReply: Decodable {
  let output: String?
}

/// What GET /api/threads/:id/pr answers: every PR from the thread's branch, newest first, and the one to show, plus the
/// PRs of the threads it delegated to.
public struct ThreadPullRequests: Decodable, Hashable, Sendable {
  /// The open one, else the newest. nil when the branch has none.
  public let pr: PullRequestSummary?
  public let prs: [PullRequestSummary]
  /// One PR per thread under this one in the delegation tree, at any depth, oldest delegation first. Never one of `prs`.
  public let crew: [CrewPullRequest]

  /// No PR opened from the branch is still open, so another can be.
  public var canOpenAnother: Bool { !prs.contains { $0.isOpen } }

  enum CodingKeys: String, CodingKey { case pr, prs, crew }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    pr = try c.decodeIfPresent(PullRequestSummary.self, forKey: .pr)
    // An older server answered only `pr`, and without `crew`.
    prs = try c.decodeIfPresent([PullRequestSummary].self, forKey: .prs) ?? (pr.map { [$0] } ?? [])
    crew = try c.decodeIfPresent([CrewPullRequest].self, forKey: .crew) ?? []
  }
}

/// A PR a delegated thread's branch was opened as: `CrewPR` in apps/server/crew-prs.ts. Open or merged only.
/// The thread a PR came from, and the thread that delegated it, as GET /api/channels/:id/prs/:n `thread` sends them.
public struct PRThread: Decodable, Hashable, Sendable {
  public struct Parent: Decodable, Hashable, Sendable {
    public let id: String
    public let title: String
  }

  public let id: String
  public let title: String
  public let channelID: String
  public let parent: Parent?

  enum CodingKeys: String, CodingKey {
    case id, title, parent
    case channelID = "channel_id"
  }
}

public struct CrewPullRequest: Decodable, Hashable, Sendable, Identifiable {
  public let number: Int
  public let title: String
  /// `OPEN` or `MERGED`.
  public let state: String
  public let isDraft: Bool
  public let url: String
  public let repo: String
  /// The delegated thread whose branch it came from.
  public let threadID: String
  public let threadTitle: String
  public let channelID: String
  public let taskID: String?

  public var id: String { url }
  public var isOpen: Bool { PullRequestState.isOpen(state) }
  public var badge: String { state == "MERGED" ? "merged" : isDraft ? "draft" : "open" }
  /// The task it was for, if any, and the thread it came from: "T-AB12 · Child work".
  public var byline: String {
    [taskID, threadTitle.isEmpty ? "Untitled" : threadTitle].compactMap { $0 }.joined(separator: " · ")
  }

  enum CodingKeys: String, CodingKey {
    case number, title, state, isDraft, url, repo
    case threadID = "thread_id"
    case threadTitle = "thread_title"
    case channelID = "channel_id"
    case taskID = "task_id"
  }
}

/// GET /api/prs: the PRs of every channel with a repo set, open ones first, then newest first. `AllPRs` in
/// apps/web/src/api.ts. `repos` is every repo asked, `failed` the ones gh could not read.
public struct AllPullRequests: Decodable, Hashable, Sendable {
  public let repos: [String]
  public let prs: [Listed]
  public let failed: [Failure]
  /// The gh login, which the page groups by. nil when gh cannot say, or from an older server.
  public let viewer: String?

  /// A summary, the repo it is in, and what the page searches and groups by. Reads the summary's fields directly, as
  /// in `pr.title`.
  @dynamicMemberLookup
  public struct Listed: Decodable, Hashable, Sendable, Identifiable {
    public let summary: PullRequestSummary
    public let repo: String
    /// nil from an older server.
    public let createdAt: Date?
    public let labels: [String]
    /// Logins asked to review.
    public let reviewRequests: [String]

    public var id: String { "\(repo)#\(summary.number)" }

    public subscript<T>(dynamicMember path: KeyPath<PullRequestSummary, T>) -> T {
      summary[keyPath: path]
    }

    enum CodingKeys: String, CodingKey { case repo, createdAt, labels, reviewRequests }

    public init(from decoder: any Decoder) throws {
      summary = try PullRequestSummary(from: decoder)
      let c = try decoder.container(keyedBy: CodingKeys.self)
      repo = try c.decode(String.self, forKey: .repo)
      createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt)
      labels = try c.decodeIfPresent([String].self, forKey: .labels) ?? []
      reviewRequests = try c.decodeIfPresent([String].self, forKey: .reviewRequests) ?? []
    }
  }

  public struct Failure: Decodable, Hashable, Sendable {
    public let repo: String
    public let error: String
  }

  /// Why the list has no rows, as `allPRsEmpty` in apps/web/src/pages/AllPRs.tsx. nil when it has some.
  public enum Empty: Sendable { case noRepos, allFailed, nothingYet }

  public var empty: Empty? {
    if !prs.isEmpty { return nil }
    if repos.isEmpty { return .noRepos }
    return failed.count == repos.count ? .allFailed : .nothingYet
  }

  /// The repos gh could not read, one line each.
  public var failedText: String {
    failed.map { "Could not read \($0.repo): \($0.error)" }.joined(separator: "\n")
  }
}

/// What GET /api/channels/:id/thread-prs marks a branch with: its open or merged PR.
public struct BranchPRMark: Decodable, Hashable, Sendable {
  public let number: Int
  /// `OPEN` or `MERGED`.
  public let state: String
  public let isDraft: Bool
  public let url: String

  public var isMerged: Bool { state == "MERGED" }
  /// The word the thread list's icon is labelled with, as the composer's `badge`.
  public var badge: String { isMerged ? "merged" : isDraft ? "draft" : "open" }
}

extension OmniClient {
  /// Branch name to its open or merged PR, for marking threads in a list.
  public func threadPullRequests(in channel: String) async throws(OmniAPIError) -> [String: BranchPRMark] {
    try await send("GET", "/api/channels/\(uriComponent(channel))/thread-prs")
  }

  /// The PRs opened from a thread's branch, open or not, and its crew's. Answers for a thread without a branch too.
  public func pullRequests(forThread id: String) async throws(OmniAPIError) -> ThreadPullRequests {
    try await send("GET", "/api/threads/\(uriComponent(id))/pr")
  }

  /// Every channel's PRs, open first, newest first.
  public func allPullRequests() async throws(OmniAPIError) -> AllPullRequests {
    try await send("GET", "/api/prs")
  }

  public func pullRequests(in channel: String, state: PullRequestListState = .open) async throws(OmniAPIError) -> [PullRequestSummary] {
    try await send("GET", "/api/channels/\(uriComponent(channel))/prs", query: [("state", state.rawValue)])
  }

  public func pullRequest(_ number: Int, in channel: String) async throws(OmniAPIError) -> PullRequestDetail {
    try await send("GET", "/api/channels/\(uriComponent(channel))/prs/\(number)")
  }

  /// Delegates under the PR's originating thread and returns the thread to open.
  public func review(pullRequest number: Int, in channel: String) async throws(OmniAPIError) -> String {
    struct ReviewReply: Decodable { let destination_thread_id: String }
    let reply: ReviewReply = try await send("POST", "/api/channels/\(uriComponent(channel))/prs/\(number)/review")
    return reply.destination_thread_id
  }

  /// Merges with `gh pr merge` on the server. Returns what gh printed.
  public func merge(pullRequest number: Int, in channel: String, method: MergeMethod, deleteBranch: Bool) async throws(OmniAPIError) -> String {
    let reply: MergeReply = try await send(
      "POST", "/api/channels/\(uriComponent(channel))/prs/\(number)/merge", body: MergeBody(method: method, deleteBranch: deleteBranch))
    return reply.output ?? ""
  }
}
