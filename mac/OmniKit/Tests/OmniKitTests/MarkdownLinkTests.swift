import Foundation
import Testing
import OmniKit

private let id = "0b7c6d2e-5a1f-4c3e-9d8b-7a6f5e4d3c2b"
private let short = "[0b7c6d2e](#/t/\(id))"

@Suite struct MarkdownLinkTests {
  @Test func hashLinksOpenRoutes() {
    #expect(inline("[open](#/t/abc)") == "[open](#/t/abc)")
    #expect(inline("[prs](#/c/acme/prs/4)") == "[prs](#/c/acme/prs/4)")
    #expect(inline("[home](#/)") == "[home](#/)")
    #expect(inline("[spaced](<#/t/a b>)") == "[spaced](#/t/a%20b)")
    #expect(MarkdownLink(destination: "#/t/abc?artifact=2") == .route(.thread(id: "abc", artifact: 2)))
  }

  @Test func hashLinksToNoScreenAreNotLinked() {
    #expect(inline("[x](#nope)") == "x")
    #expect(inline("[x](#/nope)") == "x")
  }

  @Test func webLinksStayExternal() {
    #expect(inline("[x](https://x.com/a?b=1#c)") == "[x](https://x.com/a?b=1#c)")
    #expect(inline("[x](http://localhost:4747/#/t/abc)") == "[x](http://localhost:4747/#/t/abc)")
    #expect(inline("[x](HTTPS://X.COM)") == "[x](HTTPS://X.COM)")
    #expect(inline("[x](mailto:a@b.co)") == "[x](mailto:a@b.co)")
    #expect(MarkdownLink(destination: "https://x.com") == .external(URL(string: "https://x.com")!))
  }

  @Test(arguments: [
    "javascript:alert(1)", "JavaScript:alert(1)", " javascript:alert(1)", "vbscript:x", "data:text/html,hi",
    "file:///etc/passwd", "ftp://x.com", "omni:#/t/abc", "x-apple.systempreferences:", "/api/x", "relative.html",
    "//x.com/a", "https:x.com", "https://", "mailto:",
  ])
  func otherDestinationsAreNotLinked(_ destination: String) {
    #expect(MarkdownLink(destination: destination) == nil)
  }

  @Test func unsafeLinksKeepTheirText() {
    #expect(inline("[click](javascript:alert(1))") == "click")
    #expect(inline("<javascript:alert(1)>") == "javascript:alert(1)")
    #expect(inline("[f](file:///etc/passwd) [r](/api/x)") == "f r")
  }

  @Test func routesRoundTripThroughTheirURL() {
    for route in RouteTests.everyRoute {
      if case .notFound = route { continue }
      let link = MarkdownLink.route(route)
      #expect(link.url.scheme == "omni")
      #expect(MarkdownLink(url: link.url) == link)
    }
  }

  @Test func urlsFollowTheSamePolicy() {
    #expect(MarkdownLink(url: URL(string: "omni:#/t/abc")!) == .route(.thread(id: "abc")))
    #expect(MarkdownLink(url: URL(string: "omni:#/nope")!) == nil)
    #expect(MarkdownLink(url: URL(string: "https://x.com/a")!) == .external(URL(string: "https://x.com/a")!))
    #expect(MarkdownLink(url: URL(string: "javascript:alert(1)")!) == nil)
    #expect(MarkdownLink(url: URL(string: "file:///etc/passwd")!) == nil)
    #expect(MarkdownLink.external(URL(string: "https://x.com")!).url == URL(string: "https://x.com")!)
  }

  /// As micromark's normalizeUri: characters a URL cannot hold are percent encoded, escapes already there are kept.
  @Test func hrefsAreEncodedAsTheWebEncodesThem() {
    #expect(inline("https://x.com/%20a>") == "[https://x.com/%20a>](https://x.com/%20a%3E)")
    #expect(inline("https://x.com/é%20a") == "[https://x.com/é%20a](https://x.com/%C3%A9%20a)")
    #expect(inline("https://x.com/100%") == "[https://x.com/100%](https://x.com/100%25)")
    #expect(inline("\"http://example\"/") == "\"[http://example\"/](http://example%22/)")
    #expect(inline("[x](<https://x.com/a b>)") == "[x](https://x.com/a%20b)")
    #expect(MarkdownLink(destination: "http://[::1]:4747/x")?.url.absoluteString == "http://[::1]:4747/x")
  }
}

@Suite struct MarkdownThreadIDTests {
  @Test func bareIDsLinkToTheirThread() {
    #expect(inline("see \(id) now") == "see \(short) now")
    #expect(inline("(\(id)), \(id).") == "(\(short)), \(short).")
    #expect(inline("\(id)-x") == "\(short)-x")
    #expect(inline("**\(id)**") == "[**0b7c6d2e**](#/t/\(id))")
  }

  @Test func idsInsideWordsOrOtherCaseAreLeftAlone() {
    #expect(inline("x\(id)") == "x\(id)")
    #expect(inline("\(id)a") == "\(id)a")
    #expect(inline("\(id)_") == "\(id)_")
    #expect(inline(id.uppercased()) == id.uppercased())
    #expect(inline("0b7c6d2e-5a1f-4c3e-9d8b") == "0b7c6d2e-5a1f-4c3e-9d8b")
  }

  @Test func idsInCodeAreLeftAlone() {
    #expect(inline("`id \(id)`") == "`id \(id)`")
    #expect(blocks("```\n\(id)\n```") == [.code(language: nil, code: id)])
    #expect(blocks("    \(id)") == [.code(language: nil, code: id)])
    #expect(blocks("~~~\n\(id)\n~~~") == [.code(language: nil, code: id)])
  }

  @Test func inlineCodeThatIsExactlyAnIDLinksAsCode() {
    #expect(inline("`\(id)`") == "[`0b7c6d2e`](#/t/\(id))")
    #expect(inline("[`\(id)`](https://x.com)") == "[`\(id)`](https://x.com)")
  }

  @Test func idsInLinksKeepTheLink() {
    #expect(inline("[run \(id)](https://x.com)") == "[run \(id)](https://x.com)")
    #expect(inline("[\(id)](#/c/acme)") == "[\(id)](#/c/acme)")
    #expect(inline("![\(id)](https://i.png)") == "![\(id)](https://i.png)")
  }

  @Test func anIDInsideAURLStaysPartOfTheURL() {
    #expect(inline("https://x.com/t/\(id)") == "[https://x.com/t/\(id)](https://x.com/t/\(id))")
    #expect(inline("http://127.0.0.1:4747/#/t/\(id)") == "[http://127.0.0.1:4747/#/t/\(id)](http://127.0.0.1:4747/#/t/\(id))")
  }

  @Test func idsLinkInEveryBlock() {
    #expect(blocks("# \(id)") == [.heading(level: 1, MarkdownText([MarkdownRun("0b7c6d2e", link: .route(.thread(id: id)))]))])
    #expect(blocks("> \(id)") == [.quote([para(MarkdownRun("0b7c6d2e", link: .route(.thread(id: id))))])])
    guard case .list(let list) = blocks("- \(id)").first, case .table(let table) = blocks("| a |\n|---|\n| \(id) |").first else {
      Issue.record("no list or table")
      return
    }
    #expect(list.items[0].blocks == [para(MarkdownRun("0b7c6d2e", link: .route(.thread(id: id))))])
    #expect(notation(table.rows[0][0]) == short)
  }

  @Test func idsBetweenTagsLink() {
    #expect(inline("a <span>\(id)</span> b") == "a <span>\(short)</span> b")
  }
}

/// Bare URLs and emails, checked against what the Web UI's remark-gfm makes of the same text.
@Suite struct MarkdownAutolinkTests {
  @Test(arguments: [
    ("http://localhost:4747/x", "[http://localhost:4747/x](http://localhost:4747/x)"),
    ("see https://example.com/a?b=1.", "see [https://example.com/a?b=1](https://example.com/a?b=1)."),
    ("(see https://x.com/a_(b))", "(see [https://x.com/a_(b)](https://x.com/a_(b)))"),
    ("www.example.com", "[www.example.com](http://www.example.com)"),
    ("\"www.x.com\"", "\"[www.x.com](http://www.x.com)\""),
    ("[https://x.com]", "[[https://x.com](https://x.com)]"),
    ("xhttps://x.com", "xhttps://x.com"),
    ("1https://x.com", "1[https://x.com](https://x.com)"),
    ("https://x.com/a&b", "[https://x.com/a&b](https://x.com/a&b)"),
    ("https://x.com/<b>", "[https://x.com/](https://x.com/)<b>"),
    ("HTTPS://X.COM/A", "[HTTPS://X.COM/A](HTTPS://X.COM/A)"),
    ("`https://x.com`", "`https://x.com`"),
    ("[see https://x.com](https://y.com)", "[see https://x.com](https://y.com)"),
    ("*https://x.com*", "[*https://x.com*](https://x.com)"),
    ("**https://x.com**", "[**https://x.com**](https://x.com)"),
    ("_https://x.com_", "[*https://x.com*](https://x.com)"),
    ("~~https://x.com~~", "[~~https://x.com~~](https://x.com)"),
    ("http://x", "[http://x](http://x)"),
    ("http://x_y.com", "http://x_y.com"),
    ("http://a_b.x_y.com", "http://a_b.x_y.com"),
    ("http://a_b.c.com", "[http://a_b.c.com](http://a_b.c.com)"),
    ("https://", "https://"),
    ("https://.", "https://."),
    ("www.", "[www](http://www)."),
    ("www.x", "[www.x](http://www.x)"),
    ("wwwx.com", "wwwx.com"),
    ("ftp://x.com", "ftp://x.com"),
    ("https://x.com/a)b", "[https://x.com/a)b](https://x.com/a)b)"),
    ("https://x.com/(a)", "[https://x.com/(a)](https://x.com/(a))"),
    ("https://x.com/a))", "[https://x.com/a](https://x.com/a)))"),
    ("https://ex.com/a.b.", "[https://ex.com/a.b](https://ex.com/a.b)."),
    ("https://-x.com", "[https://-x.com](https://-x.com)"),
    ("https://x-.com", "[https://x-.com](https://x-.com)"),
    ("ok https://x.com\nnext", "ok [https://x.com](https://x.com) next"),
    ("a.www.x.com", "a.[www.x.com](http://www.x.com)"),
    ("(www.x.com)", "([www.x.com](http://www.x.com))"),
    ("_www.x.com_", "[*www.x.com*](http://www.x.com)"),
    ("www.x.com/path_(a)_b", "[www.x.com/path_(a)_b](http://www.x.com/path_(a)_b)"),
    ("see: https://x.com/a?q=1&b=2#frag.", "see: [https://x.com/a?q=1&b=2#frag](https://x.com/a?q=1&b=2#frag)."),
    ("**bold**https://x.com", "**bold**[https://x.com](https://x.com)"),
    ("`c`www.x.com", "`c`[www.x.com](http://www.x.com)"),
    ("https://x.com:8080/a", "[https://x.com:8080/a](https://x.com:8080/a)"),
  ])
  func urls(source: String, want: String) {
    #expect(inline(source) == want)
  }

  @Test(arguments: ["!", ",", ":", ";", "?", "'", "\"", "]", "*", "_", "~", ".", ")", "...", "?!"])
  func trailingPunctuationIsNotPartOfTheURL(_ trail: String) {
    #expect(inline("go to https://x.com/a\(trail)") == "go to [https://x.com/a](https://x.com/a)\(trail)")
  }

  @Test func aClosingBraceIsPartOfTheURL() {
    #expect(inline("https://x.com/a}") == "[https://x.com/a}](https://x.com/a%7D)")
  }

  @Test(arguments: [
    ("a@b.co", "[a@b.co](mailto:a@b.co)"),
    ("/a@b.co", "/a@b.co"),
    ("a@b.co1", "a@b.co1"),
    ("mail me: first.last+tag@sub.example.org.", "mail me: [first.last+tag@sub.example.org](mailto:first.last+tag@sub.example.org)."),
    ("foo@bar", "foo@bar"),
    ("foo@bar.c_m", "[foo@bar.c_m](mailto:foo@bar.c_m)"),
    ("user_name@x.com", "[user_name@x.com](mailto:user_name@x.com)"),
    ("x@y.com.", "[x@y.com](mailto:x@y.com)."),
    ("x@y-z.com", "[x@y-z.com](mailto:x@y-z.com)"),
    ("x@y.co-", "x@y.co-"),
    ("mailto:a@b.co and <a@b.co>", "mailto:[a@b.co](mailto:a@b.co) and [a@b.co](mailto:a@b.co)"),
    ("_a@b.co_", "[*a@b.co*](mailto:a@b.co)"),
  ])
  func emails(source: String, want: String) {
    #expect(inline(source) == want)
  }

  /// micromark finds no literal links after a `[` that has not closed yet. The pass after it still links URLs
  /// with a dot and emails.
  @Test(arguments: [
    ("[http://localhost:4747]", "[http://localhost:4747]"),
    ("[see https://x.com/a] b", "[see [https://x.com/a](https://x.com/a)] b"),
    ("[a] http://localhost:4747", "[a] [http://localhost:4747](http://localhost:4747)"),
    ("\\[http://localhost:4747", "[[http://localhost:4747](http://localhost:4747)"),
    ("&#91;http://localhost:4747", "[[http://localhost:4747](http://localhost:4747)"),
    ("&lsqb;http://localhost:4747", "[[http://localhost:4747](http://localhost:4747)"),
    ("a \\\\[http://localhost:4747", "a \\[http://localhost:4747"),
    ("[a [b](https://y.com) http://localhost:4747", "[a [b](https://y.com) http://localhost:4747"),
    ("![x http://localhost:4747", "![x http://localhost:4747"),
    ("[x *http://localhost:4747*", "[x *http://localhost:4747*"),
    ("https://x.com/a[b http://localhost:4747", "[https://x.com/a[b](https://x.com/a%5Bb) [http://localhost:4747](http://localhost:4747)"),
    ("`[` http://localhost:4747", "`[` [http://localhost:4747](http://localhost:4747)"),
    ("[[a] http://localhost:4747", "[[a] http://localhost:4747"),
    ("[a]] http://localhost:4747", "[a]] [http://localhost:4747](http://localhost:4747)"),
    ("[^1] http://localhost:4747", "[^1] [http://localhost:4747](http://localhost:4747)"),
    ("[x http://localhost:4747 and\nnext http://localhost:4747", "[x http://localhost:4747 and next http://localhost:4747"),
    ("[x http://x.com.", "[x [http://x.com](http://x.com)."),
    ("[x www.x.com)", "[x [www.x.com](http://www.x.com))"),
    ("[x https://x.com/a_", "[x [https://x.com/a_](https://x.com/a_)"),
    ("[a ![b](https://y.com/i.png) http://localhost", "[a ![b](https://y.com/i.png) http://localhost"),
    ("[www.x.com", "[[www.x.com](http://www.x.com)"),
    ("[mail ops@example.com", "[mail [ops@example.com](mailto:ops@example.com)"),
    ("[x a_b@x.co", "[x [a_b@x.co](mailto:a_b@x.co)"),
    ("[x /a@b.co", "[x /a@b.co"),
    ("[x a@b.co1", "[x a@b.co1"),
    ("[x a@b.c_", "[x a@b.c_"),
    ("[x a@b.c-d", "[x [a@b.c-d](mailto:a@b.c-d)"),
    ("[x éa@b.co", "[x éa@b.co"),
    ("[x a@b.-c", "[x [a@b.-c](mailto:a@b.-c)"),
    ("[x .a@b.co", "[x [.a@b.co](mailto:.a@b.co)"),
    ("[x a.@b.co", "[x [a.@b.co](mailto:a.@b.co)"),
  ])
  func anOpenBracketHoldsBackLiteralLinks(source: String, want: String) {
    #expect(inline(source) == want)
  }

  @Test func eachBlockAndCellStartsWithNoOpenBracket() {
    #expect(blocks("[x\n\nhttp://localhost:4747") == [
      .paragraph(MarkdownText([MarkdownRun("[x")])),
      .paragraph(MarkdownText([MarkdownRun("http://localhost:4747", link: .external(URL(string: "http://localhost:4747")!))])),
    ])
    guard case .table(let table) = blocks("| [a | http://localhost:4747 |\n|--|--|").first else {
      Issue.record("no table")
      return
    }
    #expect(notation(table.head[1]) == "[http://localhost:4747](http://localhost:4747)")
    #expect(inline("# [a http://localhost:4747") == nil)
    #expect(blocks("# [a http://localhost:4747") == [.heading(level: 1, MarkdownText([MarkdownRun("[a http://localhost:4747")]))])
  }

  @Test func urlsInCodeAndHTMLAreLeftAlone() {
    #expect(blocks("```\nhttps://x.com\n```") == [.code(language: nil, code: "https://x.com")])
    #expect(blocks("<div>https://x.com</div>") == [.html("<div>https://x.com</div>")])
  }

  @Test func urlsLinkInTablesAndHeadings() {
    #expect(blocks("## See www.x.com") == [
      .heading(level: 2, MarkdownText([MarkdownRun("See "), MarkdownRun("www.x.com", link: .external(URL(string: "http://www.x.com")!))])),
    ])
    guard case .table(let table) = blocks("| a |\n|---|\n| https://x.com/a |").first else {
      Issue.record("no table")
      return
    }
    #expect(notation(table.rows[0][0]) == "[https://x.com/a](https://x.com/a)")
  }
}
