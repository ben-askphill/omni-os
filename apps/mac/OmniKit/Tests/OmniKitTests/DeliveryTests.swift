import Foundation
import Testing
@testable import OmniKit

private func delivery(
  id: String = "d1", state: String = "started", attempt: Int = 1, at: String = "2026-01-05T09:00:00.000Z",
  source: String = "github_webhook", context: [String: String] = [:], expires: String? = nil
) throws -> TriggerDelivery {
  let object: [String: Any] = [
    "id": id, "automation": "a", "source": source, "source_id": "gh-1", "summary": "CI failure", "context": context,
    "state": state, "reason": NSNull(), "owner": NSNull(), "source_thread": NSNull(), "thread_id": NSNull(),
    "attempt": attempt, "created_at": at, "updated_at": at, "expires_at": expires ?? NSNull(),
  ]
  let data = try JSONSerialization.data(withJSONObject: object)
  return try decode(TriggerDelivery.self, String(decoding: data, as: UTF8.self))
}

@Suite struct DeliveryDetailTests {
  @Test func linksOnlyWebAddresses() {
    #expect(TriggerDelivery.webLink("https://github.com/acme/shop/actions/runs/9")?.absoluteString == "https://github.com/acme/shop/actions/runs/9")
    #expect(TriggerDelivery.webLink("http://localhost:4747/x") != nil)
    #expect(TriggerDelivery.webLink("HTTPS://Example.com/x") != nil)
    for text in ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hi", "ftp://x.com/a", "omni://t/1", "mailto:a@b.co",
                 "https://x.com/a b", " https://x.com", "https://", "https:///x", "not a url", "acme/shop", "", "fix-nav"] {
      #expect(TriggerDelivery.webLink(text) == nil, "\(text)")
    }
  }

  @Test func listsTheContextByKeyWithOnlyWebLinksAsLinks() throws {
    let d = try delivery(context: ["title": "Fix the nav", "run_url": "https://github.com/acme/shop/actions/runs/9", "sha": "abcdef012345", "note": "javascript:alert(1)"])
    #expect(d.contextFields.map(\.key) == ["note", "run_url", "sha", "title"])
    #expect(d.contextFields.map { $0.url != nil } == [false, true, false, false])
    #expect(d.contextFields.first { $0.key == "note" }?.value == "javascript:alert(1)", "shown as text")
    #expect(try delivery().contextFields.isEmpty)
  }

  @Test func namesTheSource() throws {
    #expect(try delivery(source: "artifact_published").sourceLabel == "Published page")
    #expect(try delivery(source: "github_webhook").sourceLabel == "GitHub webhook")
    #expect(try delivery(source: "slack").sourceLabel == "slack", "a source this app does not know shows as the server spells it")
  }

  /// `inTime` in apps/web/src/format.ts, from `now`.
  @Test func saysWhenItExpires() throws {
    let now = try #require(OmniJSON.parseDate("2026-01-05T09:00:00.000Z"))
    func label(after seconds: Double?) throws -> String? {
      let at = seconds.map { Self.iso(now.addingTimeInterval($0)) }
      return try delivery(expires: at).expiresLabel(now: now)
    }
    #expect(try label(after: nil) == nil)
    #expect(try label(after: -60) == "now")
    #expect(try label(after: 0) == "now")
    #expect(try label(after: 1) == "in 1m")
    #expect(try label(after: 12 * 60) == "in 12m")
    #expect(try label(after: 12 * 60 + 1) == "in 13m")
    #expect(try label(after: 59 * 60) == "in 59m")
    #expect(try label(after: 3 * 3600) == "in 3h")
    #expect(try label(after: 3 * 3600 + 29 * 60) == "in 3h")
    #expect(try label(after: 3 * 3600 + 31 * 60) == "in 4h")
    #expect(try label(after: 2 * 86_400) == "in 2d")
  }

  @Test func saysWhenItArrivedInTheGivenZone() throws {
    let d = try delivery(at: "2026-01-05T09:00:00.000Z")
    #expect(d.receivedLabel(timeZone: try #require(TimeZone(identifier: "Europe/Amsterdam"))) == "Mon 5 Jan, 10:00")
    #expect(d.receivedLabel(timeZone: try #require(TimeZone(identifier: "America/Toronto"))) == "Mon 5 Jan, 04:00")
  }

  private static func iso(_ date: Date) -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: date)
  }
}

@Suite struct DeliveryRankTests {
  @Test func ranksTheStatesLikeTheServer() {
    let ranks: [(TriggerDeliveryState, Int?)] = [(.received, 0), (.accepted, 1), (.queued, 1), (.failed, 2), (.skipped, 3), (.started, 4), ("rerouted", nil)]
    for (state, rank) in ranks { #expect(state.rank == rank, "\(state.rawValue)") }
    #expect(TriggerDeliveryState.received.isPending && TriggerDeliveryState.accepted.isPending && TriggerDeliveryState.queued.isPending)
    #expect(![TriggerDeliveryState.failed, .skipped, .started, "rerouted"].contains { $0.isPending })
  }

  @Test func aLaterAttemptBeatsEveryStateOfAnEarlierOne() throws {
    let started = try delivery(state: "started")
    let retried = try delivery(state: "accepted", attempt: 2)
    #expect(retried.isAhead(of: started))
    #expect(!started.isAhead(of: retried))
    #expect(try delivery(state: "started").isAhead(of: delivery(state: "skipped")), "started is a fact, so it beats a skip that raced it")
    #expect(try delivery(state: "skipped").isAhead(of: delivery(state: "failed")), "a skipped one is not offered a retry again")
    #expect(try !delivery(state: "failed").isAhead(of: delivery(state: "skipped")))
    #expect(try !delivery(state: "failed").isAhead(of: delivery(state: "failed")), "a tie is not ahead")
    #expect(try !delivery(state: "rerouted").isAhead(of: delivery(state: "started")), "a state it does not know never wins on rank")
    #expect(try !delivery(state: "started").isAhead(of: delivery(state: "rerouted")))
  }
}

@Suite struct DeliveryMergeTests {
  private func ids(_ rows: [TriggerDelivery]) -> [String] { rows.map(\.id) }

  @Test func putsNewRowsInNewestFirst() throws {
    let current = [try delivery(id: "d2", at: "2026-01-05T09:02:00.000Z"), try delivery(id: "d0", at: "2026-01-05T09:00:00.000Z")]
    let merged = TriggerDelivery.merge([try delivery(id: "d3", at: "2026-01-05T09:03:00.000Z"), try delivery(id: "d1", at: "2026-01-05T09:01:00.000Z")], into: current)
    #expect(ids(merged) == ["d3", "d2", "d1", "d0"])
  }

  @Test func keepsTheOrderOfRowsThatCameAtTheSameTime() throws {
    let at = "2026-01-05T09:00:00.000Z"
    let merged = TriggerDelivery.merge([try delivery(id: "b", at: at), try delivery(id: "a", at: at)], into: [try delivery(id: "c", at: at)])
    #expect(ids(merged) == ["c", "b", "a"])
    #expect(ids(TriggerDelivery.merge([try delivery(id: "c", at: at)], into: merged)) == ["c", "b", "a"])
  }

  @Test func neverTakesARowBack() throws {
    let started = try delivery(state: "started")
    #expect(try TriggerDelivery.merge([delivery(state: "failed")], into: [started])[0].state == .started, "a late copy loses")
    #expect(try TriggerDelivery.merge([delivery(state: "skipped")], into: [started])[0].state == .started)
    #expect(try TriggerDelivery.merge([delivery(state: "started")], into: [try delivery(state: "failed")])[0].state == .started)
    let retried = TriggerDelivery.merge([try delivery(state: "accepted", attempt: 2)], into: [try delivery(state: "failed")])
    #expect(retried.count == 1 && retried[0].attempt == 2 && retried[0].state == .accepted, "a retry beats the failure it came from")
    #expect(try TriggerDelivery.merge([delivery(state: "rerouted")], into: [started])[0].state == "rerouted", "the server's copy of a state the app does not know stands")
  }

  @Test func aCopyOfTheSameStateRefreshesTheRow() throws {
    let shown = try delivery(state: "accepted")
    let fresh = try delivery(state: "accepted", expires: "2026-01-05T21:00:00.000Z")
    #expect(TriggerDelivery.merge([fresh], into: [shown])[0].expiresAt != nil)
  }
}
