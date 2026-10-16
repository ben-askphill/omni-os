import Foundation
import Testing
import OmniKit

// Needs you: the recorded inbox (tests/mac-fixtures.test.ts) decoded and read with the Web UI's rules
// (web/src/needs-you.ts, checked against the same fixtures by tests/web-needs-you.test.ts), and the workspace store's
// reads against a fake server: the result shown is read, a later one stays unread.

private func inbox() throws -> NeedsYou { try decodeFixture(NeedsYou.self, "needs-you.json") }

private func item(_ n: NeedsYou, _ title: String) throws -> NeedsYouItem {
  try #require(n.items.first { $0.thread.title == title }, "no \(title)")
}

/// The inbox with the item's result replaced by a newer one, as the server lists it once another turn ended.
private func withNewer(_ n: NeedsYou, _ title: String, uid: String) -> NeedsYou {
  NeedsYou(items: n.items.map { i in
    guard i.thread.title == title, let r = i.result else { return i }
    var newer = i
    newer.result = NeedsYouResult(uid: uid, status: .done, at: r.at.addingTimeInterval(60))
    return newer
  })
}

@Suite struct NeedsYouTests {
  @Test func readsEveryKindOfResultAndBlocker() throws {
    let n = try inbox()
    #expect(Set(n.items.compactMap { $0.result?.status }) == [.done, .failed, .stopped])
    #expect(Set(n.items.flatMap { $0.blockers.map(\.kind) }) == [.setup, .recovered, .limited])
    #expect(n.unread == n.items.filter { $0.result != nil }.count)
    #expect(n.blocked == n.items.filter { !$0.blockers.isEmpty }.count)
    #expect(NeedsYou(items: n.items) == n, "the counts the server sent are the ones the app works out")
    let widget = try item(n, "Fix the widget")
    #expect(widget.blockers.map(\.kind) == [.setup, .recovered])
    #expect(widget.thread.setup == .failed)
  }

  @Test func saysWhyEachThreadIsThere() throws {
    let n = try inbox()
    let widget = try item(n, "Fix the widget").reason
    #expect(widget.tone == .needs)
    #expect(widget.label == "Worktree could not be prepared")
    #expect(widget.detail == (try item(n, "Fix the widget")).thread.setupError)
    #expect(try item(n, "Plan the launch").reason.label == "A message waits for Resume")
    #expect(try item(n, "Fix the cart total").reason.label == "Failed")
    #expect(try item(n, "Fix the cart total").reason.tone == .needs)
    #expect(try item(n, "Audit the checkout").reason.label == "Finished")
    #expect(try item(n, "Audit the checkout").reason.tone == .done)

    let base = try item(n, "Plan the launch")
    let two = NeedsYouItem(thread: base.thread, result: nil, blockers: [NeedsYouBlocker(kind: .uncertain, count: 2)], at: base.at)
    #expect(two.reason.label == "2 messages may not have been sent")
    let stopped = NeedsYouItem(thread: base.thread, result: NeedsYouResult(uid: "u", status: .stopped, at: base.at), blockers: [], at: base.at)
    #expect(stopped.reason.tone == .settled)
    #expect(stopped.reason.label == "Stopped")

    // A turn stopped at the usage limit, scheduled to resume at the reset.
    let capped = try item(n, "Tidy the copy")
    #expect(capped.blockers.first?.kind == .limited)
    #expect(capped.blockers.first?.scheduled == true)
    #expect(capped.blockers.first?.resetsAt != nil)
    #expect(capped.reason.tone == .needs)
    #expect(capped.reason.label == "Usage limit reached")
    #expect(capped.reason.detail?.hasPrefix("Resumes at ") == true)
    let noTime = NeedsYouItem(thread: base.thread, result: nil, blockers: [NeedsYouBlocker(kind: .limited)], at: base.at)
    #expect(noTime.reason.detail == "No reset time given")
    let notScheduled = NeedsYouItem(thread: base.thread, result: nil, blockers: [NeedsYouBlocker(kind: .limited, resetsAt: base.at)], at: base.at)
    #expect(notScheduled.reason.detail?.hasPrefix("Resets at ") == true)
    #expect(capped.blockers.first?.elsewhere == false)
    // The other Mac's stop, as sync leaves it here: the same reset, and where it is.
    let otherMac = NeedsYouItem(
      thread: base.thread, result: nil, blockers: [NeedsYouBlocker(kind: .limited, resetsAt: base.at, elsewhere: true)], at: base.at)
    #expect(otherMac.reason.label == "Usage limit reached on your other Mac")
    #expect(otherMac.reason.detail?.hasPrefix("Resets at ") == true)
  }

  @Test func scopesToAChannel() throws {
    let n = try inbox()
    let acme = n.inChannel("acme")
    #expect(acme.items.allSatisfy { $0.thread.channelID == "acme" })
    #expect(acme.unread + n.inChannel("widgets").unread == n.unread)
    #expect(n.inChannel("nowhere") == .empty)
  }

  @Test func readsOnlyAResultTheThreadShows() throws {
    let n = try inbox()
    let t = try item(n, "Audit the checkout")
    #expect(n.shownResult(threadID: t.id, status: .done) == t.result?.uid)
    #expect(n.shownResult(threadID: t.id, status: .running) == nil)
    #expect(n.shownResult(threadID: t.id, status: .queued) == nil)
    #expect(n.shownResult(threadID: t.id, status: nil) == nil)
    let answer = try decodeFixture(NeedsYouRead.self, "needs-you-read.json")
    let only = try #require(answer.item)
    #expect(answer.threadID == only.thread.id)
    #expect(NeedsYou(items: [only]).shownResult(threadID: only.id, status: .stopped) == nil, "a blocker alone has no result")
  }

  @Test func dropsAReadResultAndKeepsBlockers() throws {
    let n = try inbox()
    let done = try item(n, "Audit the checkout")
    let after = n.withoutResult(try #require(done.result?.uid))
    #expect(!after.items.contains { $0.id == done.id })
    #expect(after.unread == n.unread - 1)
    #expect(after.withoutResult(try #require(done.result?.uid)) == after, "a repeated visit changes nothing")
    let widget = try item(n, "Fix the widget")
    let kept = try item(n.withoutResult(try #require(widget.result?.uid)), "Fix the widget")
    #expect(kept.result == nil)
    #expect(kept.blockers.map(\.kind) == [.setup, .recovered])
    // A read of an older result leaves a newer one listed.
    let newer = withNewer(n, "Audit the checkout", uid: "newer")
    #expect(try item(newer.withoutResult(try #require(done.result?.uid)), "Audit the checkout").result?.uid == "newer")
  }

  @Test func encodesTheReadAsTheFixture() throws {
    let body = try JSONSerialization.jsonObject(with: try OmniJSON.encoder().encode(["uid": "x"])) as? [String: String]
    let recorded = try decodeFixture([String: String].self, "needs-you-read-request.json")
    #expect(Set(try #require(body).keys) == Set(recorded.keys))
  }

  @Test func readsTheFeedEvent() throws {
    let e = try decode(FeedEvent.self, #"{"type":"needs_you","thread_id":"t1"}"#)
    #expect(e == .needsYou(threadID: "t1"))
  }
}

@MainActor
private func store(_ api: FakeWorkspaceAPI) -> (WorkspaceStore, AsyncStream<SSEEvent<FeedEvent>>.Continuation, TestClock) {
  let clock = TestClock()
  let (events, feed) = AsyncStream<SSEEvent<FeedEvent>>.makeStream()
  let store = WorkspaceStore(api: api, feed: events, clock: clock)
  store.start()
  return (store, feed, clock)
}

@MainActor @Suite struct NeedsYouStoreTests {
  @Test func loadsOnStartAndOnTheFeed() async throws {
    let api = try FakeWorkspaceAPI.standard()
    api.needsYouAnswer = try inbox()
    let (s, feed, clock) = store(api)
    defer { s.stop(); feed.finish() }
    try await waitFor("the inbox") { s.needsYou == api.needsYouAnswer }

    // Read on the other client: the feed says so and the inbox loads at once.
    let done = try item(api.needsYouAnswer, "Audit the checkout")
    api.needsYouAnswer = api.needsYouAnswer.withoutResult(try #require(done.result?.uid))
    feed.yield(.message(.needsYou(threadID: done.id)))
    try await waitFor("the read from elsewhere") { s.needsYou == api.needsYouAnswer }

    // A turn ends: the inbox loads with the counts, after the burst.
    let calls = api.calls("needsYou")
    api.needsYouAnswer = try inbox()
    feed.yield(.message(.thread(done.thread)))
    await settle()
    #expect(api.calls("needsYou") == calls)
    clock.advance(by: .milliseconds(500))
    try await waitFor("the inbox after the burst") { s.needsYou == api.needsYouAnswer }
  }

  @Test func aBurstFromSyncLoadsTwice() async throws {
    let api = try FakeWorkspaceAPI.standard()
    api.needsYouAnswer = try inbox()
    let (s, feed, _) = store(api)
    defer { s.stop(); feed.finish() }
    try await waitFor("the inbox") { s.needsYou != nil }
    let calls = api.calls("needsYou")
    var seen = 0
    s.onFeed = { _ in seen += 1 }

    // The other Mac's reads land in one sync, an event each, while the first load is out.
    let gate = api.holdNextNeedsYou()
    let done = try item(api.needsYouAnswer, "Audit the checkout")
    feed.yield(.message(.needsYou(threadID: done.id)))
    try await waitFor("the first load") { api.calls("needsYou") == calls + 1 }
    for _ in 0..<20 { feed.yield(.message(.needsYou(threadID: done.id))) }
    try await waitFor("every event") { seen == 21 }
    await settle()
    #expect(api.calls("needsYou") == calls + 1)
    api.needsYouAnswer = api.needsYouAnswer.withoutResult(try #require(done.result?.uid))
    gate.open()
    try await waitFor("one more load, with the reads") { api.calls("needsYou") >= calls + 2 && s.needsYou == api.needsYouAnswer }
    await settle()
    #expect(api.calls("needsYou") == calls + 2)

    // Quiet again: the next event loads at once.
    feed.yield(.message(.needsYou(threadID: done.id)))
    try await waitFor("the next event's load") { api.calls("needsYou") >= calls + 3 }
  }

  @Test func readsTheShownResultAndKeepsALaterOneUnread() async throws {
    let api = try FakeWorkspaceAPI.standard()
    api.needsYouAnswer = try inbox()
    let (s, feed, _) = store(api)
    defer { s.stop(); feed.finish() }
    try await waitFor("the inbox") { s.needsYou != nil }
    let shown = try #require(try item(api.needsYouAnswer, "Audit the checkout").result?.uid)
    let unread = api.needsYouAnswer.unread

    // The read is out when another turn of the same thread ends.
    let gate = api.holdNextRead()
    let reading = Task { await s.readResult(shown) }
    try await waitFor("gone at once") { s.needsYou?.items.contains { $0.thread.title == "Audit the checkout" } == false }
    #expect(s.needsYou?.unread == unread - 1)
    api.needsYouAnswer = withNewer(api.needsYouAnswer, "Audit the checkout", uid: "newer")
    gate.open()
    await reading.value
    #expect(api.reads == [shown])
    #expect(try item(try #require(s.needsYou), "Audit the checkout").result?.uid == "newer")
    #expect(s.needsYou?.unread == unread)
    #expect(s.needsYou?.shownResult(threadID: try item(api.needsYouAnswer, "Audit the checkout").id, status: .done) == "newer")
  }

  @Test func takesRepeatedVisits() async throws {
    let api = try FakeWorkspaceAPI.standard()
    api.needsYouAnswer = try inbox()
    let (s, feed, _) = store(api)
    defer { s.stop(); feed.finish() }
    try await waitFor("the inbox") { s.needsYou != nil }
    let uid = try #require(try item(api.needsYouAnswer, "Fix the cart total").result?.uid)
    await s.readResult(uid)
    let once = s.needsYou
    await s.readResult(uid)
    #expect(s.needsYou == once)
    #expect(api.reads == [uid, uid])
    #expect(once?.unread == (try inbox()).unread - 1)
  }
}
