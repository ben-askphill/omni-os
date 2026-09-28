import Foundation
import Observation

/// Whose commands a `/` menu lists.
public enum CommandsSource: Hashable, Sendable {
  /// A thread's, from its running process when it has one.
  case thread(String)
  /// What a new thread on this harness in this channel would get.
  case newThread(harness: String, channel: String)
}

/// GET /api/commands. `OmniClient` is one; tests pass a fake.
public protocol CommandsAPI: Sendable {
  func commands(_ source: CommandsSource, wait: Bool) async throws(OmniAPIError) -> CommandList
}

extension OmniClient: CommandsAPI {
  /// The cached list at once; with `wait`, after a refresh that is running.
  public func commands(_ source: CommandsSource, wait: Bool) async throws(OmniAPIError) -> CommandList {
    var query: [(String, String)]
    switch source {
    case .thread(let id): query = [("thread", id)]
    case .newThread(let harness, let channel): query = [("harness", harness), ("channel", channel)]
    }
    if wait { query.append(("wait", "1")) }
    let data = try await file(url("/api/commands", query: query))
    do {
      return try OmniJSON.decoder().decode(CommandList.self, from: data)
    } catch {
      throw .decoding(Self.describe(error))
    }
  }
}

/// The command list behind one `/` menu, kept like `useCommands` in web/src/components/SlashMenu.tsx.
@MainActor @Observable
public final class SlashCommandsStore {
  public private(set) var list: CommandList?
  /// Counts every change of `list`, for caches.
  public private(set) var revision = 0
  /// Another source drops the list and ignores answers still coming for the old one.
  public var source: CommandsSource {
    didSet {
      guard source != oldValue else { return }
      list = nil
      revision += 1
    }
  }
  @ObservationIgnored private let api: any CommandsAPI
  @ObservationIgnored private var loading: CommandsSource?

  public init(api: any CommandsAPI, source: CommandsSource) {
    self.api = api
    self.source = source
  }

  /// Fetch the cached list, then the fresh one. The server probes at most every 30 seconds, so calling
  /// this often is cheap. A load already running for this source answers for this one too.
  public func load() async {
    let asked = source
    guard loading != asked else { return }
    loading = asked
    defer { if loading == asked { loading = nil } }
    do {
      take(try await api.commands(asked, wait: false), from: asked)
      take(try await api.commands(asked, wait: true), from: asked)
    } catch {
      if source == asked, list == nil { set(CommandList(status: .unavailable, commands: [], fetchedAt: nil)) }
    }
  }

  private func take(_ next: CommandList, from asked: CommandsSource) {
    guard source == asked else { return }
    // Never swap a list for an older one when two loads overlap.
    if let had = list?.fetchedAt, (next.fetchedAt ?? 0) < had { return }
    set(next)
  }

  public func set(_ next: CommandList) {
    list = next
    revision += 1
  }
}
