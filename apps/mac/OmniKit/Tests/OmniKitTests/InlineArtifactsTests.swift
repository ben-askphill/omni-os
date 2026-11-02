import Foundation
import Testing
@testable import OmniKit

// packages/test-fixtures/inline-artifacts.json is shared with packages/shared/tests/inline-artifacts.test.ts, so the two
// placements cannot drift.
private let repoRoot = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

private let iso: ISO8601DateFormatter = {
  let f = ISO8601DateFormatter()
  f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return f
}()

private struct Case: Decodable {
  struct Result: Decodable { let is_error: Bool }
  struct Call: Decodable {
    let name: String
    let input: JSONValue
    let result: Result?
    let at: String
  }
  struct Group: Decodable {
    let key: Int
    let calls: [Call]
  }
  struct File: Decodable, InlineArtifacts.Candidate {
    let id: Int
    let thread_id: String
    let path: String
    let kind: String
    let updated_at: String
    var threadID: String { thread_id }
    var updatedAt: Date { iso.date(from: updated_at)! }
  }
  let `case`: String
  let groups: [Group]
  let artifacts: [File]
  let expected: [String: [Int]]
}

@Suite struct InlineArtifactsTests {
  @Test func matchesTheSharedPlacement() throws {
    let url = repoRoot.appending(path: "packages/test-fixtures/inline-artifacts.json")
    let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: url))
    #expect(cases.count >= 9)
    for c in cases {
      let groups = c.groups.map { g in
        InlineArtifacts.Group(
          key: g.key, calls: g.calls.map { InlineArtifacts.Call(name: $0.name, input: $0.input, isError: $0.result?.is_error, at: iso.date(from: $0.at)!) })
      }
      let got = InlineArtifacts.byGroup(groups, c.artifacts)
      #expect(Dictionary(uniqueKeysWithValues: got.map { (String($0.key), $0.value.map(\.id)) }) == c.expected, "\(c.case)")
    }
  }
}
