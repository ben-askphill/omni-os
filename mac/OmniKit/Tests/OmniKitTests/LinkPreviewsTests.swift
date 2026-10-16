import Foundation
import Testing
@testable import OmniKit

private actor FakeLinks: LinkPreviewAPI {
  var asked: [(urls: [String], channel: String?)] = []

  func resolveLinks(_ urls: [String], channelID: String?) async throws(OmniAPIError) -> [String: LinkPreview] {
    asked.append((urls, channelID))
    var out: [String: LinkPreview] = [:]
    for u in urls { out[u] = LinkPreview(url: u, source: "github", icon: "github", name: "GitHub", ref: "#1", text: "Title of \(u)", resolved: true) }
    return out
  }

  func linkIcons() async throws(OmniAPIError) -> [String: [LinkIconLayer]] { ["github": [LinkIconLayer(d: "M0 0h24v24H0z", fill: "#181717")]] }
}

@MainActor
struct LinkPreviewsTests {
  @Test func decodesTheServersPreview() throws {
    let json = ##"{"url":"https://github.com/a/b/pull/7","source":"github","icon":"github","name":"GitHub","kind":"pull","ref":"#7","text":"Fix it","resolved":true,"state":"Merged"}"##
    let p = try OmniJSON.decoder().decode(LinkPreview.self, from: Data(json.utf8))
    #expect(p.ref == "#7" && p.text == "Fix it" && p.state == "Merged" && p.needs == nil)
    #expect(p.tooltip == "GitHub · Merged\n#7 Fix it\nhttps://github.com/a/b/pull/7")
  }

  @Test func plainWebPagesStayAsWritten() {
    let web = LinkPreview(url: "https://example.com", source: "web", icon: "link", name: "Web", text: "example.com", resolved: false)
    #expect(web.isPlain(bare: true))
    let titled = LinkPreview(url: "https://example.com", source: "web", icon: "link", name: "Web", text: "Example", resolved: true)
    #expect(!titled.isPlain(bare: true) && titled.isPlain(bare: false))
    #expect(LinkPreview.isBare(href: "http://www.x.com", text: "www.x.com"))
    #expect(!LinkPreview.isBare(href: "https://x.com/a", text: "PR #1"))
  }

  @Test func asksEachURLOncePerChannelInOneBatch() async {
    let api = FakeLinks()
    let store = LinkPreviewStore(delay: .seconds(60))
    store.connect(api: api)
    store.want(["https://a.test/1", "https://a.test/2", "mailto:x@y.z"], channel: "acme")
    store.want(["https://a.test/1"], channel: "acme")
    await store.flush()
    await store.iconsLoaded()
    let asked = await api.asked
    #expect(asked.count == 1)
    #expect(asked.first?.urls == ["https://a.test/1", "https://a.test/2"] && asked.first?.channel == "acme")
    #expect(store.preview("https://a.test/1", channel: "acme")?.text == "Title of https://a.test/1")
    #expect(store.preview("https://a.test/1", channel: nil) == nil)
    #expect(store.icons["github"]?.first?.rgb?.red == Double(0x18) / 255)
  }

  @Test func listsTheDocumentsOutsideLinks() {
    let doc = MarkdownDocument(parsing: "See https://github.com/a/b/pull/1 and [x](https://x.test/) and [t](#/t/x).\n\n- https://github.com/a/b/pull/1\n\n| a |\n| - |\n| https://y.test |")
    #expect(doc.externalURLs == ["https://github.com/a/b/pull/1", "https://x.test/", "https://y.test"])
  }
}
