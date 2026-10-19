import Foundation

/// What GET /api/threads/:id/changes answers (`BranchChanges` in apps/web/src/api.ts): a thread's branch changes since its
/// base commit, before any PR, or why there are none to read here (`reason`).
public struct BranchChanges: Decodable, Hashable, Sendable {
  public let available: Bool
  public let reason: String?
  public let cwd: String?
  public let branch: String?
  public let head: String?
  public let base: ChangeBase?
  public let groups: [ChangeGroup]

  enum CodingKeys: String, CodingKey { case available, reason, cwd, branch, head, base, groups }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    available = try c.decode(Bool.self, forKey: .available)
    reason = try c.decodeIfPresent(String.self, forKey: .reason)
    cwd = try c.decodeIfPresent(String.self, forKey: .cwd)
    branch = try c.decodeIfPresent(String.self, forKey: .branch)
    head = try c.decodeIfPresent(String.self, forKey: .head)
    base = try c.decodeIfPresent(ChangeBase.self, forKey: .base)
    groups = try c.decodeIfPresent([ChangeGroup].self, forKey: .groups) ?? []
  }
}

public struct ChangeBase: Decodable, Hashable, Sendable {
  public let sha: String
  /// The branch it came from, or `HEAD`.
  public let ref: String
  /// `thread-start` (where the worktree was cut) or `merge-base` (with the default branch).
  public let how: String
  public let recordedAt: Date?

  enum CodingKeys: String, CodingKey {
    case sha, ref, how
    case recordedAt = "recorded_at"
  }

  public var short: String { String(sha.prefix(7)) }

  /// Where it came from, in words, as `baseLabel` in apps/web/src/changes.ts.
  public var label: String {
    if how == "thread-start" { return ref == "HEAD" ? "where the thread started" : "\(ref) when the thread started" }
    return ref == "HEAD" ? "the current commit" : "merge base with \(ref)"
  }
}

/// `committed`, `staged`, `unstaged` or `untracked`, or `turn`: what one turn changed between its saved snapshots.
public struct ChangeKind: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let committed: Self = "committed"
  public static let staged: Self = "staged"
  public static let unstaged: Self = "unstaged"
  public static let untracked: Self = "untracked"
  public static let turn: Self = "turn"

  public var title: String {
    switch self {
    case .committed: "Committed"
    case .staged: "Staged"
    case .unstaged: "Unstaged"
    case .untracked: "Untracked"
    case .turn: "Changed in this turn"
    default: rawValue.capitalized
    }
  }
}

public struct ChangeGroup: Decodable, Hashable, Sendable {
  public let kind: ChangeKind
  public let files: [ChangedFile]
  /// More files changed than are listed.
  public let truncated: Bool
}

public struct ChangedFile: Decodable, Hashable, Sendable {
  public let path: String
  public let oldPath: String?
  /// added, modified, deleted, renamed, copied, type_changed or unmerged.
  public let status: String
  /// nil when git cannot count them (binary) or the file was too big to read.
  public let additions: Int?
  public let deletions: Int?
  public let binary: Bool
  /// Why `diff` is empty: binary, too_large, limit, symlink or unavailable.
  public let omitted: String?
  public let diff: String

  enum CodingKeys: String, CodingKey {
    case path, status, additions, deletions, binary, omitted, diff
    case oldPath = "old_path"
  }

  /// One letter per status, as git prints it.
  public var letter: String {
    switch status {
    case "added": "A"
    case "deleted": "D"
    case "renamed": "R"
    case "copied": "C"
    case "type_changed": "T"
    case "unmerged": "U"
    default: "M"
    }
  }

  /// `old → new` for a rename or copy, else the path.
  public var label: String { oldPath.map { "\($0) → \(path)" } ?? path }

  /// Why there are no lines, in words, as apps/web/src/changes.ts.
  public var notice: String? {
    switch omitted {
    case "binary": "Binary file, not shown."
    case "too_large": "Too large to show here."
    case "limit": "Not shown: too much changed to show every file."
    case "symlink": "Symbolic link, not followed."
    case "unavailable": "Git gave no diff for this file."
    default: nil
    }
  }
}

/// The Changes panel's model: the groups that have files, each file's lines numbered, and totals. `changesView` in
/// apps/web/src/changes.ts.
public struct ChangesView: Hashable, Sendable {
  public struct File: Hashable, Sendable, Identifiable {
    public let id: String
    public let file: ChangedFile
    /// The file's lines. Its counts are the server's, which also has them for files it sent no text for.
    public let diff: FileDiff
  }

  public struct Group: Hashable, Sendable, Identifiable {
    public let kind: ChangeKind
    public let files: [File]
    public let truncated: Bool
    public var id: String { kind.rawValue }
  }

  public let base: ChangeBase
  public let branch: String?
  public let groups: [Group]

  public var fileCount: Int { groups.reduce(0) { $0 + $1.files.count } }
  public var additions: Int { groups.reduce(0) { $0 + $1.files.reduce(0) { $0 + $1.diff.add } } }
  public var deletions: Int { groups.reduce(0) { $0 + $1.files.reduce(0) { $0 + $1.diff.del } } }

  /// nil when the answer has no changes to read (`available` false).
  public init?(_ changes: BranchChanges) {
    guard changes.available, let base = changes.base else { return nil }
    self.base = base
    branch = changes.branch
    groups = Self.groups(changes.groups)
  }

  /// The groups that have files, in the server's order, each file's lines numbered.
  static func groups(_ list: [ChangeGroup]) -> [Group] {
    list.filter { !$0.files.isEmpty }.map { g in
      Group(kind: g.kind, files: g.files.map { f in
        let parsed = f.diff.isEmpty ? nil : DiffParser.parse(f.diff).first
        let diff = FileDiff(
          path: f.path, header: parsed?.header ?? [], lines: parsed?.lines ?? [],
          add: f.additions ?? parsed?.add ?? 0, del: f.deletions ?? parsed?.del ?? 0, binary: f.binary)
        return File(id: "\(g.kind.rawValue):\(f.path)", file: f, diff: diff)
      }, truncated: g.truncated)
    }
  }
}

// MARK: This turn

/// One side of a saved turn (`TurnSide` in apps/web/src/api.ts): a snapshot commit under a hidden ref, and HEAD then.
public struct TurnSide: Decodable, Hashable, Sendable {
  public let sha: String
  public let ref: String
  public let head: String
}

/// `running`, `capturing` (ended, its after snapshot being saved), `ready` or `failed`.
public struct TurnState: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let running: Self = "running"
  public static let capturing: Self = "capturing"
  public static let ready: Self = "ready"
  public static let failed: Self = "failed"
}

/// One turn's saved snapshots (`TurnView` in apps/web/src/api.ts).
public struct TurnView: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  public let n: Int
  public let state: TurnState
  public let error: String?
  public let before: TurnSide?
  public let after: TurnSide?
  /// The Result the turn ended with, the same id as in Needs you.
  public let completionUID: String?
  public let startedAt: Date?
  public let endedAt: Date?

  enum CodingKeys: String, CodingKey {
    case id, n, state, error, before, after
    case completionUID = "completion_uid"
    case startedAt = "started_at"
    case endedAt = "ended_at"
  }

  /// "Turn 3", as `turnTitle` in apps/web/src/changes.ts.
  public var title: String { "Turn \(n)" }

  /// Why the turn has no files to show yet, or ever. nil once both snapshots are saved. `turnStateNote` on the web.
  public var stateNote: String? {
    switch state {
    case .running: "This turn is still running. Its changes show once it ends."
    case .capturing: "Saving the worktree after this turn."
    case .failed: error ?? "This turn could not be saved."
    default: nil
    }
  }

  /// HEAD moved during the turn (a commit, a pull, a reset): `abc1234 → def5678`. nil when it stayed put.
  public var headMove: String? {
    guard let before, let after, before.head != after.head else { return nil }
    return "\(before.head.prefix(7)) → \(after.head.prefix(7))"
  }
}

/// What GET /api/threads/:id/turns answers (`TurnChanges` in apps/web/src/api.ts).
public struct TurnChanges: Decodable, Hashable, Sendable {
  public let available: Bool
  public let reason: String?
  /// Newest first.
  public let turns: [TurnView]
  /// The turn shown: the one asked for, else the newest.
  public let turn: TurnView?
  public let groups: [ChangeGroup]
}

/// The This turn view's model, as `turnChangesView` in apps/web/src/changes.ts.
public struct TurnChangesView: Hashable, Sendable {
  /// What the diff is, said where it is shown: a snapshot, not authorship.
  public static let note =
    "The worktree saved before and after this turn. Commits, pulls and other git operations made during the turn are part of it; ignored files are not saved."

  public let turn: TurnView
  public let groups: [ChangesView.Group]

  public var fileCount: Int { groups.reduce(0) { $0 + $1.files.count } }
  public var additions: Int { groups.reduce(0) { $0 + $1.files.reduce(0) { $0 + $1.diff.add } } }
  public var deletions: Int { groups.reduce(0) { $0 + $1.files.reduce(0) { $0 + $1.diff.del } } }

  /// nil when no turn is saved, or none can be here.
  public init?(_ changes: TurnChanges) {
    guard changes.available, let turn = changes.turn else { return nil }
    self.turn = turn
    groups = ChangesView.groups(changes.groups)
  }
}

extension OmniClient {
  /// The thread's branch changes since its base commit.
  public func changes(forThread id: String) async throws(OmniAPIError) -> BranchChanges {
    try await send("GET", "/api/threads/\(uriComponent(id))/changes")
  }

  /// The thread's saved turns and the diff of `turn`, the newest when nil.
  public func turns(forThread id: String, turn: String? = nil) async throws(OmniAPIError) -> TurnChanges {
    try await send("GET", "/api/threads/\(uriComponent(id))/turns", query: turn.map { [("turn", $0)] } ?? [])
  }
}
