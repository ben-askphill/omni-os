import Foundation

// Bounded thread history (#223): a thread opens with its newest page of events and loads older pages on demand.
// The client half of packages/shared/history.ts, which is the source of truth. HistoryTests replays
// packages/test-fixtures/history/spans.json, the corpus the TypeScript tests check too.

/// Event ids `from ..< to` of one thread, every row of which is held. `from == 0` reaches the thread's start,
/// `to == nil` the live end. Ids only grow, so a closed span stays complete.
public struct HistorySpan: Decodable, Hashable, Sendable {
  public let from: Int
  public let to: Int?

  public init(from: Int, to: Int?) {
    self.from = from
    self.to = to
  }

  /// The index of the span holding `id`, nil for none.
  public static func index(of id: Int, in spans: [HistorySpan]) -> Int? {
    var lo = 0
    var hi = spans.count - 1
    while lo <= hi {
      let mid = (lo + hi) / 2
      let s = spans[mid]
      if id < s.from {
        hi = mid - 1
      } else if let to = s.to, id >= to {
        lo = mid + 1
      } else {
        return mid
      }
    }
    return nil
  }
}

/// Set on a row whose payload was too big for a page: its long strings were shortened, its ids and flags kept.
public struct Clipped: Decodable, Hashable, Sendable {
  /// The stored payload's size in bytes.
  public let bytes: Int
}

/// `history` on GET /api/threads/:id?history=recent, whose `events` are the newest page and its anchors.
public struct HistoryHead: Decodable, Hashable, Sendable {
  public let from: Int
  /// Result rows with id < from, for a turn count that never goes stale.
  public let resultsBelow: Int

  enum CodingKeys: String, CodingKey {
    case from
    case resultsBelow = "results_below"
  }

  init(from: Int, resultsBelow: Int) {
    self.from = from
    self.resultsBelow = resultsBelow
  }

  /// What a server without bounded history sends: every row.
  static let whole = HistoryHead(from: 0, resultsBelow: 0)
}

/// GET /api/threads/:id/history. `events`: the span's rows and its anchors (rows outside the span), ascending.
public struct HistoryPage: Decodable, Sendable {
  public let events: [EventRow]
  public let span: HistorySpan
}

/// Where to cut a page. `before` and `after` are exclusive ids, like the stream's `after`.
public enum HistoryCursor: Hashable, Sendable {
  /// The newest rows in (after, before). Neither bound: the head.
  case newest(before: Int? = nil, after: Int? = nil)
  /// The oldest rows in (after, before). Fills a gap from the span above it.
  case oldest(after: Int, before: Int? = nil)
  /// The page holding event `at`, from the start of its turn when that fits, within (after, before).
  case at(Int, after: Int? = nil, before: Int? = nil)

  /// The query, as historyQuery writes it.
  public var query: [(String, String)] {
    var q: [(String, String)] = []
    let (after, before): (Int?, Int?)
    switch self {
    case .newest(let b, let a): (after, before) = (a, b)
    case .oldest(let a, let b):
      q.append(("take", "oldest"))
      (after, before) = (a, b)
    case .at(let id, let a, let b):
      q.append(("at", String(id)))
      (after, before) = (a, b)
    }
    if let after { q.append(("after", String(after))) }
    if let before { q.append(("before", String(before))) }
    return q
  }
}

/// A loading control among the shown rows: older history above the first span, or the gap under span `after`.
public enum HistoryEdge: Hashable, Sendable {
  case earlier
  case gap(after: Int)
}

/// What the app holds of one thread. Every change is a join, so pages that land late, twice or out of order
/// change nothing more.
///
/// Rows are ascending by id, each once. Spans are ascending, disjoint and not touching; once opened, the last one
/// reaches the live end. A row outside every span is an anchor: it informs the transcript, never shows.
public struct History: Equatable, Sendable {
  public struct Below: Equatable, Sendable {
    public let from: Int
    public let results: Int
  }

  public private(set) var rows: [EventRow] = []
  public private(set) var spans: [HistorySpan] = []
  /// From the latest head: results under `from`. `turnCount` adds the held results at or above it.
  public private(set) var below = Below(from: 0, results: 0)

  public init() {}

  /// The state a thread opens with: the head page from GET /api/threads/:id?history=recent.
  public init(open events: [EventRow], head: HistoryHead) {
    apply(head: events, head)
  }

  /// Joins a page in: rows unioned by id (an unclipped copy beats a clipped one), spans as intervals.
  public mutating func apply(_ page: HistoryPage) {
    join(page.events, page.span)
  }

  /// A fresh head (open or reconnect): a page that reaches the live end, and `below` taken from it.
  public mutating func apply(head events: [EventRow], _ head: HistoryHead) {
    join(events, HistorySpan(from: head.from, to: nil))
    below = Below(from: head.from, results: head.resultsBelow)
  }

  /// Rows from the live stream. They land in the head span. Returns whether any was new.
  @discardableResult
  public mutating func append(live: [EventRow]) -> Bool {
    var added = false
    for r in live.sorted(by: { $0.id < $1.id }) {
      if r.id > tailID {
        rows.append(r)
        added = true
        continue
      }
      let i = insertionIndex(r.id)
      guard i == rows.count || rows[i].id != r.id else { continue }
      rows.insert(r, at: i)
      added = true
    }
    return added
  }

  /// A full row from GET /api/threads/:id/events/:eventId, in place of its clipped copy. Returns false for a row
  /// not held.
  @discardableResult
  public mutating func replace(_ row: EventRow) -> Bool {
    let i = insertionIndex(row.id)
    guard i < rows.count, rows[i].id == row.id else { return false }
    rows[i] = row
    return true
  }

  /// How much of a thread the app keeps while it holds the thread open (#411), as RETAIN in
  /// packages/shared/history.ts. Once the held rows pass `rows + slack` while Ben follows the newest, or `hard` while
  /// he reads older ones, `bound` drops the oldest down to `slack` fewer. "Load earlier" brings them back.
  public struct Retain: Decodable, Hashable, Sendable {
    public var rows: Int
    public var slack: Int
    public var hard: Int

    public init(rows: Int, slack: Int, hard: Int) {
      (self.rows, self.slack, self.hard) = (rows, slack, hard)
    }

    public static let standard = Retain(rows: 1500, slack: 500, hard: 6000)
  }

  /// Drops the oldest held rows once there are too many, as boundHistory does. The cut goes at the first turn start
  /// among the `slack` rows past the newest `limit - slack`, else right there. Rows under the cut go, but for the
  /// anchors a head page would bring: the parent calls of the calls kept, and the newest `init` and `result` when the
  /// rows kept have none. Spans start at the cut, and `below` counts the results dropped. Returns whether it dropped any.
  @discardableResult
  public mutating func bound(follows: Bool, retain: Retain = .standard) -> Bool {
    let limit = follows ? retain.rows + retain.slack : retain.hard
    guard rows.count > limit else { return false }
    let start = rows.count - (limit - retain.slack)
    func inSpan(_ i: Int) -> Int? { spanIndex(rows[i].id) }
    var cut: Int?
    for i in max(start, 1)..<min(rows.count, start + retain.slack) {
      if let s = inSpan(i), rows[i - 1].kind == "result", inSpan(i - 1) == s {
        cut = i
        break
      }
    }
    if cut == nil { cut = (start..<rows.count).first { inSpan($0) != nil } }
    guard let cut, cut > 0 else { return false }
    let floor = rows[cut].id
    let kept = rows[cut...]
    let under = rows[..<cut]
    func use(_ r: EventRow) -> ToolUse? { if case .toolUse(let u) = r.content { u } else { nil } }

    var anchors = Set<Int>()
    let keptCalls = Set(kept.compactMap { use($0)?.id })
    var wanted = kept.compactMap { use($0)?.parent }.filter { !keptCalls.contains($0) }
    if !wanted.isEmpty {
      var calls: [String: EventRow] = [:]
      for r in under {
        if let u = use(r), calls[u.id] == nil { calls[u.id] = r }
      }
      while let id = wanted.popLast() {
        guard let r = calls[id], !anchors.contains(r.id) else { continue }
        anchors.insert(r.id)
        if let parent = use(r)?.parent { wanted.append(parent) }
      }
    }
    for kind in ["init", "result"] where !kept.contains(where: { $0.kind == kind }) {
      if let r = under.last(where: { $0.kind == kind }) { anchors.insert(r.id) }
    }

    if floor > below.from {
      let dropped = under.count(where: { $0.kind == "result" && $0.id >= below.from })
      below = Below(from: floor, results: below.results + dropped)
    }
    rows = under.filter { anchors.contains($0.id) } + kept
    spans = spans.filter { s in s.to.map { $0 > floor } ?? true }.map { s in s.from < floor ? HistorySpan(from: floor, to: s.to) : s }
    return true
  }

  /// For #224: the stream says the gap since `tailID` is too big to replay. The head span closes after the newest
  /// held row and becomes an island; the fresh head then comes in through `apply(head:)`.
  public mutating func detachHead() {
    guard let last = spans.last, last.to == nil else { return }
    spans[spans.count - 1] = HistorySpan(from: last.from, to: tailID + 1)
  }

  /// The index of the span holding `id`, nil for none.
  public func spanIndex(_ id: Int) -> Int? { HistorySpan.index(of: id, in: spans) }

  /// The thread's first row is held: nothing earlier to load, and the first item is the thread's first message.
  public var atStart: Bool { spans.first?.from == 0 }

  /// The newest held id: the stream's `after`. 0 for none.
  public var tailID: Int { rows.last?.id ?? 0 }

  /// Turns that ended in the whole thread: every result row, held or not.
  public var turnCount: Int {
    below.results + rows.count { $0.kind == "result" && $0.id >= below.from }
  }

  /// The page above span `i`, down to the span below it. Nil when span `i` reaches the start.
  public func earlier(_ i: Int = 0) -> HistoryCursor? {
    guard spans.indices.contains(i), spans[i].from != 0 else { return nil }
    if i > 0, let to = spans[i - 1].to { return .newest(before: spans[i].from, after: to - 1) }
    return .newest(before: spans[i].from)
  }

  /// The page under span `i + 1`, filling the gap up from span `i`. Nil for the head span.
  public func later(_ i: Int) -> HistoryCursor? {
    guard spans.indices.contains(i), let to = spans[i].to, i + 1 < spans.count else { return nil }
    return .oldest(after: to - 1, before: spans[i + 1].from)
  }

  /// The page that holds `eventID`, bounded by the spans around it. Nil when it is held already.
  public func reveal(_ eventID: Int) -> HistoryCursor? {
    guard spanIndex(eventID) == nil else { return nil }
    var after: Int?
    var before: Int?
    for s in spans {
      if let to = s.to, to <= eventID {
        after = to - 1
      } else if s.from > eventID {
        before = s.from
        break
      }
    }
    return .at(eventID, after: after, before: before)
  }

  /// Where each control goes, by the key of the shown row it sits above. `keys`: the shown rows' event keys,
  /// ascending. A control with no shown row under it is keyed -1, at the end; the earlier control wins that key.
  public func edges(_ keys: [Int]) -> [Int: HistoryEdge] {
    var out: [Int: HistoryEdge] = [:]
    func firstFrom(_ from: Int) -> Int {
      var lo = 0
      var hi = keys.count
      while lo < hi {
        let mid = (lo + hi) / 2
        if keys[mid] < from { lo = mid + 1 } else { hi = mid }
      }
      return lo < keys.count ? keys[lo] : -1
    }
    for i in stride(from: spans.count - 2, through: 0, by: -1) { out[firstFrom(spans[i + 1].from)] = .gap(after: i) }
    if !spans.isEmpty && !atStart { out[keys.first ?? -1] = .earlier }
    return out
  }

  // MARK: Joins

  private mutating func join(_ events: [EventRow], _ span: HistorySpan) {
    rows = Self.union(rows, events)
    spans = Self.union(spans + [span])
  }

  /// The first index whose row id is `id` or more.
  private func insertionIndex(_ id: Int) -> Int {
    var lo = 0
    var hi = rows.count
    while lo < hi {
      let mid = (lo + hi) / 2
      if rows[mid].id < id { lo = mid + 1 } else { hi = mid }
    }
    return lo
  }

  /// Rows of both, by id, ascending. Of two copies of one row, an unclipped one wins, else `b`'s.
  static func union(_ a: [EventRow], _ b: [EventRow]) -> [EventRow] {
    guard !b.isEmpty else { return a }
    let b = b.enumerated().sorted { ($0.element.id, $0.offset) < ($1.element.id, $1.offset) }.map(\.element)
    var out: [EventRow] = []
    out.reserveCapacity(a.count + b.count)
    func take(_ r: EventRow) {
      if let last = out.last, last.id == r.id {
        if !(r.clipped != nil && last.clipped == nil) { out[out.count - 1] = r }
      } else {
        out.append(r)
      }
    }
    var i = 0
    var j = 0
    while i < a.count || j < b.count {
      if j == b.count || (i < a.count && a[i].id <= b[j].id) {
        take(a[i])
        i += 1
      } else {
        take(b[j])
        j += 1
      }
    }
    return out
  }

  /// Union of spans: ascending, touching and overlapping ones merged.
  static func union(_ spans: [HistorySpan]) -> [HistorySpan] {
    var out: [HistorySpan] = []
    for s in spans.sorted(by: { $0.from < $1.from }) {
      if let last = out.last, last.to.map({ $0 >= s.from }) ?? true {
        let to: Int? = if let a = last.to, let b = s.to { max(a, b) } else { nil }
        out[out.count - 1] = HistorySpan(from: last.from, to: to)
      } else {
        out.append(s)
      }
    }
    return out
  }
}
