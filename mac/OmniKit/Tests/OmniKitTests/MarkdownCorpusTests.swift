import Foundation
import Testing
import OmniKit

/// This checkout. The corpus lives next to the node tests so the two clients cannot drift.
/// FixtureTests owns every file under Fixtures/, so this is not copied there.
private let repoRoot = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent().deletingLastPathComponent()

/// One block of `MarkdownDocument`, stable enough to check in. A link is a route hash (`#/t/...`) or an
/// external `URL.absoluteString`. `style` is `em`, `strong`, `strike`, `code`, in that order, and left out
/// when empty. An image's alt is `text`; `image` is its source, or `""` when it does not load.
private struct CorpusFile: Decodable {
  var acceptedDifferences: [CorpusDifference]
  var snippets: [CorpusSnippet]
}

private struct CorpusDifference: Decodable {
  var name: String
  var summary: String
}

private struct CorpusSnippet: Decodable {
  var id: String
  var source: String
  var difference: String?
  var web: String
  var mac: [CorpusBlock]
}

private struct CorpusBlock: Codable, Equatable, Sendable {
  var type: String
  var runs: [CorpusRun]? = nil
  var level: Int? = nil
  var language: String? = nil
  var code: String? = nil
  var ordered: Bool? = nil
  var start: Int? = nil
  var loose: Bool? = nil
  var items: [CorpusItem]? = nil
  var align: [String?]? = nil
  var head: [[CorpusRun]]? = nil
  var rows: [[[CorpusRun]]]? = nil
  var blocks: [CorpusBlock]? = nil
  var html: String? = nil
}

private struct CorpusItem: Codable, Equatable, Sendable {
  var checked: Bool? = nil
  var blocks: [CorpusBlock]
}

private struct CorpusRun: Codable, Equatable, Sendable {
  var text: String
  var style: [String]? = nil
  var link: String? = nil
  /// Source URL, or empty when the image does not load. Nil when the run is not an image.
  var image: String? = nil
}

private let ordinaryGFM = [
  "heading", "unordered-list", "ordered-list", "task-list", "table", "code-fence", "link", "bare-url", "bare-thread-id",
]

private func loadCorpus() throws -> CorpusFile {
  let url = repoRoot.appending(path: "tests/fixtures/markdown/corpus.json")
  return try JSONDecoder().decode(CorpusFile.self, from: Data(contentsOf: url))
}

/// The block tree `Markdown` / `Autolink` produce, in the shape checked in as `mac`.
private func corpusBlocks(_ blocks: [MarkdownBlock]) -> [CorpusBlock] {
  blocks.map(corpusBlock)
}

private func corpusBlock(_ block: MarkdownBlock) -> CorpusBlock {
  switch block {
  case .paragraph(let text):
    return CorpusBlock(type: "paragraph", runs: corpusRuns(text))
  case .heading(let level, let text):
    return CorpusBlock(type: "heading", runs: corpusRuns(text), level: level)
  case .code(let language, let code):
    return CorpusBlock(type: "code", language: language, code: code)
  case .quote(let children):
    return CorpusBlock(type: "quote", blocks: corpusBlocks(children))
  case .list(let list):
    return CorpusBlock(
      type: "list", ordered: list.isOrdered, start: list.start, loose: list.isLoose,
      items: list.items.map { CorpusItem(checked: $0.checked, blocks: corpusBlocks($0.blocks)) }
    )
  case .table(let table):
    return CorpusBlock(
      type: "table", align: table.alignments.map(alignmentName), head: table.head.map(corpusRuns),
      rows: table.rows.map { $0.map(corpusRuns) }
    )
  case .thematicBreak:
    return CorpusBlock(type: "thematicBreak")
  case .html(let html):
    return CorpusBlock(type: "html", html: html)
  }
}

private func corpusRuns(_ text: MarkdownText) -> [CorpusRun] {
  text.runs.map { run in
    CorpusRun(
      text: run.text, style: styleNames(run.style), link: linkName(run.link),
      image: run.image.map { $0.source?.absoluteString ?? "" }
    )
  }
}

private func styleNames(_ style: MarkdownRun.Style) -> [String]? {
  var names: [String] = []
  if style.contains(.emphasis) { names.append("em") }
  if style.contains(.strong) { names.append("strong") }
  if style.contains(.strikethrough) { names.append("strike") }
  if style.contains(.code) { names.append("code") }
  return names.isEmpty ? nil : names
}

private func linkName(_ link: MarkdownLink?) -> String? {
  switch link {
  case .route(let route)?: route.hash
  case .external(let url)?: url.absoluteString
  case nil: nil
  }
}

private func alignmentName(_ alignment: MarkdownTable.Alignment?) -> String? {
  switch alignment {
  case .left?: "left"
  case .center?: "center"
  case .right?: "right"
  case nil: nil
  }
}

@Suite struct MarkdownCorpusTests {
  @Test func namesEveryAcceptedDifferenceAndKeepsOrdinaryGFM() throws {
    let corpus = try loadCorpus()
    let accepted = corpus.acceptedDifferences.map(\.name)
    #expect(Set(accepted).count == accepted.count)
    #expect(corpus.acceptedDifferences.allSatisfy { !$0.name.isEmpty && !$0.summary.isEmpty })

    let ids = corpus.snippets.map(\.id)
    #expect(Set(ids).count == ids.count)
    let used = Set(corpus.snippets.compactMap(\.difference))
    #expect(used == Set(accepted))
    for id in ordinaryGFM {
      #expect(corpus.snippets.contains { $0.id == id && $0.difference == nil })
    }
    for snippet in corpus.snippets {
      #expect(!snippet.source.isEmpty)
      #expect(!snippet.web.isEmpty)
      #expect(!snippet.mac.isEmpty)
    }
  }

  @Test func eachSnippetMatchesItsMacTree() throws {
    let corpus = try loadCorpus()
    for snippet in corpus.snippets {
      let got = corpusBlocks(MarkdownDocument(parsing: snippet.source).blocks)
      #expect(got == snippet.mac, "\(snippet.id) drifted from the corpus")
    }
  }
}
