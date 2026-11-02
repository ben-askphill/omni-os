import Foundation

// The PRs page's search, sort, filters and groups, as packages/shared/pr-query.ts. packages/test-fixtures/pr-query.json
// holds the cases both run, so the two cannot drift.

public typealias ListedPR = AllPullRequests.Listed

public enum PRSort: String, CaseIterable, Sendable {
  case open, updated, newest, oldest, repo, title

  public var label: String {
    switch self {
    case .open: "Open first"
    case .updated: "Recently updated"
    case .newest: "Newest"
    case .oldest: "Oldest"
    case .repo: "Repo"
    case .title: "Title"
    }
  }

  /// Below zero when `a` goes first, as a JavaScript comparator.
  func compare(_ a: ListedPR, _ b: ListedPR) -> Double {
    let updated = b.updatedAt.timeIntervalSince(a.updatedAt)
    switch self {
    case .open: return Double((b.isOpen ? 1 : 0) - (a.isOpen ? 1 : 0)).orIfZero(updated)
    case .updated: return updated
    case .newest: return Self.created(b).timeIntervalSince(Self.created(a))
    case .oldest: return Self.created(a).timeIntervalSince(Self.created(b))
    case .repo: return Self.text(a.repo, b.repo).orIfZero(updated)
    case .title: return Self.text(a.title, b.title)
    }
  }

  private static func created(_ p: ListedPR) -> Date { p.createdAt ?? p.updatedAt }

  static func text(_ a: String, _ b: String) -> Double {
    let (x, y) = (a.lowercased(), b.lowercased())
    return x < y ? -1 : x > y ? 1 : 0
  }
}

extension Double {
  fileprivate func orIfZero(_ next: @autoclosure () -> Double) -> Double { self == 0 ? next() : self }
}

/// A PR passes a facet when it has any picked value, and the filters when it passes every facet.
public enum PRFacet: String, CaseIterable, Sendable {
  case state, review, checks, author, label

  public var title: String {
    switch self {
    case .state: "State"
    case .review: "Review"
    case .checks: "Checks"
    case .author: "Author"
    case .label: "Label"
    }
  }

  /// The values to offer in this order, with their labels. A facet without them offers the values its PRs have.
  public var fixed: [(value: String, label: String)]? {
    switch self {
    case .state: [("open", "Open"), ("draft", "Draft"), ("merged", "Merged"), ("closed", "Closed")]
    case .review: [("approved", "Approved"), ("changes", "Changes requested"), ("required", "Review required"), ("none", "No review decision")]
    case .checks: [("passing", "Passing"), ("failing", "Failing"), ("pending", "Running"), ("none", "No checks")]
    case .author, .label: nil
    }
  }

  func values(_ p: ListedPR) -> [String] {
    switch self {
    case .state: return [p.badge]
    case .review:
      let review = ["APPROVED": "approved", "CHANGES_REQUESTED": "changes", "REVIEW_REQUIRED": "required"]
      return [review[p.reviewDecision ?? ""] ?? "none"]
    case .checks:
      let c = p.checks
      return [c.failed > 0 ? "failing" : c.pending > 0 ? "pending" : c.passed > 0 ? "passing" : "none"]
    case .author: return [p.author?.login ?? "unknown"]
    case .label: return p.labels
    }
  }

  public func label(of value: String) -> String {
    fixed?.first { $0.value == value }?.label ?? value
  }

  /// What this facet offers for these PRs: a fixed facet's values that any PR has, else every value the PRs have, most
  /// used first. A picked value stays listed at 0 so it can be unpicked.
  public func options(for prs: [ListedPR], picked: [String] = []) -> [PRFacetOption] {
    var counts: [String: Int] = [:]
    for p in prs {
      for v in Set(values(p)) { counts[v, default: 0] += 1 }
    }
    let listed = { (v: String) in (counts[v] ?? 0) > 0 || picked.contains(v) }
    if let fixed {
      return fixed.filter { listed($0.value) }.map { PRFacetOption(value: $0.value, label: $0.label, count: counts[$0.value] ?? 0) }
    }
    return Set(counts.keys).union(picked)
      .map { PRFacetOption(value: $0, label: $0, count: counts[$0] ?? 0) }
      .sorted { $0.count != $1.count ? $0.count > $1.count : PRSort.text($0.value, $1.value) < 0 }
  }
}

public struct PRPickedFilter: Hashable, Sendable, Identifiable {
  public let facet: PRFacet
  public let value: String
  public var id: String { "\(facet.rawValue):\(value)" }
  public var label: String { facet.label(of: value) }
}

public struct PRFacetOption: Hashable, Sendable, Decodable {
  public let value: String
  public let label: String
  /// How many of the PRs given have it.
  public let count: Int
}

public struct PRSearch: Equatable, Sendable, Decodable {
  /// Lower-cased words and quoted phrases, each of which must appear in the PR's title, number, author, branch or repo.
  public var words: [String] = []
  /// Lower-cased `label:` names, each of which the PR must have.
  public var labels: [String] = []

  /// `fix label:bug label:"good first issue"` into words and labels. A `label:` with no name yet is skipped.
  public static func parse(_ input: String) -> PRSearch {
    var out = PRSearch()
    let token = #/(label):(?:"([^"]*)"?|(\S*))|"([^"]*)"?|(\S+)/#.ignoresCase()
    for m in input.matches(of: token) {
      let isLabel = m.output.1 != nil
      let raw = isLabel ? (m.output.2 ?? m.output.3) : (m.output.4 ?? m.output.5)
      let value = String(raw ?? "").trimmingCharacters(in: .whitespaces).lowercased()
      if value.isEmpty { continue }
      if isLabel { out.labels.append(value) } else { out.words.append(value) }
    }
    return out
  }

  func matches(_ p: ListedPR) -> Bool {
    let hay = "\(p.title) #\(p.number) \(p.author?.login ?? "") \(p.headRefName) \(p.repo)".lowercased()
    let have = p.labels.map { $0.lowercased() }
    return words.allSatisfy { hay.contains($0) } && labels.allSatisfy { have.contains($0) }
  }
}

/// Yours, then the ones you are asked to review, then the rest.
public enum PRGroupKey: String, CaseIterable, Sendable {
  case authored, review, other

  public var label: String {
    switch self {
    case .authored: "Authored"
    case .review: "Review requested"
    case .other: "Others"
    }
  }

  public var icon: String {
    switch self {
    case .authored: "pencil"
    case .review: "inbox"
    case .other: "pr"
    }
  }

  /// Every PR is in `.other` when the login is unknown.
  public static func of(_ p: ListedPR, viewer: String?) -> PRGroupKey {
    guard let me = viewer?.lowercased(), !me.isEmpty else { return .other }
    if p.author?.login.lowercased() == me { return .authored }
    return p.reviewRequests.contains { $0.lowercased() == me } ? .review : .other
  }
}

public struct PRGroup: Identifiable, Sendable {
  public let key: PRGroupKey
  public let prs: [ListedPR]
  public var id: PRGroupKey { key }
}

public struct PRQuery: Equatable, Sendable {
  public var search = ""
  public var sort = PRSort.open
  public var filters: [PRFacet: [String]] = [:]
  /// The one repo to list, or nil for all of them.
  public var repo: String?

  public init(search: String = "", sort: PRSort = .open, filters: [PRFacet: [String]] = [:], repo: String? = nil) {
    self.search = search
    self.sort = sort
    self.filters = filters
    self.repo = repo
  }

  public var filterCount: Int { filters.values.reduce(0) { $0 + $1.count } }

  /// Whether search or filters hide anything, so an empty result reads "no match" rather than "no PRs".
  public var isNarrowed: Bool { !search.trimmingCharacters(in: .whitespaces).isEmpty || filterCount > 0 }

  /// Each picked value with its facet, in facet order, for the chips under the toolbar.
  public var picked: [PRPickedFilter] {
    PRFacet.allCases.flatMap { f in (filters[f] ?? []).map { PRPickedFilter(facet: f, value: $0) } }
  }

  /// Picks a value, or unpicks it. A facet left with none is dropped.
  public mutating func toggle(_ facet: PRFacet, _ value: String) {
    var now = filters[facet] ?? []
    if let i = now.firstIndex(of: value) { now.remove(at: i) } else { now.append(value) }
    filters[facet] = now.isEmpty ? nil : now
  }

  /// Only the PRs in the picked repo, or all of them. Filters count their options over these.
  public func inScope(_ prs: [ListedPR]) -> [ListedPR] {
    guard let repo else { return prs }
    return prs.filter { $0.repo == repo }
  }

  /// The PRs this query asks for, sorted, in their groups. A group with none is left out.
  public func groups(_ prs: [ListedPR], viewer: String?) -> [PRGroup] {
    let search = PRSearch.parse(self.search)
    let picked = PRFacet.allCases.filter { !(filters[$0] ?? []).isEmpty }
    let shown = inScope(prs)
      .filter { p in
        search.matches(p) && picked.allSatisfy { f in f.values(p).contains { (filters[f] ?? []).contains($0) } }
      }
      .enumerated()
      .sorted { a, b in
        let c = sort.compare(a.element, b.element)
        return c == 0 ? a.offset < b.offset : c < 0
      }
      .map(\.element)
    return PRGroupKey.allCases.compactMap { key in
      let inGroup = shown.filter { PRGroupKey.of($0, viewer: viewer) == key }
      return inGroup.isEmpty ? nil : PRGroup(key: key, prs: inGroup)
    }
  }
}
