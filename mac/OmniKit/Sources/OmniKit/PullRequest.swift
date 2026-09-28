import Foundation

/// What GET /api/channels/:id/prs lists: `PRSummary` in web/src/api.ts.
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

  public subscript<T>(dynamicMember path: KeyPath<PullRequestSummary, T>) -> T {
    summary[keyPath: path]
  }

  enum CodingKeys: String, CodingKey {
    case body, files, reviews, comments, checkRuns, diff
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

  /// Ask for review: a builder thread on the PR, worded as the Web UI's button.
  public static func reviewThread(number: Int, repo: String, channel: String) -> NewThread {
    NewThread(
      channel: channel,
      prompt: "Review PR #\(number) in \(repo): summarize the change, risks, and anything that should block merge.",
      role: "builder")
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

extension OmniClient {
  public func pullRequests(in channel: String, state: PullRequestListState = .open) async throws(OmniAPIError) -> [PullRequestSummary] {
    try await send("GET", "/api/channels/\(uriComponent(channel))/prs", query: [("state", state.rawValue)])
  }

  public func pullRequest(_ number: Int, in channel: String) async throws(OmniAPIError) -> PullRequestDetail {
    try await send("GET", "/api/channels/\(uriComponent(channel))/prs/\(number)")
  }

  /// Merges with `gh pr merge` on the server. Returns what gh printed.
  public func merge(pullRequest number: Int, in channel: String, method: MergeMethod, deleteBranch: Bool) async throws(OmniAPIError) -> String {
    let reply: MergeReply = try await send(
      "POST", "/api/channels/\(uriComponent(channel))/prs/\(number)/merge", body: MergeBody(method: method, deleteBranch: deleteBranch))
    return reply.output ?? ""
  }
}
