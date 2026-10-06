import Foundation

public struct ChannelKind: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let client: Self = "client"
  public static let `internal`: Self = "internal"
  public static let personal: Self = "personal"
  public static let system: Self = "system"
}

/// A channel row. Field names follow `Channel` in server/db.ts.
public struct Channel: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  public let name: String
  public let kind: ChannelKind
  public let repoPath: String?
  public let githubRepo: String?
  public let useWorktree: Bool
  public let baseDir: String?
  public let storeDomain: String?
  public let portalSlug: String?
  public let browserHeadless: Bool
  public let notes: String?
  /// One emoji shown in place of the letter avatar and the sidebar's #.
  public let icon: String?
  /// The name and size in bytes of the channel's design system file, a standalone HTML page its threads follow. The file stays on the server.
  public let designSystemName: String?
  public let designSystemSize: Int
  public let archived: Bool
  public let createdAt: Date
  /// What a new thread here runs on unless the thread or its crew role picks. nil is Claude Code's default.
  public let defaultHarness: HarnessID?
  public let defaultModel: String?
  public let defaultEffort: String?

  enum CodingKeys: String, CodingKey {
    case id, name, kind, notes, icon, archived
    case repoPath = "repo_path"
    case designSystemName = "design_system_name"
    case designSystemSize = "design_system_size"
    case githubRepo = "github_repo"
    case useWorktree = "use_worktree"
    case baseDir = "base_dir"
    case storeDomain = "store_domain"
    case portalSlug = "portal_slug"
    case browserHeadless = "browser_headless"
    case createdAt = "created_at"
    case defaultHarness = "default_harness"
    case defaultModel = "default_model"
    case defaultEffort = "default_effort"
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    name = try c.decode(String.self, forKey: .name)
    kind = try c.decode(ChannelKind.self, forKey: .kind)
    repoPath = try c.decodeIfPresent(String.self, forKey: .repoPath)
    githubRepo = try c.decodeIfPresent(String.self, forKey: .githubRepo)
    useWorktree = try c.decodeFlag(.useWorktree)
    baseDir = try c.decodeIfPresent(String.self, forKey: .baseDir)
    storeDomain = try c.decodeIfPresent(String.self, forKey: .storeDomain)
    portalSlug = try c.decodeIfPresent(String.self, forKey: .portalSlug)
    browserHeadless = try c.decodeFlag(.browserHeadless)
    notes = try c.decodeIfPresent(String.self, forKey: .notes)
    icon = try c.decodeIfPresent(String.self, forKey: .icon)
    designSystemName = try c.decodeIfPresent(String.self, forKey: .designSystemName)
    designSystemSize = try c.decodeIfPresent(Int.self, forKey: .designSystemSize) ?? 0
    archived = try c.decodeFlag(.archived)
    createdAt = try c.decode(Date.self, forKey: .createdAt)
    defaultHarness = try c.decodeIfPresent(String.self, forKey: .defaultHarness).flatMap { $0.isEmpty ? nil : HarnessID(rawValue: $0) }
    defaultModel = try c.decodeIfPresent(String.self, forKey: .defaultModel).flatMap { $0.isEmpty ? nil : $0 }
    defaultEffort = try c.decodeEffort(.defaultEffort)
  }

  public var runDefaults: RunDefaults { RunDefaults(harness: defaultHarness, model: defaultModel, effort: defaultEffort) }
}

/// A channel as GET /api/channels lists it: the row plus its running and queued threads.
/// Reads the row's fields directly, as in `c.name`.
@dynamicMemberLookup
public struct ChannelWithRunning: Decodable, Hashable, Sendable, Identifiable {
  public let channel: Channel
  public let running: Int
  public let active: [ThreadStub]
  /// Its latest threads of any status, for the highlighted channel to keep finished ones findable.
  public let recent: [ThreadStub]

  public var id: String { channel.id }

  public subscript<T>(dynamicMember path: KeyPath<Channel, T>) -> T {
    channel[keyPath: path]
  }

  enum CodingKeys: String, CodingKey {
    case running, active, recent
  }

  public init(from decoder: any Decoder) throws {
    channel = try Channel(from: decoder)
    let c = try decoder.container(keyedBy: CodingKeys.self)
    running = try c.decodeIfPresent(Int.self, forKey: .running) ?? 0
    active = try c.decodeIfPresent([ThreadStub].self, forKey: .active) ?? []
    recent = try c.decodeIfPresent([ThreadStub].self, forKey: .recent) ?? []
  }
}

/// The few thread fields the sidebar lists under a channel.
public struct ThreadStub: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  public let channelID: String
  public let title: String
  public let status: ThreadStatus
  public let createdAt: Date

  enum CodingKeys: String, CodingKey {
    case id, title, status
    case channelID = "channel_id"
    case createdAt = "created_at"
  }

  /// The sidebar's row for a thread it has the whole of.
  public init(_ t: OmniThread) {
    id = t.id
    channelID = t.channelID
    title = t.title
    status = t.status
    createdAt = t.createdAt
  }
}
