import Foundation

// Worktree cleanup (Settings > Machines > Storage): what a cleanup Ben starts or this Mac's retention policy would remove, and
// what a run removed, kept or failed to remove. The `cleanup` of GET /api/worktrees/scan. Mirrors
// packages/shared/worktree-cleanup.ts, which the Web UI's Storage page uses.

/// This Mac's retention policy. Off by default and never synced: each Mac decides for its own disk. When on, a
/// scheduled pass removes the worktrees of archived, merged or deleted threads idle for at least `idleDays`.
public struct RetentionPolicy: Decodable, Hashable, Sendable {
  public let enabled: Bool
  public let idleDays: Int

  private enum CodingKeys: String, CodingKey { case enabled, idleDays }

  /// The After picker's choices, with the current value among them when it is none of the usual ones.
  public var dayChoices: [Int] {
    let usual = [3, 7, 14, 30, 60, 90]
    return usual.contains(idleDays) ? usual : (usual + [idleDays]).sorted()
  }
}

/// Why a cleanup may remove a worktree.
public enum CleanupBecause: String, Hashable, Sendable, Decodable {
  case archived, merged, deleted

  public var label: String {
    switch self {
    case .archived: "Its thread is archived"
    case .merged: "Its branch is merged and the thread is idle"
    case .deleted: "Its thread was deleted"
    }
  }
}

/// A worktree a cleanup would remove, as its preview lists it.
public struct CleanupCandidate: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  public let threadId: String?
  public let threadTitle: String?
  public let channelName: String?
  public let branch: String?
  public let bytes: Int64?
  /// Nil for a reason a newer server added.
  public let because: CleanupBecause?
  /// When its thread last had a turn or message; nil for a deleted thread.
  public let lastActiveAt: Date?

  private enum CodingKeys: String, CodingKey {
    case id, threadId, threadTitle, channelName, branch, bytes, because, lastActiveAt
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    threadId = try c.decodeIfPresent(String.self, forKey: .threadId)
    threadTitle = try c.decodeIfPresent(String.self, forKey: .threadTitle)
    channelName = try c.decodeIfPresent(String.self, forKey: .channelName)
    branch = try c.decodeIfPresent(String.self, forKey: .branch)
    bytes = try c.decodeIfPresent(Int64.self, forKey: .bytes)
    because = try? c.decodeIfPresent(CleanupBecause.self, forKey: .because)
    lastActiveAt = try c.decodeIfPresent(Date.self, forKey: .lastActiveAt)
  }

  /// The thread's title, or the folder's name when it has none.
  public var title: String { threadTitle ?? id }

  /// "Gadgets · omni/1a2b3c4d", whichever of the two there is.
  public var detail: String? {
    let parts = [channelName, branch].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }
}

/// One worktree a run finished with.
public struct CleanupResult: Decodable, Hashable, Sendable, Identifiable {
  /// removed: the folder is gone; its branch, transcript, uploads and artifacts stay. kept: the check right before
  /// removal found a reason to keep it, or could not finish (`errors`). failed: git refused or the removal broke off.
  public enum Outcome: String, Hashable, Sendable, Decodable {
    case removed, kept, failed

    public init(from decoder: any Decoder) throws { self = try decodeTolerant(decoder, .kept) }

    public var label: String {
      switch self {
      case .removed: "Removed"
      case .kept: "Kept"
      case .failed: "Failed"
      }
    }
  }

  public let candidate: CleanupCandidate
  public let outcome: Outcome
  public let reasons: [KeepReason]
  public let errors: [String]

  private enum CodingKeys: String, CodingKey { case outcome, reasons, errors }

  public init(from decoder: any Decoder) throws {
    candidate = try CleanupCandidate(from: decoder)
    let c = try decoder.container(keyedBy: CodingKeys.self)
    outcome = try c.decode(Outcome.self, forKey: .outcome)
    reasons = try c.decode([KeepReason].self, forKey: .reasons)
    errors = try c.decode([String].self, forKey: .errors)
  }

  public var id: String { candidate.id }
}

/// A cleanup Ben started or a retention pass: running, or the last one finished.
public struct CleanupRun: Decodable, Hashable, Sendable {
  public enum State: String, Hashable, Sendable, Decodable {
    case running, done, failed

    public init(from decoder: any Decoder) throws { self = try decodeTolerant(decoder, .failed) }
  }

  public let id: String
  public let state: State
  public let startedAt: Date
  public let finishedAt: Date?
  /// Worktrees this run checks, and how many it has finished.
  public let total: Int
  public let done: Int
  /// In finishing order.
  public let items: [CleanupResult]
  public let freedBytes: Int64
  public let error: String?

  private enum CodingKeys: String, CodingKey {
    case id, state, startedAt, finishedAt, total, done, items, freedBytes, error
  }

  public var isRunning: Bool { state == .running }

  /// 0 through 1.
  public var progress: Double { total > 0 ? min(1, Double(done) / Double(total)) : 0 }

  /// "Removing 2 of 5", like the scan's "Checking 2 of 5".
  public var progressLabel: String { "Removing \(done) of \(total)" }

  /// "Removed 1 (8 KB freed), kept 1, failed 0".
  public var summary: String {
    func count(_ outcome: CleanupResult.Outcome) -> Int { items.count { $0.outcome == outcome } }
    return "Removed \(count(.removed)) (\(ByteSize.label(freedBytes)) freed), kept \(count(.kept)), failed \(count(.failed))"
  }
}

/// What a cleanup would remove, from the last scan. Every one is checked again right before it goes.
public struct CleanupPreview: Decodable, Hashable, Sendable {
  public let candidates: [CleanupCandidate]
  public let bytes: Int64

  private enum CodingKeys: String, CodingKey { case candidates, bytes }

  /// "2 worktrees (16 KB)".
  public var amount: String { "\(Format.plural(candidates.count, "worktree")) (\(ByteSize.label(bytes)))" }
}

/// One value for each kind of cleanup: the one Ben starts after reviewing the list, and the retention pass.
public struct ByTrigger<Value: Decodable & Hashable & Sendable>: Decodable, Hashable, Sendable {
  public let manual: Value
  public let retention: Value

  private enum CodingKeys: String, CodingKey { case manual, retention }
}

/// What Settings > Machines shows of cleanup, beside the scan.
public struct CleanupState: Decodable, Hashable, Sendable {
  public let policy: RetentionPolicy
  /// What each kind of cleanup would remove now. Nil before the first scan and while one runs.
  public let preview: ByTrigger<CleanupPreview>?
  /// The last run of each kind, or the one going.
  public let runs: ByTrigger<CleanupRun?>

  private enum CodingKeys: String, CodingKey { case policy, preview, runs }

  /// A cleanup is removing folders. One runs at a time, of either kind.
  public var isRunning: Bool { runs.manual?.isRunning == true || runs.retention?.isRunning == true }
}

/// Said wherever a cleanup is offered: what goes and what stays. CLEANUP_NOTE in the shared file.
public let worktreeCleanupNote =
  "Only the checkout folder is removed. The branch, the transcript, uploads and artifacts stay, and the next turn in the thread checks the branch out again."
