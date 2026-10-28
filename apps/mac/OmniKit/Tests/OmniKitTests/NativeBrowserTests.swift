import Foundation
import Testing

@testable import OmniKit

@Suite struct NativeBrowserTests {
  @Test func addressesLoadAsTheyAreOrGetAScheme() {
    #expect(NativeBrowserAddress.resolve("https://shop.example.com/cart?a=1")?.absoluteString == "https://shop.example.com/cart?a=1")
    #expect(NativeBrowserAddress.resolve("  example.com/pricing ")?.absoluteString == "https://example.com/pricing")
    #expect(NativeBrowserAddress.resolve("localhost:4747")?.absoluteString == "http://localhost:4747")
    #expect(NativeBrowserAddress.resolve("192.168.1.20:3000/x")?.absoluteString == "http://192.168.1.20:3000/x")
    #expect(NativeBrowserAddress.resolve("about:blank")?.absoluteString == "about:blank")
  }

  @Test func wordsAndOtherSchemesBecomeASearch() {
    #expect(NativeBrowserAddress.resolve("best shopify theme")?.absoluteString == "https://www.google.com/search?q=best%20shopify%20theme")
    #expect(NativeBrowserAddress.resolve("a&b=c")?.absoluteString == "https://www.google.com/search?q=a%26b%3Dc")
    let file = NativeBrowserAddress.resolve("file:///etc/passwd")?.absoluteString ?? ""
    #expect(file.hasPrefix("https://www.google.com/search?q="))
    let js = NativeBrowserAddress.resolve("javascript://x.com/%0Aalert(1)")?.absoluteString ?? ""
    #expect(js.hasPrefix("https://www.google.com/search?q="))
    #expect(NativeBrowserAddress.resolve("   ") == nil)
  }

  @Test func aPickMeansTheSamePageOnlyWhileItHoldsStill() {
    let a = NativePageSnapshot(url: "https://x.com/", title: "X", viewportWidth: 800, viewportHeight: 600, scrollX: 0, scrollY: 240)
    var b = a
    b.scrollY = 241
    #expect(a.matches(b))
    b.scrollY = 300
    #expect(!a.matches(b))
    b = a
    b.url = "https://x.com/other"
    #expect(!a.matches(b))
    b = a
    b.viewportWidth = 801
    #expect(!a.matches(b))
  }
}
