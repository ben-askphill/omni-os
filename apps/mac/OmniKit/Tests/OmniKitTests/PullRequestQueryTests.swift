import Foundation
import Testing
import OmniKit

// packages/test-fixtures/pr-query.json is shared with packages/shared/tests/pr-query.test.ts, so the two ports cannot drift.
private let repoRoot = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

private struct Corpus: Decodable {
  struct Query: Decodable {
    let search: String
    let sort: String
    let filters: [String: [String]]
    let repo: String?
  }
  struct QueryCase: Decodable {
    struct Group: Decodable, Equatable {
      let group: String
      let numbers: [Int]
    }
    let `case`: String
    let viewer: String?
    let query: Query
    let expected: [Group]
  }
  struct FacetCase: Decodable {
    let `case`: String
    let facet: String
    let repo: String?
    let picked: [String]
    let expected: [PRFacetOption]
  }
  struct SearchCase: Decodable {
    let input: String
    let expected: PRSearch
  }
  let prs: [ListedPR]
  let queries: [QueryCase]
  let facets: [FacetCase]
  let searches: [SearchCase]
}

private func corpus() throws -> Corpus {
  try OmniJSON.decoder().decode(Corpus.self, from: Data(contentsOf: repoRoot.appending(path: "packages/test-fixtures/pr-query.json")))
}

private func query(_ q: Corpus.Query) throws -> PRQuery {
  var filters: [PRFacet: [String]] = [:]
  for (k, v) in q.filters { filters[try #require(PRFacet(rawValue: k))] = v }
  return PRQuery(search: q.search, sort: try #require(PRSort(rawValue: q.sort)), filters: filters, repo: q.repo)
}

@Suite struct PullRequestQueryTests {
  @Test func matchesTheSharedQueries() throws {
    let c = try corpus()
    #expect(c.queries.count >= 10)
    for qc in c.queries {
      let groups = try query(qc.query).groups(c.prs, viewer: qc.viewer)
        .map { Corpus.QueryCase.Group(group: $0.key.rawValue, numbers: $0.prs.map(\.number)) }
      #expect(groups == qc.expected, "\(qc.case)")
    }
  }

  @Test func matchesTheSharedFacets() throws {
    let c = try corpus()
    for fc in c.facets {
      let facet = try #require(PRFacet(rawValue: fc.facet))
      let scoped = PRQuery(repo: fc.repo).inScope(c.prs)
      #expect(facet.options(for: scoped, picked: fc.picked) == fc.expected, "\(fc.case)")
    }
  }

  @Test func matchesTheSharedSearches() throws {
    for sc in try corpus().searches {
      #expect(PRSearch.parse(sc.input) == sc.expected, "\(sc.input)")
    }
  }

  @Test func togglesFiltersAndDropsAnEmptiedFacet() {
    var q = PRQuery()
    q.toggle(.state, "open")
    q.toggle(.label, "bug")
    #expect(q.filterCount == 2)
    #expect(q.isNarrowed)
    q.toggle(.state, "open")
    #expect(q.filters == [.label: ["bug"]])
    #expect(q.picked.map(\.value) == ["bug"])
    #expect(!PRQuery(sort: .title, repo: "acme/shop").isNarrowed)
  }
}
