import Foundation
import Testing
@testable import OmniKit

// tests/fixtures/published.json is shared with tests/published.test.ts, so the two parsers cannot drift.
private let repoRoot = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent().deletingLastPathComponent()

private struct Case: Decodable {
  struct Result: Decodable {
    let text: String
    let is_error: Bool
  }
  struct Expected: Decodable, Equatable {
    let url: String
    let file_path: String?
    let title: String
    let description: String?
    let update: Bool
  }
  let `case`: String
  let name: String
  let input: JSONValue
  let result: Result
  let expected: Expected?
}

@Suite struct PublishedTests {
  @Test func matchesTheSharedParser() throws {
    let url = repoRoot.appending(path: "tests/fixtures/published.json")
    let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: url))
    #expect(cases.count >= 8)
    for c in cases {
      let got = PublishedPage.from(name: c.name, input: c.input, text: c.result.text, isError: c.result.is_error).map {
        Case.Expected(url: $0.url, file_path: $0.filePath, title: $0.title, description: $0.description, update: $0.update)
      }
      #expect(got == c.expected, "\(c.case)")
    }
  }

  @Test func needsAResult() {
    #expect(PublishedPage.from(name: "Artifact", input: .object(["file_path": .string("/a/b.html")]), result: nil) == nil)
  }

  @Test func takesOnlyArtifactLinks() {
    #expect(PublishedPage.isArtifactURL("https://claude.ai/code/artifact/f7567ad1-8b55-4689-b824-1a865c7fe003"))
    #expect(PublishedPage.isArtifactURL("https://claude.ai/artifact/abc123"))
    #expect(!PublishedPage.isArtifactURL("https://claude.ai/chat/abc123"))
    #expect(!PublishedPage.isArtifactURL("https://evil.example/?u=https://claude.ai/artifact/abc"))
  }

  @Test func showsEachPageOnceUnderItsLastPublish() throws {
    let a = "https://claude.ai/code/artifact/aaaa"
    let b = "https://claude.ai/code/artifact/bbbb"
    let items = Transcript(
      try events([
        ("tool_use", #"{"id":"p1","name":"Artifact","input":{"file_path":"/x/a.html"},"parent":null}"#),
        ("tool_result", #"{"tool_use_id":"p1","text":"PublishedPage /x/a.html at \#(a)","is_error":false,"truncated":false}"#),
        ("assistant_text", #"{"text":"PublishedPage. Now the second one."}"#),
        ("tool_use", #"{"id":"p2","name":"Artifact","input":{"file_path":"/x/b.html"},"parent":null}"#),
        ("tool_result", #"{"tool_use_id":"p2","text":"PublishedPage /x/b.html at \#(b)","is_error":false,"truncated":false}"#),
        ("tool_use", #"{"id":"p3","name":"Artifact","input":{"file_path":"/x/a.html","url":"\#(a)"},"parent":null}"#),
        ("tool_result", #"{"tool_use_id":"p3","text":"PublishedPage /x/a.html at \#(a)","is_error":false,"truncated":false}"#),
      ])
    ).items
    let groups = items.compactMap { if case .tools(let g) = $0 { g.eventID } else { nil } }
    #expect(groups.count == 2)
    let pages = PublishedPage.byGroup(items)
    #expect(pages[groups[0]] == nil)
    #expect(pages[groups[1]]?.map(\.url) == [b, a])
    #expect(pages[groups[1]]?.last?.update == true)
  }
}
