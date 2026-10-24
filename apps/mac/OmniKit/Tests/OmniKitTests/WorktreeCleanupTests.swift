import Foundation
import Testing
import OmniKit

private func candidate(_ id: String, because: String = "archived") -> String {
  #"{"id":"\#(id)","threadId":"\#(id)","threadTitle":"Thread \#(id)","channelName":"Gadgets","branch":"omni/\#(id)","bytes":8192,"because":"\#(because)","lastActiveAt":"2026-10-01T09:00:00.000Z"}"#
}

private func result(_ id: String, _ outcome: String, because: String = "archived") -> String {
  String(candidate(id, because: because).dropLast()) + #","outcome":"\#(outcome)","reasons":[],"errors":[]}"#
}

private func run(_ state: String, done: Int, total: Int, items: [String] = [], freed: Int = 0) -> String {
  let finished = state == "running" ? "null" : #""2026-10-24T10:01:00.000Z""#
  return #"{"id":"r1","trigger":"manual","state":"\#(state)","startedAt":"2026-10-24T10:00:00.000Z","finishedAt":\#(finished),"total":\#(total),"done":\#(done),"items":[\#(items.joined(separator: ","))],"freedBytes":\#(freed),"error":null}"#
}

private func preview(_ trigger: String, _ ids: [String]) -> String {
  #"{"trigger":"\#(trigger)","candidates":[\#(ids.map { candidate($0) }.joined(separator: ","))],"bytes":\#(8192 * ids.count)}"#
}

/// GET /api/worktrees/scan with a cleanup state. `scan` nil is before the first scan; `previews` nil is the server's
/// null preview, which it sends before the first scan and while one runs.
private func view(
  scan state: String? = "done", enabled: Bool = false, idleDays: Int = 14,
  previews: (manual: [String], retention: [String])? = ([], []), manualRun: String? = nil, retentionRun: String? = nil
) -> String {
  let scan = state.map { s in
    #"{"id":"s1","state":"\#(s)","phase":"\#(s == "running" ? "inspecting" : "finished")","startedAt":"2026-10-24T10:00:00.000Z","finishedAt":null,"total":2,"done":1,"items":[],"error":null}"#
  } ?? "null"
  let previewJSON = previews.map { #"{"manual":\#(preview("manual", $0.manual)),"retention":\#(preview("retention", $0.retention))}"# } ?? "null"
  return #"{"scan":\#(scan),"summary":null,"cleanup":{"policy":{"enabled":\#(enabled),"idleDays":\#(idleDays)},"preview":\#(previewJSON),"runs":{"manual":\#(manualRun ?? "null"),"retention":\#(retentionRun ?? "null")}}}"#
}

private func decodeView(_ json: String) throws -> WorktreeScanReply {
  try OmniJSON.decoder().decode(WorktreeScanReply.self, from: Data(json.utf8))
}

@Suite struct WorktreeCleanupDecodingTests {
  @Test func decodesTheRecordedPreview() throws {
    let cleanup = try #require(try decodeFixture(WorktreeScanReply.self, "worktree-scan.json").cleanup)
    #expect(!cleanup.policy.enabled && cleanup.policy.idleDays == 14)
    let manual = try #require(cleanup.preview?.manual)
    #expect(manual.candidates.map(\.title) == ["Tidy the gadgets", "Draft the gadget notes"])
    #expect(manual.candidates.allSatisfy { $0.because == .archived && $0.detail == "Gadgets · omni/00000000" })
    #expect(manual.candidates.first?.lastActiveAt == OmniJSON.parseDate("2026-01-05T09:00:00.000Z"))
    #expect(manual.amount == "2 worktrees (16 KB)")
    #expect(cleanup.preview?.retention.candidates.isEmpty == true)
    #expect(cleanup.runs.manual == nil && cleanup.runs.retention == nil && !cleanup.isRunning)
  }

  @Test func decodesTheRecordedRun() throws {
    let cleanup = try #require(try decodeFixture(WorktreeScanReply.self, "worktree-cleanup.json").cleanup)
    let run = try #require(cleanup.runs.manual)
    #expect(run.state == .done && !run.isRunning && run.total == 2 && run.done == 2 && run.progress == 1)
    #expect(run.items.map(\.outcome) == [.removed, .kept])
    #expect(run.items.map(\.candidate.title) == ["Tidy the gadgets", "Draft the gadget notes"])
    #expect(run.items[1].reasons.map(\.code) == ["untracked"] && run.items[1].errors.isEmpty)
    #expect(run.freedBytes == 8192 && run.finishedAt != nil && run.error == nil)
    #expect(run.summary == "Removed 1 (8 KB freed), kept 1, failed 0")
    #expect(cleanup.runs.retention == nil)
    #expect(cleanup.preview?.manual.candidates.isEmpty == true)
  }

  @Test func decodesThePolicyAfterTheChange() throws {
    let cleanup = try #require(try decodeFixture(WorktreeScanReply.self, "worktree-retention.json").cleanup)
    #expect(cleanup.policy.enabled && cleanup.policy.idleDays == 30)
  }

  @Test func aServerWithoutCleanupStillDecodes() throws {
    let reply = try decodeView(#"{"scan":null,"summary":null}"#)
    #expect(reply.cleanup == nil)
  }

  @Test func valuesANewerServerSendsDoNotBreakDecoding() throws {
    let json = view(manualRun: run("paused", done: 1, total: 1, items: [result("a", "skipped", because: "abandoned")]))
    let r = try #require(try decodeView(json).cleanup?.runs.manual)
    #expect(r.state == .failed)
    #expect(r.items[0].outcome == .kept && r.items[0].candidate.because == nil)
  }

  @Test func progressCountsWhatIsFinished() throws {
    let r = try #require(try decodeView(view(manualRun: run("running", done: 2, total: 5))).cleanup?.runs.manual)
    #expect(r.isRunning && r.progressLabel == "Removing 2 of 5" && r.progress == 0.4)
    let empty = try #require(try decodeView(view(manualRun: run("done", done: 0, total: 0))).cleanup?.runs.manual)
    #expect(empty.progress == 0 && empty.summary == "Removed 0 (0 KB freed), kept 0, failed 0")
  }

  @Test func theSummaryCountsEachOutcome() throws {
    let items = [result("a", "removed"), result("b", "removed"), result("c", "failed"), result("d", "kept")]
    let r = try #require(try decodeView(view(manualRun: run("done", done: 4, total: 4, items: items, freed: 3 * 1_048_576))).cleanup?.runs.manual)
    #expect(r.summary == "Removed 2 (3 MB freed), kept 1, failed 1")
  }

  @Test func theAfterPickerKeepsAnUnusualValue() throws {
    func choices(_ days: Int) throws -> [Int] { try #require(try decodeView(view(idleDays: days)).cleanup).policy.dayChoices }
    #expect(try choices(14) == [3, 7, 14, 30, 60, 90])
    #expect(try choices(21) == [3, 7, 14, 21, 30, 60, 90])
    #expect(try choices(365) == [3, 7, 14, 30, 60, 90, 365])
  }
}

@MainActor @Suite struct WorktreeCleanupModelTests {
  private func model(_ server: ScanServer) -> WorktreeInventoryModel {
    WorktreeInventoryModel(client: server.client, pollInterval: .milliseconds(10))
  }

  private func loaded(_ json: String) async -> WorktreeInventoryModel {
    let m = model(ScanServer(get: [json]))
    await m.load()
    m.stop()
    return m
  }

  private func path(_ req: URLRequest) -> String { "\(req.httpMethod!) \(req.url!.path)" }

  @Test func aRunningCleanupIsPolledUntilItFinishesThenPollingStops() async throws {
    let server = ScanServer(get: [
      view(manualRun: run("running", done: 0, total: 2)),
      view(manualRun: run("running", done: 1, total: 2, items: [result("a", "removed")], freed: 8192)),
      view(manualRun: run("done", done: 2, total: 2, items: [result("a", "removed"), result("b", "kept")], freed: 8192)),
    ])
    let m = model(server)
    await m.load()
    #expect(m.scan?.isRunning == false && m.isCleaning)
    #expect(m.cleanup?.runs.manual?.progressLabel == "Removing 0 of 2")
    try await waitFor("the cleanup finished") { m.cleanup?.runs.manual?.state == .done }
    #expect(!m.isCleaning)
    let seen = server.gets
    try await Task.sleep(for: .milliseconds(120))
    #expect(server.gets == seen, "no polling once the cleanup is done")
  }

  @Test func aRetentionPassKeepsThePollGoingToo() async throws {
    let server = ScanServer(get: [
      view(retentionRun: run("running", done: 0, total: 1)),
      view(retentionRun: run("done", done: 1, total: 1, items: [result("a", "removed")], freed: 8192)),
    ])
    let m = model(server)
    await m.load()
    #expect(m.isCleaning)
    try await waitFor("the pass finished") { m.cleanup?.runs.retention?.state == .done }
    #expect(m.cleanup?.runs.retention?.summary == "Removed 1 (8 KB freed), kept 0, failed 0")
  }

  @Test func startCleanupPostsExactlyTheReviewedIdsAndFollowsTheRun() async throws {
    let done = view(previews: ([], []), manualRun: run("done", done: 2, total: 2, items: [result("b", "removed"), result("a", "removed")]))
    let server = ScanServer(get: [done]) { req in
      req.url!.path == "/api/worktrees/cleanup" ? StubTransport.Reply(status: 202, body: view(manualRun: run("running", done: 0, total: 2))) : nil
    }
    let m = model(server)
    #expect(await m.startCleanup(ids: ["b", "a"]))
    let post = try #require(server.transport.requests.first)
    #expect(path(post) == "POST /api/worktrees/cleanup")
    #expect(try bodyJSON(post) == .object(["ids": .array([.string("b"), .string("a")])]))
    #expect(m.isCleaning && m.actionError == nil)
    try await waitFor("polled to done") { m.cleanup?.runs.manual?.state == .done }
  }

  @Test func aRefusedCleanupShowsWhyBesideIt() async throws {
    let server = ScanServer(get: [view(previews: (["a"], []))]) { req in
      req.url!.path == "/api/worktrees/cleanup"
        ? StubTransport.Reply(status: 409, body: #"{"error":"A worktree is no longer in the cleanup list. Scan again and review it."}"#)
        : nil
    }
    let m = model(server)
    await m.load()
    #expect(await m.startCleanup(ids: ["a"]) == false)
    #expect(m.actionError?.action == .cleanup)
    #expect(m.actionError?.message == "A worktree is no longer in the cleanup list. Scan again and review it.")
    #expect(m.cleanup?.preview?.manual.candidates.map(\.id) == ["a"], "the last view stays")
  }

  @Test func theRetentionRequestIsTheRecordedOne() async throws {
    let server = ScanServer(get: []) { req in
      req.httpMethod == "PUT" ? StubTransport.Reply(body: view(enabled: true, idleDays: 30)) : nil
    }
    let m = model(server)
    await m.setRetention(enabled: true, idleDays: 30)
    let put = try #require(server.transport.requests.last)
    #expect(path(put) == "PUT /api/worktrees/retention")
    let recorded = try JSONDecoder().decode(JSONValue.self, from: Data(try fixture("worktree-retention-request.json").utf8))
    #expect(try bodyJSON(put) == recorded)
    #expect(m.cleanup?.policy.enabled == true && m.cleanup?.policy.idleDays == 30)
  }

  @Test func oneRetentionChangeSendsOnlyThatField() async throws {
    let server = ScanServer(get: []) { req in
      req.httpMethod == "PUT" ? StubTransport.Reply(body: view(idleDays: 7)) : nil
    }
    let m = model(server)
    await m.setRetention(idleDays: 7)
    #expect(try bodyJSON(try #require(server.transport.requests.last)) == .object(["idleDays": .number(7)]))
    await m.setRetention(enabled: false)
    #expect(try bodyJSON(try #require(server.transport.requests.last)) == .object(["enabled": .bool(false)]))
  }

  @Test func aRefusedRetentionChangeIsNotBlamedOnTheScan() async throws {
    let server = ScanServer(get: []) { req in
      req.httpMethod == "PUT" ? StubTransport.Reply(status: 400, body: #"{"error":"idleDays must be 1 to 365"}"#) : nil
    }
    let m = model(server)
    await m.setRetention(idleDays: 0)
    #expect(m.actionError?.action == .retention && m.actionError?.message == "idleDays must be 1 to 365")
  }

  @Test func theCleanUpCardSaysWhatReviewWouldList() async {
    #expect(await loaded(view(scan: nil, previews: nil)).cleanupNote == "Scan to see what can be removed.")
    #expect(await loaded(view(scan: "running", previews: nil)).cleanupNote == "Shown once the scan is done.")
    #expect(await loaded(view(previews: ([], ["a"]))).cleanupNote == "Nothing to clean up.")
    #expect(
      await loaded(view(previews: (["a", "b"], []))).cleanupNote
        == "2 worktrees (16 KB) can be removed now. Each is checked again right before it goes."
    )
    #expect(
      await loaded(view(manualRun: run("running", done: 0, total: 2))).cleanupNote
        == "Each worktree is checked again right before it goes."
    )
  }

  @Test func theRetentionLineSaysWhatTheNextPassWouldRemove() async {
    #expect(await loaded(view(scan: nil, previews: nil)).retentionNote == "Scan to see what it would remove.")
    #expect(await loaded(view(scan: "running", previews: nil)).retentionNote == "Shown once the scan is done.")
    #expect(await loaded(view(enabled: true, previews: ([], ["a"]))).retentionNote == "The next pass would remove 1 worktree (8 KB).")
    #expect(await loaded(view(enabled: true, previews: (["a"], []))).retentionNote == "The next pass would remove nothing.")
    #expect(await loaded(view(enabled: false, previews: ([], []))).retentionNote == "If turned on, the next pass would remove nothing.")
    #expect(
      await loaded(view(enabled: false, previews: (["a", "b"], ["a", "b"]))).retentionNote
        == "If turned on, the next pass would remove 2 worktrees (16 KB)."
    )
    #expect(await loaded(#"{"scan":null,"summary":null}"#).retentionNote == nil)
  }
}
