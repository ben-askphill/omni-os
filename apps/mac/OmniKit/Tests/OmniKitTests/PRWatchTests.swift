import Foundation
import Testing
import OmniKit

// The cases of watchLine in packages/shared/pr-watch.ts, and how a PR watch's wake shows in the thread.

private func watch(state: String = "watching", stop: String? = nil, error: String? = nil, checks: String? = nil) throws -> PRWatch {
  let q = { (s: String?) in s.map { "\"\($0)\"" } ?? "null" }
  return try decode(PRWatch.self, """
    {"thread_id":"t1","repo":"acme/shop","number":7,"state":"\(state)","stop_reason":\(q(stop)),"head_sha":null,
     "checks":\(checks ?? "null"),"wakes":0,"max_wakes":5,"last_wake_at":null,"last_polled_at":null,"next_poll_at":null,
     "error":\(q(error)),"created_at":"2026-01-05T09:00:00.000Z","updated_at":"2026-01-05T09:00:00.000Z"}
    """)
}

@Suite struct PRWatchTests {
  @Test func readsAWatchingView() throws {
    let w = try decodeFixture(PRWatch.self, "pr-watch.json")
    #expect(w.repo == "acme/shop" && w.number == 7)
    #expect(w.isWatching && w.stopReason == nil)
    #expect(w.checks.map { [$0.passed, $0.failed, $0.pending] } == [1, 0, 1])
    #expect(w.wakes == 0 && w.maxWakes == 5)
    #expect(w.headSHA?.count == 40 && w.lastPolledAt != nil && w.nextPollAt != nil)
    #expect(w.watchLine == "Watching checks: 1 running")
  }

  @Test func readsAStoppedViewAndNone() throws {
    let w = try decodeFixture(PRWatch.self, "pr-watch-stopped.json")
    #expect(!w.isWatching && w.stopReason == .stopped && w.nextPollAt == nil)
    #expect(w.watchLine == "Watch stopped")
    #expect(try decodeFixture(PRWatch?.self, "pr-watch-none.json") == nil)
  }

  @Test(arguments: [
    (nil, "Watch stopped"),
    ("stopped", "Watch stopped"),
    ("archived", "Watch stopped: thread archived"),
    ("merged", "Watch ended: PR merged"),
    ("closed", "Watch ended: PR closed"),
    ("wake_limit", "Watch stopped after its wake limit"),
    ("error_limit", "Watch stopped: GitHub kept failing"),
  ] as [(String?, String)])
  func saysWhyItStopped(_ reason: String?, _ want: String) throws {
    #expect(try watch(state: "stopped", stop: reason, error: "gh failed").watchLine == want)
  }

  @Test(arguments: [
    (nil, nil, "Watching checks"),
    ("gh failed", #"{"passed":0,"failed":2,"pending":0}"#, "Watching checks, retrying GitHub"),
    (nil, #"{"passed":1,"failed":2,"pending":3}"#, "Watching checks: 2 failing"),
    (nil, #"{"passed":1,"failed":0,"pending":3}"#, "Watching checks: 3 running"),
    (nil, #"{"passed":4,"failed":0,"pending":0}"#, "Watching checks: all passed"),
    (nil, #"{"passed":0,"failed":0,"pending":0}"#, "Watching checks"),
  ] as [(String?, String?, String)])
  func saysWhatItSees(_ error: String?, _ checks: String?, _ want: String) throws {
    #expect(try watch(error: error, checks: checks).watchLine == want)
  }

  @Test func theToggleSaysWhatItDoes() throws {
    #expect(PRWatch.copy(nil) == ("Watch checks", "Wakes this thread when a check fails"))
    #expect(PRWatch.copy(try watch()) == ("Stop watching", "Watching checks"))
    #expect(PRWatch.copy(try watch(state: "stopped", stop: "merged")) == ("Watch checks", "Watch ended: PR merged"))
  }

  @Test func getsStartsAndStops() async throws {
    let t = StubTransport { req in
      .init(body: req.httpMethod == "PUT" ? try fixture("pr-watch.json") : req.httpMethod == "DELETE" ? try fixture("pr-watch-stopped.json") : "null")
    }
    let client = OmniClient(port: 4799, transport: t)
    #expect(try await client.prWatch(forThread: "a b") == nil)
    #expect(try await client.startPRWatch(forThread: "a b").isWatching)
    #expect(try await client.stopPRWatch(forThread: "a b")?.isWatching == false)
    #expect(t.requests.map { "\($0.httpMethod ?? "") \($0.url?.absoluteString ?? "")" } == [
      "GET http://127.0.0.1:4799/api/threads/a%20b/pr-watch",
      "PUT http://127.0.0.1:4799/api/threads/a%20b/pr-watch",
      "DELETE http://127.0.0.1:4799/api/threads/a%20b/pr-watch",
    ])
    #expect(try bodyJSON(t.requests[1]) == .object([:]))
  }

  @Test func aRefusedStartThrowsTheReason() async {
    let t = StubTransport(status: 409, body: #"{"error":"This thread has no open PR to watch."}"#)
    await #expect(throws: OmniAPIError.http(status: 409, message: "This thread has no open PR to watch.")) {
      try await OmniClient(port: 4799, transport: t).startPRWatch(forThread: "t1")
    }
  }

  @Test func aWakeIsOmnisAndWaitsForResume() throws {
    #expect(try decode(UserMessage.self, #"{"text":"x","source":"pr-watch"}"#).sourceLabel == "PR watch")
    let held = try decode(PendingMsg.self, #"{"uuid":"p1","kind":"user","text":"x","source":"pr-watch","mode":"queue","state":"held","delivery":"recovered"}"#)
    #expect(held.isOmnis)
    #expect(held.label(lead: false) == "PR watch, held for Resume")
    let queued = try decode(PendingMsg.self, #"{"uuid":"p1","kind":"user","text":"x","source":"pr-watch","mode":"queue","state":"held"}"#)
    #expect(queued.label(lead: false) == "Queued, runs after this turn")
    #expect(ParkedMessages.heading([held]) == "1 message is waiting for Resume")
    #expect(ParkedMessages.heading([held, held]) == "2 messages are waiting for Resume")
  }
}
