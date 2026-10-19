import Foundation
import Synchronization

/// Parsed markdown per event, so a transcript parses each message once and again only when its text changes (a
/// streaming reply). Past `limit` entries the least recently used are dropped. Safe to share across tasks; a
/// parse runs outside the lock.
public final class MarkdownCache<Key: Hashable & Sendable>: Sendable {
  private struct Entry {
    var text: String
    var document: MarkdownDocument
    var used: UInt64
  }

  private struct State {
    var entries: [Key: Entry] = [:]
    var clock: UInt64 = 0
  }

  private let limit: Int
  private let parse: @Sendable (String) -> MarkdownDocument
  private let state = Mutex(State())

  public init(limit: Int = 2000, parse: @escaping @Sendable (String) -> MarkdownDocument = { MarkdownDocument(parsing: $0) }) {
    self.limit = max(1, limit)
    self.parse = parse
  }

  public func document(for key: Key, text: String) -> MarkdownDocument {
    if let document = cached(for: key, text: text) { return document }
    let document = parse(text)
    state.withLock { state in
      state.clock += 1
      state.entries[key] = Entry(text: text, document: document, used: state.clock)
      guard state.entries.count > limit else { return }
      let keep = max(1, limit * 3 / 4)
      let oldest = state.entries.sorted { $0.value.used < $1.value.used }.prefix(state.entries.count - keep)
      for (key, _) in oldest { state.entries[key] = nil }
    }
    return document
  }

  /// The document parsed for this key and text, without parsing.
  public func cached(for key: Key, text: String) -> MarkdownDocument? {
    state.withLock { state in
      guard var entry = state.entries[key], entry.text == text else { return nil }
      state.clock += 1
      entry.used = state.clock
      state.entries[key] = entry
      return entry.document
    }
  }

  public var count: Int { state.withLock { $0.entries.count } }

  public func removeAll() {
    state.withLock { $0.entries.removeAll() }
  }
}
