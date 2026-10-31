import Foundation
import Observation

// The commit a new worktree thread's branch is cut from: the shapes of packages/shared/worktree-base.ts, and what the
// new-thread composer's Base picker and the setup card say about them.

/// What Ben chose as the base. The server keeps it with the thread until it is resolved to a commit.
public enum BasePick: Codable, Hashable, Sendable {
  /// The commit the channel's repo has checked out. What every thread did before there was a choice.
  case head
  /// An existing ref of the repo (a branch, a tag, `origin/main`), never fetched.
  case ref(String)
  /// The default branch of `origin`, fetched first.
  case remoteDefault

  enum CodingKeys: String, CodingKey { case kind, ref }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(String.self, forKey: .kind) {
    case "head": self = .head
    case "remote-default": self = .remoteDefault
    case "ref": self = .ref(try c.decode(String.self, forKey: .ref))
    case let kind:
      throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "Not a base pick: \(kind)")
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .head: try c.encode("head", forKey: .kind)
    case .remoteDefault: try c.encode("remote-default", forKey: .kind)
    case .ref(let ref):
      try c.encode("ref", forKey: .kind)
      try c.encode(ref, forKey: .ref)
    }
  }

  /// The pick in words, for a line that names it before it has a commit (`pickLabel`).
  public var label: String {
    switch self {
    case .ref(let ref): ref
    case .remoteDefault: "origin's default branch"
    case .head: "the repo's current commit"
    }
  }
}

public struct BaseRefKind: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let branch: Self = "branch"
  public static let tag: Self = "tag"
}

/// A ref worth listing in the picker.
public struct BaseRef: Decodable, Hashable, Sendable {
  /// The short name git resolves: `main`, `release/1.2`, `v3.0`.
  public let ref: String
  public let kind: BaseRefKind
  public let sha: String
  /// The branch the channel's repo has checked out.
  public let current: Bool
}

public struct BaseHead: Decodable, Hashable, Sendable {
  /// The branch checked out, or `HEAD` when detached.
  public let ref: String
  public let sha: String
}

/// `origin` as the repo last saw it.
public struct BaseRemote: Decodable, Hashable, Sendable {
  public let remote: String
  /// nil when the repo never fetched origin's default branch.
  public let branch: String?
  public let sha: String?
}

/// GET /api/channels/:id/bases: what the new-thread composer offers for a channel. `head`, `refs` and `remote` only
/// mean something when `available`; a channel without a repo or worktrees says why in `reason`.
public struct BaseOptions: Decodable, Hashable, Sendable {
  public let available: Bool
  public let reason: String?
  /// The default: the commit a thread starts from when Ben picks nothing.
  public let head: BaseHead?
  public let refs: [BaseRef]
  public let remote: BaseRemote?

  enum CodingKeys: String, CodingKey { case available, reason, head, refs, remote }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    available = try c.decode(Bool.self, forKey: .available)
    reason = try c.decodeIfPresent(String.self, forKey: .reason)
    if available {
      head = try c.decode(BaseHead.self, forKey: .head)
      refs = try c.decodeIfPresent([BaseRef].self, forKey: .refs) ?? []
      remote = try c.decodeIfPresent(BaseRemote.self, forKey: .remote)
    } else {
      (head, refs, remote) = (nil, [], nil)
    }
  }
}

/// GET /api/threads/:id/base: where a worktree thread's branch starts. The call answers null for a thread with no worktree.
public struct ThreadBaseView: Decodable, Hashable, Sendable {
  public let pick: BasePick
  /// The commit it was cut from, nil until it is resolved. It never changes afterwards.
  public let sha: String?
  /// The ref it was resolved from, like `main` or `origin/main`.
  public let ref: String?

  /// The setup card's line: "Branching from origin/main @ a1b2c3d", or the pick in words until it has a commit.
  public var line: String {
    guard let ref, let sha else { return "Branching from \(pick.label)" }
    return "Branching from \(ref) @ \(BaseRules.short(sha))"
  }
}

/// One row of the Base picker.
public struct BaseChoice: Hashable, Sendable, Identifiable {
  public enum Group: Hashable, Sendable { case current, remote, branch, tag }
  public let pick: BasePick
  public let group: Group
  public let title: String
  public var id: BasePick { pick }
}

public enum BaseRules {
  /// The short form of a commit id, as `git rev-parse --short` and the Changes panel write it.
  public static func short(_ sha: String) -> String { String(sha.prefix(7)) }

  /// The picker's rows: the current checkout (the default), origin's default branch when the repo has an origin, then
  /// local branches and tags in the order the server sent them. The checked out branch is the first row, so it is not
  /// listed twice. Empty when the channel offers no choice.
  public static func choices(_ options: BaseOptions) -> [BaseChoice] {
    guard options.available, let head = options.head else { return [] }
    var rows = [BaseChoice(pick: .head, group: .current, title: "Current checkout: \(head.ref) (\(short(head.sha)))")]
    if let remote = options.remote {
      let name = remote.branch.map { "\(remote.remote)/\($0)" } ?? "\(remote.remote)'s default branch"
      rows.append(BaseChoice(pick: .remoteDefault, group: .remote, title: "Remote default: \(name)"))
    }
    for r in options.refs where !r.current {
      rows.append(BaseChoice(pick: .ref(r.ref), group: r.kind == .tag ? .tag : .branch, title: "\(r.ref) (\(short(r.sha)))"))
    }
    return rows
  }

  /// The pill's text for the pick: "From main" and its short commit, when the options know it.
  public static func summary(_ pick: BasePick, in options: BaseOptions) -> (title: String, sha: String?) {
    switch pick {
    case .head:
      guard let head = options.head else { return ("From \(pick.label)", nil) }
      return ("From \(head.ref)", short(head.sha))
    case .remoteDefault:
      guard let remote = options.remote, let branch = remote.branch else { return ("From \(pick.label)", nil) }
      return ("From \(remote.remote)/\(branch)", remote.sha.map(short))
    case .ref(let ref):
      return ("From \(ref)", options.refs.first { $0.ref == ref }.map { short($0.sha) })
    }
  }

  /// Whether the picker shows. A remote harness (Hermes, Cursor Cloud) has no worktree to cut, and a channel can offer
  /// no choice.
  public static func isOffered(_ options: BaseOptions?, harness: HarnessID) -> Bool {
    options?.available == true && !harness.runsOnProvider
  }

  /// The `base` of the create request: nil for the default, which is also what the server does with none, and for a
  /// harness that has no worktree.
  public static func sent(_ pick: BasePick, harness: HarnessID) -> BasePick? {
    pick == .head || harness.runsOnProvider ? nil : pick
  }
}

public protocol BasesAPI: Sendable {
  func channelBases(_ id: String) async throws(OmniAPIError) -> BaseOptions
}

/// The options of the channel the new-thread box is on. A failed load leaves the picker as it was (hidden for a
/// channel not loaded yet).
@MainActor @Observable
public final class BaseOptionsModel {
  public private(set) var options: BaseOptions?
  public private(set) var channel: String?
  @ObservationIgnored private var generation = 0

  public init() {}

  public func load(channel: String, api: any BasesAPI) async {
    if self.channel != channel {
      self.channel = channel
      options = nil
    }
    generation += 1
    let mine = generation
    let loaded = try? await api.channelBases(channel)
    // The answer to the latest ask wins, and one for a channel Ben has left is dropped.
    guard mine == generation, let loaded else { return }
    options = loaded
  }
}
