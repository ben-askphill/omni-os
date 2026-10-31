import Foundation

// The user config behind onboarding and Settings' General and Workspace tabs, as the Web UI's Onboarding.tsx and Settings.tsx read it:
// GET and PUT /api/setup, POST /api/setup/complete (apps/server/setup-api.ts). Empty strings mean "use the default".
// The contract is packages/shared/settings.ts; apps/server/tests/mac-fixtures.test.ts checks these structs hold each
// field Settings shows.

public struct UserConfig: Codable, Hashable, Sendable {
  public struct User: Codable, Hashable, Sendable {
    public var name = ""
    public var pronouns = "they/them"
    public var email = ""
    public var timezone = ""
    public init() {}
  }
  public struct Workspace: Codable, Hashable, Sendable {
    public var root = ""
    public var reposDir = ""
    public var githubOwner = ""
    public init() {}
  }
  public struct Integrations: Codable, Hashable, Sendable {
    public var hermesUrl = ""
    public var centralBrainDir = ""
    public init() {}
  }
  /// Where new threads run unless the composer picks another machine (RunOn.swift).
  public struct RunOn: Codable, Hashable, Sendable {
    /// A synced machine's id, or "" for this one.
    public var device = ""
    public init(device: String = "") { self.device = device }
  }
  public var onboardedAt: String?
  public var user = User()
  public var workspace = Workspace()
  public var integrations = Integrations()
  /// nil from a server before run-on.
  public var runOn: RunOn?

  public init() {}
}

/// What PUT /api/setup and POST /api/setup/complete take: the sections to change, each sent whole. The server keeps
/// a section left out.
public struct SetupPatch: Encodable, Hashable, Sendable {
  public var user: UserConfig.User?
  public var workspace: UserConfig.Workspace?
  public var integrations: UserConfig.Integrations?
  public var runOn: UserConfig.RunOn?

  public init(
    user: UserConfig.User? = nil, workspace: UserConfig.Workspace? = nil, integrations: UserConfig.Integrations? = nil,
    runOn: UserConfig.RunOn? = nil
  ) {
    self.user = user
    self.workspace = workspace
    self.integrations = integrations
    self.runOn = runOn
  }

  /// Trimmed, the name's inner runs of spaces collapsed, pronouns never empty.
  public static func cleaned(_ c: UserConfig, integrations: Bool = true) -> SetupPatch {
    var u = c.user
    u.name = u.name.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    u.email = u.email.trimmed
    u.timezone = u.timezone.trimmed
    u.pronouns = u.pronouns.trimmed.isEmpty ? "they/them" : u.pronouns.trimmed
    var w = c.workspace
    w.root = w.root.trimmed
    w.reposDir = w.reposDir.trimmed
    w.githubOwner = w.githubOwner.trimmed
    var i = c.integrations
    i.hermesUrl = i.hermesUrl.trimmed
    i.centralBrainDir = i.centralBrainDir.trimmed
    return SetupPatch(user: u, workspace: w, integrations: integrations ? i : nil)
  }

  /// Skip: nothing to save, only "done".
  public static let empty = SetupPatch()
}

public struct SetupState: Decodable, Hashable, Sendable {
  public struct Resolved: Decodable, Hashable, Sendable {
    public let timezone: String
    public let workspaceRoot: String
    public let reposDir: String
    public let centralBrainDir: String
    public let hermesUrl: String
  }
  public struct Fallbacks: Decodable, Hashable, Sendable {
    public let timezone: String
    public let workspaceRoot: String
    public let reposDir: String
  }
  public let onboarded: Bool
  /// Where the file lives, with ~ for the home folder.
  public let path: String
  public let config: UserConfig
  public let resolved: Resolved
  public let fallbacks: Fallbacks
  public let omniRepo: String?
  /// POST /api/setup/complete only: the #conductor thread with the welcome message, on the first run.
  public let threadId: String?
}

/// The five onboarding screens, as Onboarding.tsx.
public enum OnboardingStep: Int, CaseIterable, Sendable {
  case you, workspace, harnesses, channel, done

  public var title: String {
    switch self {
    case .you: "You"
    case .workspace: "Workspace"
    case .harnesses: "Harnesses"
    case .channel: "Channel"
    case .done: "Done"
    }
  }

  public var next: OnboardingStep? { OnboardingStep(rawValue: rawValue + 1) }
  public var previous: OnboardingStep? { OnboardingStep(rawValue: rawValue - 1) }

  /// The pronoun choices offered before "Other".
  public static let pronouns = ["they/them", "she/her", "he/him"]

  /// The first word of the name, for "You're set, Ada".
  public static func firstName(_ name: String) -> String { name.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? "" }

  /// The GitHub owner to offer when none is saved: the owner of this checkout's origin.
  public static func suggestedOwner(_ state: SetupState) -> String {
    if !state.config.workspace.githubOwner.isEmpty { return state.config.workspace.githubOwner }
    return state.omniRepo?.split(separator: "/").first.map(String.init) ?? ""
  }

  /// The channel the first-channel screen creates: a client channel, with a worktree when it has a repo.
  public static func channelForm(name: String, repo: String, store: String) -> ChannelForm {
    var f = ChannelForm()
    f.setName(name.trimmed)
    if f.id.count < 2 { f.id = f.id.isEmpty ? "project" : "\(f.id)-1" }
    f.kind = .client
    f.repoPath = repo.trimmed
    f.useWorktree = !repo.trimmed.isEmpty
    f.storeDomain = store.trimmed
    return f
  }
}

extension String {
  fileprivate var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

extension OmniClient {
  public func setup() async throws(OmniAPIError) -> SetupState {
    try await send("GET", "/api/setup")
  }

  public func saveSetup(_ patch: SetupPatch) async throws(OmniAPIError) -> SetupState {
    try await send("PUT", "/api/setup", body: patch)
  }

  /// Marks onboarding done after saving `patch`. On the first run the result names the welcome thread.
  public func completeSetup(_ patch: SetupPatch) async throws(OmniAPIError) -> SetupState {
    try await send("POST", "/api/setup/complete", body: patch)
  }
}
