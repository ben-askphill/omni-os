import Foundation
import Testing
import OmniKit

private let base = Date(timeIntervalSince1970: 1_790_582_400)

private func iso(_ seconds: Double) -> String {
  ISO8601DateFormatter().string(from: base.addingTimeInterval(seconds))
}

private func listThread(_ id: String, title: String? = nil, channel: String = "acme", status: String = "done", updated: Double = 0) throws -> OmniThread {
  try decode(OmniThread.self, """
    {"id":"\(id)","channel_id":"\(channel)","title":"\(title ?? id)","status":"\(status)","role":null,"model":null,"harness":"claude-code",
     "effort":"","session_id":null,"has_run":0,"cwd":null,"branch":null,"parent_id":null,"task_id":null,"source":"manual",
     "automation":null,"last_text":null,"created_at":"\(iso(0))","updated_at":"\(iso(updated))"}
    """)
}

@Suite struct NavigationHistoryTests {
  @Test func backAndForwardWalkTheVisits() {
    var h = NavigationHistory()
    h.visit(.channel(id: "acme"))
    h.visit(.thread(id: "t1"))
    #expect(h.back() == .channel(id: "acme"))
    #expect(h.back() == .home)
    #expect(h.back() == nil)
    #expect(!h.canGoBack)
    #expect(h.forward() == .channel(id: "acme"))
    #expect(h.canGoForward)
  }

  @Test func visitingTheCurrentRouteAddsNothing() {
    var h = NavigationHistory()
    h.visit(.home)
    h.visit(.secrets)
    h.visit(.secrets)
    #expect(h.entries == [.home, .secrets])
  }

  @Test func visitingAfterBackDropsWhatWasAhead() {
    var h = NavigationHistory()
    h.visit(.secrets)
    h.visit(.artifacts)
    _ = h.back()
    h.visit(.automations)
    #expect(h.entries == [.home, .secrets, .automations])
    #expect(!h.canGoForward)
  }

  @Test func showingTheRouteBackGaveDoesNotAddAnEntry() {
    var h = NavigationHistory()
    h.visit(.secrets)
    let r = h.back()!
    h.visit(r)
    #expect(h.entries == [.home, .secrets] && h.index == 0)
  }

  @Test func keepsTheLatestHundred() {
    var h = NavigationHistory()
    for i in 0..<150 { h.visit(.thread(id: "t\(i)")) }
    #expect(h.entries.count == NavigationHistory.limit)
    #expect(h.current == .thread(id: "t149"))
    #expect(h.index == h.entries.count - 1)
  }
}

@Suite struct ThreadFilterTests {
  @Test func rulesFollowTheWebUI() {
    #expect(ThreadFilter.active.matches(.running) && ThreadFilter.active.matches(.queued))
    #expect(!ThreadFilter.active.matches(.done) && !ThreadFilter.active.matches(.failed))
    #expect(ThreadFilter.failed.matches(.failed) && ThreadFilter.failed.matches(.stopped))
    #expect(!ThreadFilter.failed.matches(.running) && !ThreadFilter.failed.matches(.imported))
    #expect(ThreadFilter.all.matches(.imported))
  }

  @Test func filtersKeepOrder() throws {
    let list = [try listThread("a", status: "failed"), try listThread("b", status: "running"), try listThread("c", status: "stopped"), try listThread("d")]
    #expect(ThreadFilter.failed.apply(to: list).map(\.id) == ["a", "c"])
    #expect(ThreadFilter.active.apply(to: list).map(\.id) == ["b"])
    #expect(ThreadFilter.all.apply(to: list).count == 4)
  }

  @Test func groupsByDayLikeTheWebUI() throws {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(secondsFromGMT: 0)!
    let now = cal.date(from: DateComponents(year: 2026, month: 9, day: 28, hour: 15))!
    let ago = { (h: Double) in now.timeIntervalSince(base) - h * 3600 }
    let list = [try listThread("a", updated: ago(1)), try listThread("b", updated: ago(2)), try listThread("c", updated: ago(20)), try listThread("d", updated: ago(24 * 3)), try listThread("e", updated: ago(24 * 20))]
    let groups = ThreadListing.byDay(list, now: now, calendar: cal)
    #expect(groups.map(\.label) == ["Today", "Yesterday", "Friday", "Tue 8 Sept"])
    #expect(groups.map(\.threads.count) == [2, 1, 1, 1])
  }

  @Test func liveCopiesJoinAndReplaceALoadedList() throws {
    let loaded = [try listThread("a", updated: 30), try listThread("b", updated: 20)]
    let live = [
      try listThread("b", status: "failed", updated: 40), try listThread("a", status: "failed", updated: 10),
      try listThread("n", updated: 50), try listThread("other", channel: "elsewhere", updated: 60),
    ]
    let merged = ThreadListing.merging(loaded: loaded, live: live, channel: "acme")
    #expect(merged.map(\.id) == ["n", "b", "a"])
    #expect(merged.first { $0.id == "b" }?.status == .failed)
    #expect(merged.first { $0.id == "a" }?.status == .done)
  }
}

@Suite struct PaletteTests {
  private func items(_ q: String, recent: [OmniThread] = []) throws -> [PaletteItem] {
    let channels = try channelList(
      channelRow("conductor", kind: "system", running: 1), channelRow("acme", running: 2), channelRow("acme-store"), channelRow("volero"))
    return Palette.items(query: q, channels: channels, recent: recent, now: base)
  }

  @Test func emptyQueryIsShort() throws {
    let recent = try (0..<10).map { try listThread("t\($0)", updated: Double(-$0)) }
    let list = try items("", recent: recent)
    #expect(list.filter { $0.group == .recent }.count == 6)
    #expect(list.first?.action == .newThread)
    #expect(!list.contains { $0.group == .search })
    #expect(list.first { $0.id == "c:acme" }?.trailing == "2 running")
  }

  @Test func searchRowLeadsAnyQuery() throws {
    let list = try items("zzz")
    #expect(list.map(\.group) == [.search])
    #expect(list.first?.action == .search("zzz"))
  }

  @Test func prefixBeatsLaterWordBeatsContains() throws {
    let recent = [try listThread("1", title: "Fix checkout bug"), try listThread("2", title: "Checkout copy"), try listThread("3", title: "Recheckout flow")]
    let list = try items("checkout", recent: recent).filter { $0.group == .recent }
    #expect(list.map(\.id) == ["t:2", "t:1", "t:3"])
  }

  @Test func everyWordMustMatchTitleOrSub() throws {
    let recent = [try listThread("1", title: "Fix checkout", channel: "acme"), try listThread("2", title: "Fix checkout", channel: "volero")]
    let list = try items("fix volero", recent: recent).filter { $0.group == .recent }
    #expect(list.map(\.id) == ["t:2"])
  }

  @Test func lettersInOrderFindAFuzzyMatch() throws {
    let recent = [try listThread("1", title: "Thread cleanup")]
    #expect(try items("thrdcln", recent: recent).contains { $0.id == "t:1" })
    #expect(try !items("xq", recent: recent).contains { $0.id == "t:1" })
  }

  @Test func channelsMatchByNameWithoutTheHash() throws {
    let list = try items("acme").filter { $0.group == .channels }
    #expect(list.map(\.id) == ["c:acme", "c:acme-store"])
  }

  @Test func groupsKeepTheirOrder() throws {
    let list = try items("a", recent: [try listThread("1", title: "Alpha")])
    let groups = list.map(\.group)
    #expect(groups == groups.sorted { $0.rawValue < $1.rawValue })
  }
}

@Suite struct SnippetTests {
  @Test func splitsOnMarks() {
    #expect(Snippet.runs("fix the <mark>check</mark>out bug") == [
      SnippetRun(text: "fix the ", marked: false), SnippetRun(text: "check", marked: true), SnippetRun(text: "out bug", marked: false),
    ])
  }

  @Test func otherAngleBracketsStayText() {
    #expect(Snippet.runs("a <div> and 1 < 2 <mark>x</mark>") == [
      SnippetRun(text: "a <div> and 1 < 2 ", marked: false), SnippetRun(text: "x", marked: true),
    ])
  }

  @Test func anOpenMarkRunsToTheEndAndAStrayCloseIsDropped() {
    #expect(Snippet.runs("a <mark>b c") == [SnippetRun(text: "a ", marked: false), SnippetRun(text: "b c", marked: true)])
    #expect(Snippet.runs("a</mark> b") == [SnippetRun(text: "a b", marked: false)])
  }

  @Test func emptyAndEllipsisSnippets() {
    #expect(Snippet.runs("").isEmpty)
    #expect(Snippet.runs(" … <mark>a</mark> … ").map(\.marked) == [false, true, false])
  }

  @Test func decodesAHit() throws {
    let hit = try decode(SearchHit.self, """
      {"thread_id":"t1","title":"Cart","channel_id":"acme","status":"done","updated_at":"\(iso(0))","snippet":"<mark>cart</mark> bug"}
      """)
    #expect(hit.id == "t1" && hit.status == .done)
    #expect(Snippet.runs(hit.snippet).first?.marked == true)
  }
}

@Suite struct UsageMeterTests {
  private func meter(_ u: Double) -> UsageMeter { UsageMeter(UsageWindow(utilization: u, resetsAt: base)) }

  @Test func thresholdsMatchTheWebUI() {
    #expect(meter(0.69).tone == .normal)
    #expect(meter(0.7).tone == .warn)
    #expect(meter(0.89).tone == .warn)
    #expect(meter(0.9).tone == .bad)
  }

  @Test func percentagesAboveOnePointFiveAreDivided() {
    #expect(meter(42).percent == 42)
    #expect(meter(1.5).percent == 100)
    #expect(meter(0.425).percent == 43)
    #expect(meter(-3).percent == 0)
    #expect(meter(250).percent == 100)
  }

  @Test func resetLabels() {
    func label(_ s: Double) -> String { UsageMeter(UsageWindow(utilization: 0.1, resetsAt: base.addingTimeInterval(s))).resetLabel(now: base) }
    #expect(label(-5) == "now")
    #expect(label(20) == "in 1m")
    #expect(label(300) == "in 5m")
    #expect(label(7500) == "in 2h 5m")
  }

  @Test func rowsListEveryHarnessAndFlagNoData() throws {
    let usage = try decode([HarnessID: Usage].self, #"{"claude-code":{"five_hour":{"utilization":0.5,"resetsAt":1790600000}}}"#)
    let rows = HarnessUsageRow.rows(usage: usage, slots: [.claudeCode: HarnessSlot(running: 1, cap: 4)])
    #expect(rows.map(\.name) == ["Claude", "Codex", "Cursor", "Hermes"])
    #expect(rows.map(\.hasData) == [true, false, false, false])
    #expect(rows[0].slot?.cap == 4 && rows[0].week == nil)
  }
}
