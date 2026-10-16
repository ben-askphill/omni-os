import Foundation

/// What GET /api/threads/:id/changes answers (`BranchChanges` in web/src/api.ts): a thread's branch changes since its
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

  /// Where it came from, in words, as `baseLabel` in web/src/changes.ts.
  public var label: String {
    if how == "thread-start" { return ref == "HEAD" ? "where the thread started" : "\(ref) when the thread started" }
    return ref == "HEAD" ? "the current commit" : "merge base with \(ref)"
  }
}

/// `committed`, `staged`, `unstaged` or `untracked`.
public struct ChangeKind: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public static let committed: Self = "committed"
  public static let staged: Self = "staged"
  public static let unstaged: Self = "unstaged"
  public static let untracked: Self = "untracked"

  public var title: String {
    switch self {
    case .committed: "Committed"
    case .staged: "Staged"
    case .unstaged: "Unstaged"
    case .untracked: "Untracked"
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

  /// Why there are no lines, in words, as web/src/changes.ts.
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
/// web/src/changes.ts.
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
    groups = changes.groups.filter { !$0.files.isEmpty }.map { g in
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

extension OmniClient {
  /// The thread's branch changes since its base commit.
  public func changes(forThread id: String) async throws(OmniAPIError) -> BranchChanges {
    try await send("GET", "/api/threads/\(uriComponent(id))/changes")
  }
}
