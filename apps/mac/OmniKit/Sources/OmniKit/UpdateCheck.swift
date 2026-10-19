import Foundation

/// Which parts are behind the repo's main.
public struct UpdateNotices: Hashable, Sendable {
  public var serverBehind = false
  public var appBehind = false

  public init(serverBehind: Bool = false, appBehind: Bool = false) {
    self.serverBehind = serverBehind
    self.appBehind = appBehind
  }

  public var isEmpty: Bool { !serverBehind && !appBehind }
}

public enum UpdateCheck {
  /// Two commit ids name the same commit: equal, or one is an abbreviation of the other (7 characters or more).
  public static func same(_ a: String, _ b: String) -> Bool {
    let (a, b) = (a.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), b.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    guard !a.isEmpty, !b.isEmpty else { return false }
    if a == b { return true }
    let (short, long) = a.count <= b.count ? (a, b) : (b, a)
    return short.count >= 7 && long.hasPrefix(short)
  }

  /// A notice shows when a commit is known, differs from main's and does not already contain main. A commit
  /// the check can't know (a server older than #76, a build without a stamp, no main) never shows one.
  /// `containsMain` says, per commit, whether main is among its ancestors: a branch ahead of main is not behind,
  /// and Restart or Rebuild from that checkout could never clear it. A commit missing from it counts as not.
  public static func notices(
    serverHead: String?, appCommit: String?, mainHead: String?, containsMain: [String: Bool] = [:]
  ) -> UpdateNotices {
    guard let main = mainHead, !main.isEmpty else { return UpdateNotices() }
    func behind(_ commit: String?) -> Bool {
      guard let commit, !commit.isEmpty else { return false }
      return !same(commit, main) && containsMain[commit] != true
    }
    return UpdateNotices(serverBehind: behind(serverHead), appBehind: behind(appCommit))
  }
}

public enum RepoHead {
  /// The commit `main` points at in the repo, nil when git can't say.
  public static func main(repo: URL) async -> String? {
    let out = await Spawn.capture(
      "/usr/bin/git", ["-C", repo.path, "rev-parse", "--verify", "--quiet", "main^{commit}"],
      environment: ["HOME": NSHomeDirectory(), "PATH": "/usr/bin:/bin"], timeout: .seconds(5)
    )
    guard let out, out.status == 0 else { return nil }
    let text = String(decoding: out.output, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? nil : text
  }

  /// Whether `ancestor` is in `commit`'s history, nil when git can't say (an unknown commit, no repo).
  public static func contains(repo: URL, commit: String, ancestor: String) async -> Bool? {
    let out = await Spawn.capture(
      "/usr/bin/git", ["-C", repo.path, "merge-base", "--is-ancestor", ancestor, commit],
      environment: ["HOME": NSHomeDirectory(), "PATH": "/usr/bin:/bin"], timeout: .seconds(5)
    )
    switch out?.status {
    case 0: return true
    case 1: return false
    default: return nil
    }
  }
}

public enum AppBuild {
  /// The commit `scripts/build-mac.sh` stamped into this app. nil for a build that was not stamped.
  public static var commit: String? {
    let value = Bundle.main.object(forInfoDictionaryKey: "OmniGitCommit") as? String
    return value?.isEmpty == false ? value : nil
  }
}
