import Foundation
import Synchronization
import Testing
@testable import OmniKit

private func usage(_ used: Double, _ max: Double?, at seconds: Double = 0, source: String = "claude-cli") -> ContextUsage {
  ContextUsage(used: used, max: max, source: source, updatedAt: Date(timeIntervalSince1970: seconds))
}

@Suite struct ContextMeterMathTests {
  @Test func percentIsTheShareOfTheWindow() {
    #expect(ContextMeter.percent(used: 50_000, max: 200_000) == 25)
    #expect(ContextMeter.percent(used: 250_000, max: 200_000) == 100)
    #expect(ContextMeter.percent(used: -5, max: 200_000) == 0)
    #expect(ContextMeter.percent(used: 1000, max: nil) == nil)
    #expect(ContextMeter.percent(used: 1000, max: 0) == nil)
    #expect(ContextMeter.percent(used: .nan, max: 200_000) == nil)
  }

  @Test func turnsWarnAt70AndCriticalAt90() {
    #expect(ContextMeter.level(nil) == .ok)
    #expect(ContextMeter.level(69.9) == .ok)
    #expect(ContextMeter.level(70) == .warn)
    #expect(ContextMeter.level(89.9) == .warn)
    #expect(ContextMeter.level(90) == .critical)
  }

  @Test func formatsTokensAsTheWebUIDoes() {
    #expect(ContextMeter.formatTokens(950) == "950")
    #expect(ContextMeter.formatTokens(12_400) == "12.4K")
    #expect(ContextMeter.formatTokens(12_000) == "12K")
    #expect(ContextMeter.formatTokens(200_000) == "200K")
    #expect(ContextMeter.formatTokens(167_499) == "167K")
    #expect(ContextMeter.formatTokens(1_000_000) == "1M")
    #expect(ContextMeter.formatTokens(1_250_000) == "1.25M")
    #expect(usage(62_400, 270_000).summary == "62.4K / 270K tokens (23%)")
    #expect(usage(62_400, nil).summary == "62.4K tokens")
  }

  @Test func theStreamWinsATie() {
    let server = usage(1, 10, at: 5), pushed = usage(2, 10, at: 5), older = usage(3, 10, at: 4)
    #expect(ContextMeter.newest(server, pushed) == pushed)
    #expect(ContextMeter.newest(server, older) == server)
    #expect(ContextMeter.newest(nil, older) == older)
    #expect(ContextMeter.newest(server, nil) == server)
  }

  @Test func shortensToolsAndPaths() {
    #expect(ContextMeter.shortTool("mcp__claude_ai_Google_Drive__search") == "Google Drive: search")
    #expect(ContextMeter.shortTool("Bash") == "Bash")
    #expect(ContextMeter.shortPath("/repo/web/a.ts", cwd: "/repo/") == "web/a.ts")
    #expect(ContextMeter.shortPath("/Users/ben/x/y.md", cwd: "/repo") == "~/x/y.md")
    #expect(ContextMeter.shortPath("/etc/hosts", cwd: nil) == "/etc/hosts")
  }

  @Test func readsTheServersView() throws {
    let v = try decode(ContextView.self, #"""
      {"context":{"used":150000,"max":200000,"autoCompactAt":167000,"model":"claude-opus-5-5","source":"claude-cli",
        "categories":[{"name":"System prompt","tokens":3000,"kind":"used"},{"name":"Messages","tokens":0,"kind":"used"},
          {"name":"Free space","tokens":40000,"kind":"free"}],
        "tools":[{"name":"Read","callTokens":10,"resultTokens":90},{"name":"Bash","callTokens":400,"resultTokens":9000}],
        "memoryFiles":[{"path":"/repo/CLAUDE.md","tokens":900}],"updated_at":"2026-10-10T08:00:00.000Z"},
       "largest":[{"tool":"Read","label":"/repo/big.ts","tokens":2000}],
       "compact":{"ok":false,"reason":"Wait for the current turn to finish.","focus":true}}
      """#)
    let c = try #require(v.context)
    #expect(c.level == .warn)
    #expect(c.usedCategories.map(\.name) == ["System prompt"])
    #expect(c.roomCategories.map(\.name) == ["Free space"])
    #expect(c.topTools.map(\.name) == ["Bash", "Read"])
    #expect(c.memoryFiles?.first?.path == "/repo/CLAUDE.md")
    #expect(v.largest.first?.label == "/repo/big.ts")
    #expect(v.compact == .init(ok: false, reason: "Wait for the current turn to finish.", focus: true))
    let none = try decode(ContextView.self, #"{"context":null,"largest":[],"compact":{"ok":false,"reason":"Cursor Agent has no compact command.","focus":false}}"#)
    #expect(none.context == nil)
  }
}

private final class FakeContextAPI: ContextAPI {
  struct State {
    var view: ContextView?
    var compact: Result<Void, OmniAPIError> = .success(())
    var reads: [Bool] = []
    var focuses: [String?] = []
  }
  let state = Mutex(State())

  func threadContext(_ id: String, refresh: Bool) async throws(OmniAPIError) -> ContextView {
    try state.withLock { s throws(OmniAPIError) in
      s.reads.append(refresh)
      guard let v = s.view else { throw .unreachable("down") }
      return v
    }
  }

  func compactThread(_ id: String, focus: String?) async throws(OmniAPIError) -> OmniThread {
    try state.withLock { s throws(OmniAPIError) in
      s.focuses.append(focus)
      try s.compact.get()
    }
    return try! decode(OmniThread.self, threadJSON())
  }
}

private func view(ok: Bool = true, focus: Bool = true, used: Double = 100) throws -> ContextView {
  try decode(ContextView.self, #"""
    {"context":{"used":\#(used),"max":1000,"source":"claude-cli","updated_at":"2026-10-10T08:00:00.000Z"},"largest":[],
     "compact":{"ok":\#(ok),\#(ok ? "" : #""reason":"Nothing to compact yet.","#)"focus":\#(focus)}}
    """#)
}

@MainActor @Suite struct ContextModelTests {
  @Test func loadsAndKeepsTheLastViewOnAFailure() async throws {
    let api = FakeContextAPI()
    let m = ContextModel(threadID: "t1", api: api)
    #expect(m.compactBlocked(busy: false) == "Loading")
    api.state.withLock { $0.view = try! view() }
    await m.load(refresh: true)
    #expect(m.view?.context?.used == 100)
    #expect(!m.refreshing)
    api.state.withLock { $0.view = nil }
    await m.load()
    #expect(m.view?.context?.used == 100, "a failed load keeps what was there")
    #expect(api.state.withLock { $0.reads } == [true, false])
    #expect(m.context(pushed: usage(500, 1000, at: 2_000_000_000))?.used == 500, "a newer push wins")
  }

  @Test func saysWhyCompactIsOff() async throws {
    let api = FakeContextAPI()
    let m = ContextModel(threadID: "t1", api: api)
    api.state.withLock { $0.view = try! view(ok: false) }
    await m.load()
    #expect(m.compactBlocked(busy: false) == "Nothing to compact yet.")
    #expect(m.compactBlocked(busy: true) == "Wait for the current turn to finish.")
  }

  @Test func compactsWithAFocusOnlyWhereTheHarnessTakesOne() async throws {
    let api = FakeContextAPI()
    let m = ContextModel(threadID: "t1", api: api)
    api.state.withLock { $0.view = try! view() }
    await m.load()
    #expect(m.compactBlocked(busy: false) == nil)
    #expect(await m.compact(focus: "  the failing test \n") != nil)
    #expect(m.compacting)
    await m.compact(focus: "   ")
    api.state.withLock { $0.view = try! view(focus: false) }
    await m.turnEnded()
    #expect(!m.compacting)
    await m.compact(focus: "ignored")
    #expect(api.state.withLock { $0.focuses } == ["the failing test", nil, nil])
  }

  @Test func keepsTheErrorWhenCompactFails() async throws {
    let api = FakeContextAPI()
    let m = ContextModel(threadID: "t1", api: api)
    api.state.withLock { $0.view = try! view(); $0.compact = .failure(.http(status: 409, message: "Wait for the current turn to finish.")) }
    await m.load()
    #expect(await m.compact(focus: "") == nil)
    #expect(m.error?.message == "Wait for the current turn to finish.")
    #expect(!m.compacting)
    #expect(!m.sending)
  }
}
