import Foundation
import Testing
import OmniKit

// The delegate count on a Conductor row, with the rules of @omni/shared/delegate-count.ts (tested by
// packages/shared/tests/delegate-count.test.ts): every delegated thread counts, and the state goes needs you, failed,
// working, settled.

private let at = Date(timeIntervalSince1970: 1_700_000_000)
private func kid(_ id: String, _ status: ThreadStatus, done: Bool = false) -> ThreadStub {
  ThreadStub(id: id, channelID: "omni", title: id, status: status, createdAt: at, doneAt: done ? at : nil, parentID: "p", source: .conductor)
}

@Suite struct DelegateCountTests {
  @Test func isNilForAThreadThatDelegatedNothing() {
    #expect(DelegateSummary.of([]) == nil)
  }

  @Test func countsFinishedThreadsAndSettlesOnceNoneIsActive() throws {
    let s = try #require(DelegateSummary.of([kid("a", .done), kid("b", .stopped)]) { _ in nil })
    #expect(s.total == 2 && s.active == 0 && s.state == .settled && !s.flagged)
    #expect(s.label == "2 delegated threads, 0 active")
  }

  @Test func worksWhileOneRunsOrQueues() throws {
    let s = try #require(DelegateSummary.of([kid("a", .running), kid("b", .queued), kid("c", .done)]) { _ in nil })
    #expect(s.total == 3 && s.active == 2 && s.state == .working)
    #expect(s.label == "3 delegated threads, 2 active")
  }

  @Test func putsNeedsYouOverFailedOverWorking() throws {
    let inbox: [String: DelegateSummary.Needs] = ["b": .init(blocked: false, failed: true), "c": .init(blocked: true, failed: false)]
    #expect(DelegateSummary.of([kid("a", .running), kid("b", .failed)]) { inbox[$0] }?.state == .failed)
    let s = try #require(DelegateSummary.of([kid("a", .running), kid("b", .failed), kid("c", .running)]) { inbox[$0] })
    #expect(s.state == .needs && s.flagged && s.needs == 1 && s.failed == 1 && s.active == 3)
    #expect(s.label == "3 delegated threads, 3 active, 1 needs you, 1 failed")
  }

  @Test func greysASeenFailureAndFallsBackWithoutAnInbox() {
    #expect(DelegateSummary.of([kid("a", .failed)]) { _ in nil }?.state == .settled)
    #expect(DelegateSummary.of([kid("a", .failed)])?.state == .failed)
    #expect(DelegateSummary.of([kid("a", .failed, done: true)])?.state == .settled)
    #expect(DelegateSummary.of([kid("a", .done, done: true)]) { _ in .init(blocked: true, failed: true) }?.state == .settled)
  }

  @Test func readsTheRecordedInbox() throws {
    let n = try decodeFixture(NeedsYou.self, "needs-you.json")
    let failed = try #require(n.items.first { $0.result?.status == .failed && $0.blockers.isEmpty })
    let blocked = try #require(n.items.first { !$0.blockers.isEmpty })
    let kids = [ThreadStub(failed.thread), ThreadStub(blocked.thread)]
    #expect(DelegateSummary.of([kids[0]], inbox: n)?.state == .failed)
    #expect(DelegateSummary.of(kids, inbox: n)?.state == .needs)
  }
}
