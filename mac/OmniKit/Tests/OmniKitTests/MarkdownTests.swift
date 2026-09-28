import Foundation
import Testing
import OmniKit

func blocks(_ source: String) -> [MarkdownBlock] {
  MarkdownDocument(parsing: source).blocks
}

/// The inline content of the one paragraph `source` parses to, written back compactly: `*em*`, `**strong**`,
/// `~~strike~~`, `` `code` ``, `![alt](src)`, and links as `[text](href)` with a route as its hash.
func inline(_ source: String) -> String? {
  let parsed = blocks(source)
  guard parsed.count == 1, case .paragraph(let text) = parsed[0] else { return nil }
  return notation(text)
}

func notation(_ text: MarkdownText) -> String {
  text.runs.map { run in
    var s = run.text
    if run.style.contains(.code) { s = "`\(s)`" }
    if run.style.contains(.strikethrough) { s = "~~\(s)~~" }
    if run.style.contains(.strong) { s = "**\(s)**" }
    if run.style.contains(.emphasis) { s = "*\(s)*" }
    if let image = run.image { s = "![\(s)](\(image.source?.absoluteString ?? ""))" }
    switch run.link {
    case .route(let route)?: s = "[\(s)](\(route.hash))"
    case .external(let url)?: s = "[\(s)](\(url.absoluteString))"
    case nil: break
    }
    return s
  }.joined()
}

func para(_ runs: MarkdownRun...) -> MarkdownBlock {
  .paragraph(MarkdownText(runs))
}

func plain(_ s: String) -> MarkdownText {
  MarkdownText([MarkdownRun(s)])
}

@Suite struct MarkdownBlockTests {
  @Test func emptyInputHasNoBlocks() {
    #expect(blocks("").isEmpty)
    #expect(blocks("\n\n  \n").isEmpty)
  }

  @Test func paragraphsSplitOnBlankLines() {
    #expect(blocks("one\n\ntwo") == [para(MarkdownRun("one")), para(MarkdownRun("two"))])
  }

  @Test func headings() {
    #expect(blocks("# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six") == [
      .heading(level: 1, plain("One")), .heading(level: 2, plain("Two")), .heading(level: 3, plain("Three")),
      .heading(level: 4, plain("Four")), .heading(level: 5, plain("Five")), .heading(level: 6, plain("Six")),
    ])
    #expect(blocks("Title\n=====\n\nSub\n---") == [.heading(level: 1, plain("Title")), .heading(level: 2, plain("Sub"))])
    #expect(blocks("####### seven") == [para(MarkdownRun("####### seven"))])
  }

  @Test func codeBlocksKeepTheirTextAndFirstWordOfTheLanguage() {
    #expect(blocks("```swift title=x\nlet a = 1\n  indented\n```") == [.code(language: "swift", code: "let a = 1\n  indented")])
    #expect(blocks("~~~\nplain\n~~~") == [.code(language: nil, code: "plain")])
    #expect(blocks("    indented\n    code") == [.code(language: nil, code: "indented\ncode")])
    #expect(blocks("```\n```") == [.code(language: nil, code: "")])
    #expect(blocks("```ts\n**not bold** https://x.com\n```") == [.code(language: "ts", code: "**not bold** https://x.com")])
  }

  @Test func blockQuotesNest() {
    #expect(blocks("> a\n>\n> > b") == [.quote([para(MarkdownRun("a")), .quote([para(MarkdownRun("b"))])])])
    #expect(blocks("> # Head\n> - item") == [
      .quote([.heading(level: 1, plain("Head")), .list(MarkdownList(items: [MarkdownListItem([para(MarkdownRun("item"))])]))]),
    ])
  }

  @Test func unorderedAndOrderedLists() {
    #expect(blocks("- a\n- b") == [
      .list(MarkdownList(items: [MarkdownListItem([para(MarkdownRun("a"))]), MarkdownListItem([para(MarkdownRun("b"))])])),
    ])
    #expect(blocks("3) x\n4) y") == [
      .list(MarkdownList(ordered: true, start: 3, items: [MarkdownListItem([para(MarkdownRun("x"))]), MarkdownListItem([para(MarkdownRun("y"))])])),
    ])
    #expect(blocks("1. a\n1. b") == [
      .list(MarkdownList(ordered: true, start: 1, items: [MarkdownListItem([para(MarkdownRun("a"))]), MarkdownListItem([para(MarkdownRun("b"))])])),
    ])
    // A new bullet character starts a new list.
    #expect(blocks("* a\n+ b").count == 2)
  }

  @Test func listsNest() {
    let inner = MarkdownList(items: [MarkdownListItem([para(MarkdownRun("b"))])])
    #expect(blocks("- a\n  - b\n- c") == [
      .list(MarkdownList(items: [
        MarkdownListItem([para(MarkdownRun("a")), .list(inner)]),
        MarkdownListItem([para(MarkdownRun("c"))]),
      ])),
    ])
  }

  @Test(arguments: [
    ("- a\n- b", false),
    ("1. x\n2. y", false),
    ("- a\n- b\n\n- c", true),
    ("- a\n\n  more\n- b", true),
    ("- a\n  - b\n\n- c", true),
    ("- ```\n  x\n  ```\n\n- b", true),
    ("- a\n- b\n\n\nafter", false),
  ])
  func listsAreLooseWithABlankLineBetweenItemsOrTheirBlocks(source: String, loose: Bool) {
    guard case .list(let list) = blocks(source).first else {
      Issue.record("no list")
      return
    }
    #expect(list.isLoose == loose)
  }

  @Test func aBlankLineInsideANestedListOnlyLoosensThatList() {
    guard case .list(let outer) = blocks("- a\n  - b\n\n    c").first, case .list(let inner) = outer.items[0].blocks.last else {
      Issue.record("no nested list")
      return
    }
    #expect(!outer.isLoose)
    #expect(inner.isLoose)
  }

  @Test func taskLists() {
    guard case .list(let list) = blocks("- [ ] todo\n- [x] done\n- [X] also\n- plain").first else {
      Issue.record("no list")
      return
    }
    #expect(list.items.map(\.checked) == [false, true, true, nil])
    #expect(list.items[0].blocks == [para(MarkdownRun("todo"))])
  }

  @Test func tablesWithAlignment() {
    let source = """
      | Name | Left | Mid | Right |
      |---|:--|:-:|--:|
      | *a* | b | `c` | [d](https://x.com) |
      """
    #expect(blocks(source) == [
      .table(MarkdownTable(
        alignments: [nil, .left, .center, .right],
        head: [plain("Name"), plain("Left"), plain("Mid"), plain("Right")],
        rows: [[
          MarkdownText([MarkdownRun("a", style: .emphasis)]), plain("b"), MarkdownText([MarkdownRun("c", style: .code)]),
          MarkdownText([MarkdownRun("d", link: .external(URL(string: "https://x.com")!))]),
        ]]
      )),
    ])
  }

  @Test func tableRowsArePaddedOrCutToTheHeader() {
    let source = """
      | a | b | c |
      |---|---|---|
      | 1 || 3 |
      | ^ | x | y |
      | short |
      | 1 | 2 | 3 | 4 |
      """
    guard case .table(let table) = blocks(source).first else {
      Issue.record("no table")
      return
    }
    #expect(table.rows.map { $0.map(\.plain) } == [["1", "", "3"], ["^", "x", "y"], ["short", "", ""], ["1", "2", "3"]])
  }

  @Test func thematicBreaks() {
    #expect(blocks("a\n\n***\n\n---\n\n___") == [para(MarkdownRun("a")), .thematicBreak, .thematicBreak, .thematicBreak])
  }

  @Test func rawHTMLShowsAsText() {
    #expect(blocks("<div>\nhi 0b7c6d2e-5a1f-4c3e-9d8b-7a6f5e4d3c2b\n</div>\n\npara") == [
      .html("<div>\nhi 0b7c6d2e-5a1f-4c3e-9d8b-7a6f5e4d3c2b\n</div>"), para(MarkdownRun("para")),
    ])
    #expect(inline("a <b>c</b> d") == "a <b>c</b> d")
    #expect(inline("x <script>alert(1)</script>") == "x <script>alert(1)</script>")
  }
}

@Suite struct MarkdownInlineTests {
  @Test func emphasisStrongStrikethroughAndCode() {
    #expect(inline("a *b* _c_ **d** __e__ ~~f~~ ~g~ `h`") == "a *b* *c* **d** **e** ~~f~~ ~~g~~ `h`")
    #expect(inline("***both***") == "***both***")
    #expect(inline("**bold *and em***") == "**bold *****and em***")
    #expect(inline("~~**x**~~") == "**~~x~~**")
  }

  @Test func adjacentRunsWithTheSameLookMerge() {
    #expect(blocks("a\\*b *c* d") == [para(MarkdownRun("a*b "), MarkdownRun("c", style: .emphasis), MarkdownRun(" d"))])
  }

  @Test func inlineCodeKeepsItsText() {
    #expect(inline("`a  *b*  c`") == "`a  *b*  c`")
    #expect(inline("`` a`b ``") == "`a`b`")
  }

  @Test func breaks() {
    #expect(inline("a\nb") == "a b")
    #expect(inline("a  \nb") == "a\nb")
    #expect(inline("a\\\nb") == "a\nb")
  }

  @Test func entitiesAndEscapes() {
    #expect(inline("&amp; &copy; &#35;") == "& © #")
    #expect(inline("\\*not em\\* \\`not code\\`") == "*not em* `not code`")
  }

  @Test func punctuationStaysAsTyped() {
    #expect(inline("\"q\" 'q' -- --- ...") == "\"q\" 'q' -- --- ...")
  }

  @Test func links() {
    #expect(inline("[a *b*](https://x.com/p \"T\")") == "[a ](https://x.com/p)[*b*](https://x.com/p)")
    #expect(inline("[ref][1]\n\n[1]: https://x.com") == "[ref](https://x.com)")
    #expect(inline("<https://x.com/a>") == "[https://x.com/a](https://x.com/a)")
    #expect(inline("<a@b.co>") == "[a@b.co](mailto:a@b.co)")
  }

  @Test func images() {
    let parsed = blocks("![alt *t*](http://i.png \"Title\") and [![a](https://i.png)](https://x.com)")
    guard case .paragraph(let text) = parsed.first else {
      Issue.record("no paragraph")
      return
    }
    #expect(notation(text) == "![alt t](http://i.png) and [![a](https://i.png)](https://x.com)")
    #expect(text.runs[0].image == MarkdownImage(source: URL(string: "http://i.png"), alt: "alt t", title: "Title"))
    #expect(text.segments == [
      .image(MarkdownImage(source: URL(string: "http://i.png"), alt: "alt t", title: "Title"), link: nil),
      .text(AttributedString(" and ")),
      .image(MarkdownImage(source: URL(string: "https://i.png"), alt: "a", title: nil), link: .external(URL(string: "https://x.com")!)),
    ])
  }

  @Test func imagesOnlyLoadOverHTTP() {
    #expect(inline("![x](javascript:alert(1))") == "![x]()")
    #expect(inline("![x](file:///etc/passwd)") == "![x]()")
    #expect(inline("![x](data:image/png;base64,AAAA)") == "![x]()")
    #expect(inline("![x](/local.png)") == "![x]()")
  }

  @Test func textWithoutImagesIsOneSegment() {
    let text = MarkdownText([MarkdownRun("a "), MarkdownRun("b", style: .strong)])
    #expect(text.segments == [.text(text.attributed)])
  }
}

@Suite struct MarkdownAttributedTests {
  func attributed(_ source: String) -> AttributedString {
    guard case .paragraph(let text) = blocks(source).first else { return AttributedString() }
    return text.attributed
  }

  @Test func stylesBecomeInlinePresentationIntents() {
    let a = attributed("p *e* **s** ~~x~~ `c` ***b***")
    #expect(String(a.characters) == "p e s x c b")
    let intents = a.runs.map { run in (String(a[run.range].characters), run.inlinePresentationIntent) }
    #expect(intents.map(\.0) == ["p ", "e", " ", "s", " ", "x", " ", "c", " ", "b"])
    let want: [InlinePresentationIntent?] = [
      nil, .emphasized, nil, .stronglyEmphasized, nil, .strikethrough, nil, .code, nil, [.emphasized, .stronglyEmphasized],
    ]
    #expect(intents.map(\.1) == want)
  }

  @Test func linksCarryTheirURL() {
    let id = "0b7c6d2e-5a1f-4c3e-9d8b-7a6f5e4d3c2b"
    let a = attributed("[x](https://x.com) \(id) [c](#/c/acme)")
    let links = a.runs.compactMap { run in run.link.map { (String(a[run.range].characters), $0) } }
    #expect(links.map(\.0) == ["x", "0b7c6d2e", "c"])
    #expect(links.map(\.1) == [URL(string: "https://x.com")!, URL(string: "omni:#/t/\(id)")!, URL(string: "omni:#/c/acme")!])
  }

  @Test func imagesShowTheirAltText() {
    #expect(String(attributed("see ![a chart](https://i.png)").characters) == "see a chart")
  }
}
