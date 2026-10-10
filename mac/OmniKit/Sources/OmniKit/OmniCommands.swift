import Foundation

/// What a new-thread composer starts with when it opens from a thread, as `NewThreadPreset` in web/src/composer-slash.ts.
public struct NewThreadPreset: Hashable, Sendable {
  public var channel: String
  /// A crew role's id, or "" for none.
  public var role: String
  public var harness: HarnessID?
  public var model: String?
  public var effort: String?
  /// Open the model picker.
  public var pickModel: Bool
  /// The sidebar folder to file the new thread in: "New thread here" on a folder.
  public var folder: FolderRef?

  public init(
    channel: String, role: String, harness: HarnessID? = nil, model: String? = nil, effort: String? = nil, pickModel: Bool = false,
    folder: FolderRef? = nil
  ) {
    self.channel = channel
    self.role = role
    self.harness = harness
    self.model = model
    self.effort = effort
    self.pickModel = pickModel
    self.folder = folder
  }

  /// "New thread here" on a folder: its channel, filed in it, the role and run left to the composer's defaults.
  public static func inFolder(_ f: FolderWithThreads) -> NewThreadPreset {
    NewThreadPreset(channel: f.channelID, role: "", folder: FolderRef(id: f.id, name: f.name))
  }

  /// `/clear` or `/new` on its own: this thread's settings, for a first prompt Ben types next.
  public static func sameSettings(_ t: OmniThread) -> NewThreadPreset {
    NewThreadPreset(channel: t.channelID, role: t.role ?? "", harness: t.harness, model: t.model ?? "", effort: t.effort)
  }

  /// "New thread on another model": the channel and role, and nothing that picks a model.
  public static func otherModel(_ t: OmniThread) -> NewThreadPreset {
    NewThreadPreset(channel: t.channelID, role: t.role ?? "", pickModel: true)
  }
}

/// A folder a new thread is filed in, with its name for the composer's chip.
public struct FolderRef: Hashable, Sendable {
  public let id: String
  public let name: String

  public init(id: String, name: String) {
    self.id = id
    self.name = name
  }
}

extension NewThread {
  /// A thread that starts in the same channel with the same harness, model, effort and role as `t`.
  public init(continuing t: OmniThread, prompt: String) {
    func some(_ s: String?) -> String? { s?.isEmpty == false ? s : nil }
    self.init(channel: t.channelID, prompt: prompt, role: some(t.role), model: some(t.model), harness: t.harness, effort: some(t.effort))
  }
}

public enum OmniCommandResult: Hashable, Sendable {
  /// Open the new-thread composer with these settings.
  case openNewThread(NewThreadPreset)
  case threadCreated(OmniThread)
  case renamed(OmniThread)
}

public enum OmniCommands {
  /// Run the Omni command a reply starts with, as `runOmni` in web/src/components/Composer.tsx. The
  /// thread itself sees none of it. Nil for a reply that goes to the harness, and for `/model`,
  /// `/effort` and `/fast`, which the composer answers with `NewThreadPreset.otherModel`.
  public static func run(_ action: ReplyAction, in thread: OmniThread, client: OmniClient) async throws(OmniAPIError) -> OmniCommandResult? {
    switch action {
    case .send, .fixed:
      return nil
    case .newThread(let prompt) where prompt.isEmpty:
      return .openNewThread(.sameSettings(thread))
    case .newThread(let prompt):
      return .threadCreated(try await client.createThread(NewThread(continuing: thread, prompt: prompt)))
    case .rename(let title):
      return .renamed(try await client.renameThread(thread.id, title: title))
    }
  }
}
