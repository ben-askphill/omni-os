import Foundation

public enum PaletteAction: Hashable, Sendable {
  case newThread
  case go(Route)
  case search(String)
}

public struct PaletteItem: Hashable, Sendable, Identifiable {
  public enum Group: Int, Hashable, Sendable, CaseIterable {
    case search, actions, goTo, channels, recent

    public var title: String {
      switch self {
      case .search: "Search"
      case .actions: "Actions"
      case .goTo: "Go to"
      case .channels: "Channels"
      case .recent: "Recent threads"
      }
    }
  }

  public let id: String
  public let group: Group
  public let label: String
  public let sub: String?
  public let symbol: String
  public let status: ThreadStatus?
  /// "2 running" for a channel, "5m ago" for a thread.
  public let trailing: String?
  public let action: PaletteAction
}

/// The Go to palette (⌘K), from web/src/components/CommandPalette.tsx: pages, channels and recent threads,
/// every word of the query having to match. Better matches come first within a group.
public enum Palette {
  static let emptyRecent = 6

  public static func items(
    query: String, channels: [ChannelWithRunning], recent: [OmniThread], now: Date = .now
  ) -> [PaletteItem] {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    let words = trimmed.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)

    func page(_ id: String, _ group: PaletteItem.Group, _ label: String, _ sub: String?, _ symbol: String, _ action: PaletteAction) -> PaletteItem {
      PaletteItem(id: id, group: group, label: label, sub: sub, symbol: symbol, status: nil, trailing: nil, action: action)
    }
    var base: [PaletteItem] = [
      page("a:new", .actions, "New thread", "Start a task", "plus", .newThread),
      page("p:home", .goTo, "Home", nil, "house", .go(.home)),
      page("p:artifacts", .goTo, "Artifacts", nil, "square.stack.3d.up", .go(.artifacts)),
      page("p:automations", .goTo, "Automations", nil, "bolt", .go(.automations)),
      page("p:secrets", .goTo, "Secrets", nil, "key", .go(.secrets)),
      page("p:new-channel", .goTo, "Add channel", nil, "plus", .go(.newChannel)),
    ]
    for c in channels {
      let conductor = c.id == SidebarSections.conductorID
      base.append(
        PaletteItem(
          id: "c:\(c.id)", group: .channels, label: conductor ? "Conductor" : "#\(c.name)", sub: c.storeDomain ?? c.githubRepo,
          symbol: conductor ? "scope" : "number", status: nil, trailing: c.running > 0 ? "\(c.running) running" : nil,
          action: .go(.channel(id: c.id))
        ))
    }
    for t in recent {
      base.append(
        PaletteItem(
          id: "t:\(t.id)", group: .recent, label: t.title.isEmpty ? "Untitled" : t.title, sub: "#\(t.channelID)", symbol: "text.bubble",
          status: t.status, trailing: Format.relTime(t.updatedAt, now: now), action: .go(.thread(id: t.id))
        ))
    }

    var out: [PaletteItem]
    if words.isEmpty {
      let recentIDs = Set(base.filter { $0.group == .recent }.prefix(emptyRecent).map(\.id))
      out = base.filter { $0.group != .recent || recentIDs.contains($0.id) }
    } else {
      let scored = base.enumerated().compactMap { i, item in
        score(words: words, label: item.label, sub: item.sub).map { (item: item, score: $0, order: i) }
      }
      out = scored.sorted { a, b in
        a.item.group != b.item.group ? a.item.group.rawValue < b.item.group.rawValue : a.score != b.score ? a.score > b.score : a.order < b.order
      }.map(\.item)
      out.insert(
        page("search", .search, "Search threads for “\(trimmed)”", "Titles, prompts, replies and tool output", "magnifyingglass", .search(trimmed)), at: 0)
    }
    return out
  }

  /// nil when a word matches nowhere. A label that starts with the word beats one with a word that does,
  /// which beats one that contains it, then the sub text, then letters in order ("thrd" finds "Thread").
  static func score(words: [String], label: String, sub: String?) -> Int? {
    var label = label.lowercased()
    if label.hasPrefix("#") { label.removeFirst() }
    let sub = sub?.lowercased()
    var total = 0
    for w in words {
      if label.hasPrefix(w) {
        total += 100
      } else if startsWord(label, w) {
        total += 80
      } else if label.contains(w) {
        total += 60
      } else if let sub, sub.contains(w) || (sub.hasPrefix("#") && sub.dropFirst().hasPrefix(w)) {
        total += 30
      } else if w.count >= 2, isSubsequence(w, of: label) {
        total += 20
      } else {
        return nil
      }
    }
    return total
  }

  private static func startsWord(_ text: String, _ w: String) -> Bool {
    var atStart = true
    var i = text.startIndex
    while i < text.endIndex {
      if atStart, text[i...].hasPrefix(w) { return true }
      atStart = !text[i].isLetter && !text[i].isNumber
      i = text.index(after: i)
    }
    return false
  }

  private static func isSubsequence(_ w: String, of text: String) -> Bool {
    var it = w.makeIterator()
    guard var next = it.next() else { return true }
    for ch in text where ch == next {
      guard let n = it.next() else { return true }
      next = n
    }
    return false
  }
}
