import Foundation
import Testing
@testable import OmniKit

// packages/test-fixtures/html-render.json is shared with packages/shared/tests/html-render.test.ts, so the two parsers
// cannot drift.
private let repoRoot = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

private struct Case: Decodable {
  struct Result: Decodable {
    let text: String
    let is_error: Bool
  }
  struct Expected: Decodable, Equatable {
    let artifact: Int
    let title: String
  }
  let `case`: String
  let name: String
  let input: JSONValue
  let result: Result
  let expected: Expected?
}

@Suite struct HtmlRenderTests {
  @Test func matchesTheSharedParser() throws {
    let url = repoRoot.appending(path: "packages/test-fixtures/html-render.json")
    let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: url))
    #expect(cases.count >= 7)
    for c in cases {
      let got = RenderedPage.from(name: c.name, input: c.input, text: c.result.text, isError: c.result.is_error).map {
        Case.Expected(artifact: $0.artifact, title: $0.title)
      }
      #expect(got == c.expected, "\(c.case)")
    }
  }

  @Test func needsAResult() {
    #expect(RenderedPage.from(name: "mcp__omni-render__html_render", input: .object(["title": .string("T")]), result: nil) == nil)
  }
}
