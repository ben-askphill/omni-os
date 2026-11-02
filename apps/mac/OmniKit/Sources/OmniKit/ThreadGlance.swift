import Foundation

/// The top of the inspector's Details tab: a branch PR's state and the one step it calls for, as
/// packages/shared/thread-glance.ts. Ben's threads mostly end as a merged PR: open it, fix conflicts, fix checks, merge.
public enum ThreadGlance {
  public static let openPRPrompt = "Commit your work, push the branch and open a PR with gh. Reply with the PR URL."
  public static let fixConflictsPrompt = "Rebase this branch on its base branch, resolve the merge conflicts, run the tests and force-push with lease."
  public static let fixChecksPrompt = "The PR has failing checks. Read the failing check logs with gh, fix the cause, run the tests and push."

  public enum Tone: Sendable, Equatable { case live, done, needs, outline }

  public enum Next: Sendable, Equatable {
    case open, conflicts, checks, merge

    public var label: String {
      switch self {
      case .open: "Open PR"
      case .conflicts: "Fix conflicts"
      case .checks: "Fix checks"
      case .merge: "Merge"
      }
    }

    /// What the button asks the agent. Merge has none: it opens the PR page, where the merge is confirmed.
    public var prompt: String? {
      switch self {
      case .open: ThreadGlance.openPRPrompt
      case .conflicts: ThreadGlance.fixConflictsPrompt
      case .checks: ThreadGlance.fixChecksPrompt
      case .merge: nil
      }
    }
  }

  /// `prNext`: open a PR for a branch with changes, then conflicts, then failing checks, then merge. Nothing for a merged
  /// or closed PR, while checks still run, or for a draft.
  public static func next(_ pr: PullRequestSummary?, hasChanges: Bool) -> Next? {
    guard let pr else { return hasChanges ? .open : nil }
    guard pr.isOpen else { return nil }
    if pr.mergeable == "CONFLICTING" { return .conflicts }
    if pr.checks.failed > 0 { return .checks }
    if pr.checks.pending > 0 || pr.isDraft { return nil }
    return .merge
  }

  /// `prLine`: what decides whether the PR can merge, in a few words.
  public static func line(_ pr: PullRequestSummary) -> (text: String, tone: Tone) {
    switch pr.state {
    case "MERGED": return ("Merged", .done)
    case "CLOSED": return ("Closed without merging", .outline)
    default: break
    }
    if pr.mergeable == "CONFLICTING" { return ("Conflicts with the base branch", .needs) }
    let c = pr.checks
    let total = c.passed + c.failed + c.pending
    if c.failed > 0 { return ("\(c.failed) of \(total) checks failing", .needs) }
    if c.pending > 0 { return ("\(c.pending) of \(total) checks running", .live) }
    if pr.reviewDecision == "CHANGES_REQUESTED" { return ("Changes requested", .needs) }
    let checks = total > 0 ? "\(total) checks passed" : "No checks"
    return (pr.reviewDecision == "APPROVED" ? "\(checks) · approved" : checks, pr.isDraft ? .outline : .live)
  }
}
