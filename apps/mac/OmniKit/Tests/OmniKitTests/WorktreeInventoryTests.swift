import Foundation
import Synchronization
import Testing
import OmniKit

private func item(_ id: String, _ verdict: String, kind: String = "managed", bytes: Int64? = 1024, folder: Bool = true) -> String {
  """
  {"id":"\(id)","kind":"\(kind)","verdict":"\(verdict)","dir":"/d/\(id)","repo":null,"branch":null,"threadId":null,"threadTitle":null,
   "channelId":null,"channelName":null,"folder":\(folder),"registered":true,"bytes":\(bytes.map(String.init) ?? "null"),
   "sharedWith":[],"reasons":[],"eligibleBecause":null,"errors":[]}
  """
}

private func scan(state: String = "running", done: Int = 0, total: Int = 4, items: [String] = []) -> String {
  """
  {"scan":{"id":"s1","state":"\(state)","phase":"\(state == "running" && total == 0 ? "listing" : "inspecting")",
   "startedAt":"2026-10-24T10:00:00.000Z","finishedAt":null,"total":\(total),"done":\(done),"items":[\(items.joined(separator: ","))],"error":null},
   "summary":null}
  """
}

/// The /api/worktrees routes: GET answers the current scan and every POST answers it too. `route` answers a
/// request first when it has a reply for it.
final class ScanServer: Sendable {
  private final class Replies: Sendable {
    let queue: Mutex<[String]>
    init(_ queue: [String]) { self.queue = Mutex(queue) }
  }

  let transport: StubTransport

  /// Each GET takes the next reply, and the last one stays.
  init(
    get: [String], post: String = #"{"scan":null,"summary":null}"#,
    route: @escaping @Sendable (URLRequest) -> StubTransport.Reply? = { _ in nil }
  ) {
    let replies = Replies(get)
    transport = StubTransport { req in
      if let reply = route(req) { return reply }
      if req.httpMethod == "GET" {
        let next = replies.queue.withLock { $0.count > 1 ? $0.removeFirst() : ($0.first ?? #"{"scan":null,"summary":null}"#) }
        return StubTransport.Reply(body: next)
      }
      return StubTransport.Reply(body: req.url!.path.hasSuffix("/cancel") ? #"{"cancelled":true,"scan":null,"summary":null}"# : post)
    }
  }

  var client: OmniClient { OmniClient(port: 4799, transport: transport) }
  var gets: Int { transport.requests.filter { $0.httpMethod == "GET" }.count }
}

@Suite struct WorktreeInventoryDecodingTests {
  @Test func decodesTheRecordedScan() throws {
    let reply = try decodeFixture(WorktreeScanReply.self, "worktree-scan.json")
    let scan = try #require(reply.scan)
    #expect(scan.state == .done && scan.phase == .finished && !scan.isRunning)
    #expect(scan.total == 3 && scan.done == 3 && scan.progress == 1)
    let it = try #require(scan.items.first)
    #expect(it.kind == .managed && it.verdict == .kept && it.title == "Fix the widget")
    #expect(it.detail == "Widgets · omni/00000000")
    #expect(it.reasons.map(\.code) == ["open-thread", "untracked", "unpushed"])
    #expect(it.eligibleBecause == nil)
    #expect(it.lastActiveAt == OmniJSON.parseDate("2026-01-05T09:00:00.000Z"))
    #expect(scan.items.dropFirst().map(\.eligibleBecause) == [.archived, .archived])
  }

  @Test func theLocalTotalsMatchTheServers() throws {
    let reply = try decodeFixture(WorktreeScanReply.self, "worktree-scan.json")
    #expect(InventorySummary.of(try #require(reply.scan).items) == reply.summary)
  }

  @Test func aValueANewerServerSendsDoesNotBreakDecoding() throws {
    let json = scan(state: "paused", items: [item("a", "someday", kind: "mirage")])
    let reply = try OmniJSON.decoder().decode(WorktreeScanReply.self, from: Data(json.utf8))
    let s = try #require(reply.scan)
    #expect(s.state == .failed)
    #expect(s.items[0].verdict == .unknown && s.items[0].kind == .orphan)
  }

  @Test func totalsLeaveStaleRegistrationsOutOfTheDiskUse() throws {
    let json = scan(state: "done", done: 4, items: [
      item("a", "eligible", bytes: 3000), item("b", "kept", bytes: 500), item("c", "unknown", bytes: nil),
      item("d", "eligible", kind: "stale-registration", bytes: 0, folder: false),
    ])
    let s = InventorySummary.of(try #require(try OmniJSON.decoder().decode(WorktreeScanReply.self, from: Data(json.utf8)).scan).items)
    #expect((s.eligible.count, s.eligible.bytes) == (1, 3000))
    #expect((s.kept.count, s.unknown.count, s.stale, s.folders, s.bytes) == (1, 1, 1, 3, 3500))
  }

  @Test func sizesReadLikeTheWebUI() {
    #expect(ByteSize.label(nil) == "unknown size")
    #expect(ByteSize.label(0) == "0 KB")
    #expect(ByteSize.label(12 * 1024) == "12 KB")
    #expect(ByteSize.label(340 * 1_048_576) == "340 MB")
    #expect(ByteSize.label(Int64(1.2 * 1_073_741_824)) == "1.2 GB")
    #expect(ByteSize.label(45 * 1_073_741_824) == "45 GB")
  }
}

@MainActor @Suite struct WorktreeInventoryModelTests {
  private func model(_ server: ScanServer) -> WorktreeInventoryModel {
    WorktreeInventoryModel(client: server.client, pollInterval: .milliseconds(10))
  }

  private func settle(_ what: String, _ ok: @MainActor () -> Bool) async {
    for _ in 0..<300 where !ok() { try? await Task.sleep(for: .milliseconds(10)) }
    #expect(ok(), Comment(rawValue: what))
  }

  @Test func loadingShowsTheLastScanAndDoesNotScan() async throws {
    let server = ScanServer(get: [scan(state: "done", done: 4, items: [item("a", "eligible")])])
    let m = model(server)
    await m.load()
    #expect(m.loadState == .loaded && m.scan?.state == .done)
    #expect(m.folders(.eligible).map(\.id) == ["a"])
    #expect(m.progressLabel == "Checked 4")
    #expect(server.transport.requests.allSatisfy { $0.httpMethod == "GET" })
  }

  @Test func noScanYetIsLoadedWithNothing() async {
    let m = model(ScanServer(get: [#"{"scan":null,"summary":null}"#]))
    await m.load()
    #expect(m.loadState == .loaded && m.scan == nil && m.items.isEmpty && m.progressLabel == nil)
  }

  @Test func aFailedLoadSaysWhy() async {
    let transport = StubTransport(status: 500, body: #"{"error":"disk on fire"}"#)
    let m = WorktreeInventoryModel(client: OmniClient(port: 4799, transport: transport))
    await m.load()
    #expect(m.loadState == .failed("disk on fire"))
  }

  @Test func aRunningScanIsPolledUntilItFinishesThenPollingStops() async {
    let server = ScanServer(get: [
      scan(done: 1),
      scan(done: 3),
      scan(state: "done", done: 4, items: [item("a", "eligible"), item("b", "kept")]),
    ])
    let m = model(server)
    await m.load()
    #expect(m.scan?.isRunning == true && m.progressLabel == "Checking 1 of 4")
    await settle("scan finished") { m.scan?.state == .done }
    #expect(m.items.count == 2)
    let seen = server.gets
    try? await Task.sleep(for: .milliseconds(120))
    #expect(server.gets == seen, "no polling once the scan left running")
  }

  @Test func startPostsAndFollowsTheScan() async {
    let server = ScanServer(
      get: [scan(state: "done", done: 4)],
      post: scan(done: 0)
    )
    let m = model(server)
    await m.startScan()
    #expect(server.transport.requests.first.map { "\($0.httpMethod!) \($0.url!.path)" } == "POST /api/worktrees/scan")
    await settle("polled to done") { m.scan?.state == .done }
  }

  @Test func cancelPostsAndStopsPolling() async {
    let server = ScanServer(get: [scan(done: 1)])
    let m = model(server)
    await m.load()
    await m.cancelScan()
    #expect(server.transport.requests.contains { $0.httpMethod == "POST" && $0.url!.path == "/api/worktrees/scan/cancel" })
    #expect(m.scan == nil)
    let seen = server.gets
    try? await Task.sleep(for: .milliseconds(120))
    #expect(server.gets == seen)
  }

  @Test func cancelledScansKeepWhatWasChecked() async {
    let server = ScanServer(get: [scan(state: "cancelled", done: 2, items: [item("a", "kept"), item("b", "kept")])])
    let m = model(server)
    await m.load()
    #expect(m.progressLabel == "Cancelled after 2 of 4")
    #expect(m.folders(.kept).count == 2)
  }

  @Test func stopEndsPollingWhenTheTabCloses() async {
    let server = ScanServer(get: [scan(done: 1)])
    let m = model(server)
    await m.load()
    m.stop()
    let seen = server.gets
    try? await Task.sleep(for: .milliseconds(120))
    #expect(server.gets == seen)
  }
}
