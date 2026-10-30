import Foundation
import Testing
import OmniKit

/// Cases from packages/shared/tests/thread-actions.test.ts, through the bundled engine. thread-menu.json is the
/// shared module's menu for a thread every action applies to, recorded by apps/server/tests/mac-fixtures.test.ts.
private let every = ThreadMenuFacts(
  row: true, settled: true, harness: "claude-code", handOff: true, takeOverFrom: "Studio", grokBot: true)
private let engine = SlashEngine.shared

@Suite struct ThreadMenuTests {
  @Test func matchesTheRecordedMenu() throws {
    #expect(engine.threadMenu(every) == (try decodeFixture([ThreadMenuGroup].self, "thread-menu.json")))
  }

  @Test func groupsTenActionsAtMost() {
    let menu = engine.threadMenu(every)
    #expect(menu.map(\.title) == ["Organize", "Continue", "Send to"])
    #expect(menu.flatMap(\.items).map(\.id) == [.pin, .done, .rename, .move, .archive, .fork, .reference, .handOff, .takeOver, .grok])
    #expect(menu.flatMap(\.items).map(\.label).last == "Send to Grok Bot")
  }

  @Test func leavesGrokBotOutUntilItsWebhookIsSet() {
    var f = every
    f.grokBot = false
    #expect(engine.threadMenu(f).map(\.id) == ["organize", "continue"])
  }

  @Test func waitsForTheRowBeforeItsState() {
    let menu = engine.threadMenu(ThreadMenuFacts(stub: nil, archived: true, pinned: false, grokBot: false))
    #expect(menu.flatMap(\.items).map(\.label) == ["Rename thread", "Unarchive thread"])
  }

  @Test func turnsForkOffForARemoteHarness() throws {
    var f = every
    f.harness = "hermes"
    let fork = try #require(engine.threadMenu(f).flatMap(\.items).first { $0.id == .fork })
    #expect(fork.off?.contains("not on this Mac") == true)
  }
}
