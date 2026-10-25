import Foundation
import Testing
@testable import OmniKit

// packages/test-fixtures/delivery-stages.json is shared with packages/shared/tests/automation-triggers.test.ts, so the two ports cannot drift.
private let repoRoot = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

private struct StageCase: Decodable {
  struct Input: Decodable {
    let state: String
    let reason: String?
    let thread_id: String?
    let thread_status: String?
    let waiting: String?
  }
  struct Expected: Decodable {
    let name: String
    let label: String
    let tone: String
    let note: String?
  }
  let `case`: String
  let input: Input
  let expected: [Expected]
}

private func orNull(_ s: String?) -> Any {
  if let s { return s }
  return NSNull()
}

/// A real delivery decoded from JSON, so the test goes through the same path as the server's reply. The fields a case
/// does not give are fixed.
private func delivery(
  state: String, reason: String? = nil, threadID: String? = nil, threadStatus: String? = nil, waiting: String? = nil
) throws -> TriggerDelivery {
  let object: [String: Any] = [
    "id": "d1",
    "automation": "a",
    "source": "github_webhook",
    "source_id": "gh-1",
    "summary": "CI failure on fix-cart",
    "context": [String: String](),
    "state": state,
    "reason": orNull(reason),
    "owner": NSNull(),
    "source_thread": NSNull(),
    "thread_id": orNull(threadID),
    "attempt": 1,
    "created_at": "2026-01-05T09:00:00.000Z",
    "updated_at": "2026-01-05T09:00:00.000Z",
    "thread_status": orNull(threadStatus),
    "expires_at": NSNull(),
    "waiting": orNull(waiting),
    "can_skip": false,
    "can_retry": false,
    "retry_blocked": NSNull(),
  ]
  let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
  return try decode(TriggerDelivery.self, String(decoding: data, as: UTF8.self))
}

@Suite struct DeliveryStagesTests {
  @Test func matchesTheSharedStages() throws {
    let url = repoRoot.appending(path: "packages/test-fixtures/delivery-stages.json")
    let cases = try JSONDecoder().decode([StageCase].self, from: Data(contentsOf: url))
    #expect(cases.count >= 12)
    for c in cases {
      let d = try delivery(
        state: c.input.state, reason: c.input.reason, threadID: c.input.thread_id,
        threadStatus: c.input.thread_status, waiting: c.input.waiting)
      let want = try c.expected.map { e in
        DeliveryStage(
          name: try #require(DeliveryStage.Name(rawValue: e.name), "\(c.case)"), label: e.label,
          tone: try #require(DeliveryStage.Tone(rawValue: e.tone), "\(c.case)"), note: e.note)
      }
      #expect(d.stages == want, "\(c.case)")
    }
  }

  @Test func unknownStateStillShowsAThreeLineDetail() throws {
    let d = try delivery(state: "rerouted")
    #expect(d.stages.count == 3)
    #expect(d.stages.first == DeliveryStage(name: .trigger, label: "Accepted", tone: .done, note: nil))
  }
}
