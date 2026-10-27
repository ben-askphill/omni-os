import Foundation
import Testing
import OmniKit

// Toggling a plan step from the Mac app sends PATCH /api/threads/:id/plan/steps/:index with the new status.

@Suite struct PlanStepTests {
  @Test func setPlanStepPatchesTheStepWithItsStatus() async throws {
    let t = StubTransport(body: try fixture("requests-cancelled.json"))
    _ = try await OmniClient(port: 4799, transport: t).setPlanStep(in: "t 1", index: 2, status: "in_progress")
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "PATCH")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/threads/t%201/plan/steps/2")
    #expect(try bodyJSON(req) == .object(["status": .string("in_progress")]))
  }
}
