import Foundation
import Observation

/// The `@name` being typed at the caret, as `FileQuery` in shared/mention-menu.ts. Offsets are UTF-16 units.
public struct FileQuery: Codable, Hashable, Sendable {
  public var query: String
  public var start: Int
  /// Where the name ends, exclusive.
  public var end: Int

  public init(query: String, start: Int, end: Int) {
    self.query = query
    self.start = start
    self.end = end
  }
}

/// One row of the `@` menu, as `FileMention` in shared/mention-menu.ts.
public struct FileMention: Codable, Hashable, Sendable, Identifiable {
  public enum Kind: String, Codable, Sendable {
    case artifact, file
  }
  /// What goes after the `@`.
  public var insert: String
  public var name: String
  /// Where it lives: the thread, or the folder inside the repo.
  public var detail: String
  public var kind: Kind
  public var id: String { insert }

  public init(insert: String, name: String, detail: String, kind: Kind) {
    self.insert = insert
    self.name = name
    self.detail = detail
    self.kind = kind
  }
}

/// Whose files an `@` menu lists.
public enum MentionsSource: Hashable, Sendable {
  /// A thread's artifacts, then the files of the folder it runs in.
  case thread(String)
  /// A new thread's composer: the files of the folder a thread in this channel starts from.
  case channel(String)
}

/// GET /api/mentions. `OmniClient` is one; tests pass a fake.
public protocol MentionsAPI: Sendable {
  func mentions(_ source: MentionsSource, query: String) async throws(OmniAPIError) -> [FileMention]
}

extension OmniClient: MentionsAPI {
  public func mentions(_ source: MentionsSource, query: String) async throws(OmniAPIError) -> [FileMention] {
    var parts: [(String, String)]
    switch source {
    case .thread(let id): parts = [("thread", id)]
    case .channel(let id): parts = [("channel", id)]
    }
    parts.append(("q", query))
    let data = try await file(url("/api/mentions", query: parts))
    do {
      return try OmniJSON.decoder().decode([FileMention].self, from: data)
    } catch {
      throw .decoding(Self.describe(error))
    }
  }
}

/// The rows behind one `@` menu, kept like `useFileMenu` in web/src/components/FileMenu.tsx: a search per
/// query, a beat after the last keystroke, and an answer for an older query never shows.
@MainActor @Observable
public final class FileMentionsStore {
  public private(set) var rows: [FileMention] = []
  /// Another source drops the rows and ignores answers still coming for the old one.
  public var source: MentionsSource {
    didSet {
      guard source != oldValue else { return }
      rows = []
      invalidate()
    }
  }
  @ObservationIgnored private let api: any MentionsAPI
  @ObservationIgnored private var wanted: String?
  @ObservationIgnored private var task: Task<Void, Never>?
  @ObservationIgnored private var answered = false
  @ObservationIgnored private let debounce: Duration

  public init(api: any MentionsAPI, source: MentionsSource, debounce: Duration = .milliseconds(90)) {
    self.api = api
    self.source = source
    self.debounce = debounce
  }

  /// Forget the last search, so the next `search` asks again: files may have come or gone.
  public func invalidate() {
    wanted = nil
  }

  /// The rows for `query`. The last rows stay until the answer comes, so typing doesn't flicker the menu.
  public func search(_ query: String) {
    guard query != wanted else { return }
    wanted = query
    task?.cancel()
    let asked = source
    let wait = answered ? debounce : .zero
    task = Task { [weak self, api] in
      if wait > .zero { try? await Task.sleep(for: wait) }
      guard !Task.isCancelled else { return }
      let found = (try? await api.mentions(asked, query: query)) ?? []
      guard let self, !Task.isCancelled, self.source == asked, self.wanted == query else { return }
      self.rows = found
      self.answered = true
    }
  }

  /// Resolves when the search running now has answered. For tests.
  public func settled() async {
    await task?.value
  }
}
