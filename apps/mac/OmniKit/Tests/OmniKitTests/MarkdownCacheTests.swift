import Foundation
import Synchronization
import Testing
import OmniKit

/// Counts how often each text is parsed.
final class ParseCounter: Sendable {
  private let counts = Mutex<[String: Int]>([:])

  func parse(_ text: String) -> MarkdownDocument {
    counts.withLock { $0[text, default: 0] += 1 }
    return MarkdownDocument(parsing: text)
  }

  func count(_ text: String) -> Int { counts.withLock { $0[text] ?? 0 } }
  var total: Int { counts.withLock { $0.values.reduce(0, +) } }
}

@Suite struct MarkdownCacheTests {
  @Test func parsesEachEventOnce() {
    let counter = ParseCounter()
    let cache = MarkdownCache<Int>(parse: counter.parse)
    let first = cache.document(for: 1, text: "**hi**")
    let again = cache.document(for: 1, text: "**hi**")
    #expect(first == MarkdownDocument(parsing: "**hi**"))
    #expect(again == first)
    #expect(counter.count("**hi**") == 1)
    #expect(cache.cached(for: 1, text: "**hi**") == first)
  }

  @Test func eachEventHasItsOwnEntry() {
    let counter = ParseCounter()
    let cache = MarkdownCache<Int>(parse: counter.parse)
    _ = cache.document(for: 1, text: "same")
    _ = cache.document(for: 2, text: "same")
    _ = cache.document(for: 1, text: "same")
    _ = cache.document(for: 2, text: "same")
    #expect(counter.count("same") == 2)
    #expect(cache.count == 2)
  }

  @Test func newTextForAnEventParsesAgain() {
    let counter = ParseCounter()
    let cache = MarkdownCache<Int>(parse: counter.parse)
    _ = cache.document(for: 1, text: "old")
    #expect(cache.cached(for: 1, text: "new") == nil)
    #expect(cache.document(for: 1, text: "new") == MarkdownDocument(parsing: "new"))
    _ = cache.document(for: 1, text: "new")
    #expect(counter.count("old") == 1)
    #expect(counter.count("new") == 1)
    #expect(cache.count == 1)
  }

  @Test func cachedNeverParses() {
    let counter = ParseCounter()
    let cache = MarkdownCache<Int>(parse: counter.parse)
    #expect(cache.cached(for: 1, text: "a") == nil)
    #expect(counter.total == 0)
  }

  @Test func dropsTheLeastRecentlyUsedPastTheLimit() {
    let counter = ParseCounter()
    let cache = MarkdownCache<Int>(limit: 4, parse: counter.parse)
    for n in 1...4 { _ = cache.document(for: n, text: "m\(n)") }
    _ = cache.document(for: 1, text: "m1")
    _ = cache.document(for: 5, text: "m5")
    #expect(cache.count <= 4)
    #expect(cache.cached(for: 1, text: "m1") != nil)
    #expect(cache.cached(for: 5, text: "m5") != nil)
    #expect(cache.cached(for: 2, text: "m2") == nil)
    _ = cache.document(for: 2, text: "m2")
    #expect(counter.count("m1") == 1)
    #expect(counter.count("m2") == 2)
  }

  @Test func removeAllEmptiesTheCache() {
    let cache = MarkdownCache<Int>()
    _ = cache.document(for: 1, text: "a")
    cache.removeAll()
    #expect(cache.count == 0)
    #expect(cache.cached(for: 1, text: "a") == nil)
  }

  @Test func isSafeToShareAcrossTasks() async {
    let cache = MarkdownCache<Int>(limit: 50)
    let ok = await withTaskGroup(of: Bool.self) { group in
      for n in 0..<400 {
        group.addTask {
          let text = "item **\(n % 80)**"
          return cache.document(for: n % 80, text: text) == MarkdownDocument(parsing: text)
        }
      }
      return await group.reduce(true) { $0 && $1 }
    }
    #expect(ok)
    #expect(cache.count <= 50)
  }
}

@Suite struct MarkdownSpeedTests {
  static let id = "0b7c6d2e-5a1f-4c3e-9d8b-7a6f5e4d3c2b"

  /// A long agent reply: prose with links, ids and styles, lists, a table and code.
  static let longReply: String = {
    let chunk = """
      ## Step

      I looked at **the cart** and _checkout_ flow in https://github.com/ben-askphill/omni-os/pull/42 and thread \(id).
      See www.example.com/docs?q=1, ask ops@example.com, and keep `code \(id)` alone. ~~Old~~ text follows.

      - [x] Read `server/app.ts` (see https://x.com/a_(b))
      - [ ] Fix the *race* in [the store](#/t/\(id))
        - nested with https://example.org/path.

      | File | Change |
      |:--|--:|
      | `a.ts` | +12 |
      | b.ts | see \(id) |

      ```ts
      const url = "https://not.a.link/\(id)";
      ```

      > Quoted **text** with a link to <https://example.com> and more words to pad this line out a bit.


      """
    var s = ""
    while s.utf8.count < 24_000 { s += chunk }
    return s
  }()

  @Test func aLongReplyParsesQuickly() {
    #expect(Self.longReply.utf8.count > 20_000)
    _ = MarkdownDocument(parsing: "warm up https://x.com \(Self.id)")
    let start = ContinuousClock.now
    let doc = MarkdownDocument(parsing: Self.longReply)
    let took = ContinuousClock.now - start
    #expect(doc.blocks.count > 100)
    #expect(took < .milliseconds(250), "took \(took)")
  }

  /// Words that would make a naive scan quadratic.
  static let longWords: [String] = [
    String(repeating: "www.", count: 5_000),
    "https://" + String(repeating: "a.", count: 10_000),
    "https://x.com/" + String(repeating: "(.", count: 10_000),
    "https://x.com/" + String(repeating: "&amp", count: 5_000),
    String(repeating: "a_", count: 10_000) + "@x.com",
    String(repeating: "0b7c6d2e-", count: 2_500),
    String(repeating: "http://", count: 3_000),
    "[" + String(repeating: "a_", count: 10_000) + "@x.co1",
    "[" + String(repeating: "-a@", count: 5_000),
    "[" + String(repeating: ".a", count: 10_000) + "@b.c-",
    "[" + String(repeating: "www.", count: 5_000) + "a_b",
    String(repeating: "[", count: 5_000) + " http://localhost",
  ]

  @Test(arguments: longWords)
  func oneLongWordParsesQuickly(_ word: String) {
    let start = ContinuousClock.now
    _ = MarkdownDocument(parsing: word)
    let took = ContinuousClock.now - start
    #expect(took < .milliseconds(250), "took \(took)")
  }
}
