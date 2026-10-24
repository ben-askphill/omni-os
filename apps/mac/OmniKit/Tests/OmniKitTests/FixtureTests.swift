import Foundation
import Testing
import OmniKit

// The fixtures are recorded from a real server by apps/server/tests/mac-fixtures.test.ts, which also checks on every
// npm test that the server still sends the same shape. Here each one must decode into the app's types.

func fixture(_ name: String) throws -> String {
  let url = try #require(Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Fixtures"), "no fixture \(name)")
  return try String(contentsOf: url, encoding: .utf8)
}

func decodeFixture<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
  try OmniJSON.decoder().decode(T.self, from: Data(try fixture(name).utf8))
}

/// The `data:` of each unnamed message in an SSE text, as `SSEParser` reads it. Pings are left out.
func sseData(_ text: String) -> [String] {
  var parser = SSEParser()
  return parser.feed(Array(text.utf8)).filter { $0.event == "message" }.map(\.data)
}

@Suite struct FixtureTests {
  /// Every fixture file and what it decodes as.
  static let decoders: [String: @Sendable () throws -> Void] = [
    "harnesses.json": { _ = try decodeFixture([HarnessInfo].self, "harnesses.json") },
    "crew.json": { _ = try decodeFixture([CrewRole].self, "crew.json") },
    "thread-created.json": { _ = try decodeFixture(OmniThread.self, "thread-created.json") },
    "status.json": { _ = try decodeFixture(Status.self, "status.json") },
    "channels.json": { _ = try decodeFixture([ChannelWithRunning].self, "channels.json") },
    "channel.json": { _ = try decodeFixture(ChannelWithRunning.self, "channel.json") },
    "thread.json": { _ = try decodeFixture(ThreadDetail.self, "thread.json") },
    "thread-rich.json": { _ = try decodeFixture(ThreadDetail.self, "thread-rich.json") },
    "prs.json": { _ = try decodeFixture([PullRequestSummary].self, "prs.json") },
    "pr.json": { _ = try decodeFixture(PullRequestDetail.self, "pr.json") },
    "channel-threads.json": { _ = try decodeFixture([OmniThread].self, "channel-threads.json") },
    "threads.json": { _ = try decodeFixture([OmniThread].self, "threads.json") },
    "recent.json": { _ = try decodeFixture([OmniThread].self, "recent.json") },
    "artifacts.json": { _ = try decodeFixture([GalleryArtifact].self, "artifacts.json") },
    "error-not-found.json": { _ = try decodeFixture([String: String].self, "error-not-found.json") },
    "thread-stream.sse": { _ = try threadStream() },
    "feed.sse": { _ = try feed() },
    "secrets.json": { _ = try decodeFixture([SecretRow].self, "secrets.json") },
    "secret-saved.json": { _ = try decodeFixture([String: Bool].self, "secret-saved.json") },
    "secret-deleted.json": { _ = try decodeFixture([String: Bool].self, "secret-deleted.json") },
    "error-secret-name.json": { _ = try decodeFixture([String: String].self, "error-secret-name.json") },
    "automations.json": { _ = try decodeFixture([Automation].self, "automations.json") },
    "automation-run.json": { _ = try decodeFixture(OmniThread.self, "automation-run.json") },
    "automation-enabled.json": { _ = try decodeFixture([String: Bool].self, "automation-enabled.json") },
    "thread-recovered.json": { _ = try decodeFixture(ThreadDetail.self, "thread-recovered.json") },
    "requests-resumed.json": { _ = try decodeFixture(RecoveryAnswer.self, "requests-resumed.json") },
    "request-edited.json": { _ = try decodeFixture(EditAnswer.self, "request-edited.json") },
    "requests-reordered.json": { _ = try decodeFixture(RecoveryAnswer.self, "requests-reordered.json") },
    "requests-cancelled.json": { _ = try decodeFixture(RecoveryAnswer.self, "requests-cancelled.json") },
    "requests-record.json": { _ = try decodeFixture([SavedRequest].self, "requests-record.json") },
    "error-already-sent.json": { _ = try decodeFixture([String: String].self, "error-already-sent.json") },
    "thread-report-held.json": { _ = try decodeFixture(ThreadDetail.self, "thread-report-held.json") },
    "thread-setup-failed.json": { _ = try decodeFixture(ThreadDetail.self, "thread-setup-failed.json") },
    "setup-retried.json": { _ = try decodeFixture(RecoveryAnswer.self, "setup-retried.json") },
    "needs-you.json": { _ = try decodeFixture(NeedsYou.self, "needs-you.json") },
    "needs-you-read.json": { _ = try decodeFixture(NeedsYouRead.self, "needs-you-read.json") },
    "thread-limited.json": { _ = try decodeFixture(ThreadDetail.self, "thread-limited.json") },
    "limit-scheduled.json": { _ = try decodeFixture(RecoveryAnswer.self, "limit-scheduled.json") },
    "limit-cancelled.json": { _ = try decodeFixture(RecoveryAnswer.self, "limit-cancelled.json") },
    "limit-resumed.json": { _ = try decodeFixture(RecoveryAnswer.self, "limit-resumed.json") },
    "changes.json": { _ = try decodeFixture(BranchChanges.self, "changes.json") },
    "changes-unavailable.json": { _ = try decodeFixture(BranchChanges.self, "changes-unavailable.json") },
    "turns.json": { _ = try decodeFixture(TurnChanges.self, "turns.json") },
    "turns-unavailable.json": { _ = try decodeFixture(TurnChanges.self, "turns-unavailable.json") },
    "thread-context.json": { _ = try decodeFixture(ThreadDetail.self, "thread-context.json") },
    "thread-references.json": { _ = try decodeFixture([ThreadReferenceCandidate].self, "thread-references.json") },
    // Recorded by apps/server/tests/handoff-two-macs.test.ts, which needs two Macs.
    "devices.json": { _ = try decodeFixture([Device].self, "devices.json") },
    "thread-handoff.json": { _ = try decodeFixture(ThreadDetail.self, "thread-handoff.json") },
    // Recorded by apps/server/tests/browser-capture.test.ts, which has no Chrome to capture.
    "browser-capture.json": { _ = try decodeFixture(BrowserCaptureReply.self, "browser-capture.json") },
    "browser-capture-stale.json": { _ = try decodeFixture(BrowserCaptureFailureBody.self, "browser-capture-stale.json") },
    // Recorded by apps/server/tests/browser-pick.test.ts, as above.
    "browser-pick-element.json": { _ = try decodeFixture(ElementPickReply.self, "browser-pick-element.json") },
    "browser-pick-unavailable.json": { _ = try decodeFixture(ElementPickReply.self, "browser-pick-unavailable.json") },
    // Hand-made: apps/server/tests/sync-setup.test.ts checks the server still sends its keys and types.
    "sync-status.json": { _ = try decodeFixture(SyncStatus.self, "sync-status.json") },
    // Request bodies the app sends. SecretsTests compares them with what the client encodes.
    "secret-set-request.json": { _ = try decodeFixture([String: String].self, "secret-set-request.json") },
    "secret-delete-request.json": { _ = try decodeFixture([String: String].self, "secret-delete-request.json") },
    "automation-enabled-request.json": { _ = try decodeFixture([String: Bool].self, "automation-enabled-request.json") },
    // ReplyRequestTests compares it with what the client encodes.
    "message-queued-request.json": { _ = try decodeFixture([String: String].self, "message-queued-request.json") },
    // PendingEditsTests compares it with what the client encodes.
    "request-edit-request.json": { _ = try decodeFixture(JSONValue.self, "request-edit-request.json") },
    // NeedsYouTests compares it with what the client encodes.
    "needs-you-read-request.json": { _ = try decodeFixture([String: String].self, "needs-you-read-request.json") },
    // ReplyRequestTests makes it from changes.json and compares it with what the client encodes.
    "message-context-request.json": { _ = try decodeFixture([String: JSONValue].self, "message-context-request.json") },
  ]

  static func threadStream() throws -> [ThreadStreamMessage] {
    try sseData(fixture("thread-stream.sse")).map { try OmniJSON.decoder().decode(ThreadStreamMessage.self, from: Data($0.utf8)) }
  }

  static func feed() throws -> [FeedEvent] {
    try sseData(fixture("feed.sse")).map { try OmniJSON.decoder().decode(FeedEvent.self, from: Data($0.utf8)) }
  }

  @Test func coversEveryFixture() throws {
    let dir = try #require(Bundle.module.url(forResource: "Fixtures", withExtension: nil))
    let files = try FileManager.default.contentsOfDirectory(atPath: dir.path()).filter { !$0.hasPrefix(".") }
    #expect(Set(files) == Set(Self.decoders.keys))
  }

  @Test(arguments: decoders.keys.sorted())
  func decodes(_ name: String) throws {
    let decode = try #require(Self.decoders[name])
    try decode()
  }

  @Test func readsTheSidebar() throws {
    let status = try decodeFixture(Status.self, "status.json")
    #expect(status.running == 1)
    #expect(status.usage[.claudeCode]?.fiveHour != nil)
    #expect(status.slots[.claudeCode]?.running == 1)
    #expect(status.server?.dataDir.isEmpty == false)

    let channels = try decodeFixture([ChannelWithRunning].self, "channels.json")
    #expect(channels.map(\.kind).contains(.system))
    let acme = try #require(channels.first { $0.id == "acme" })
    #expect(acme.running == 1)
    #expect(acme.active.first?.status == .running)

    let harnesses = try decodeFixture([HarnessInfo].self, "harnesses.json")
    #expect(harnesses.map(\.id) == [.claudeCode, .codex, .cursor, .hermes, .cursorCloud])
    #expect(harnesses.first?.models.contains { $0.isDefault } == true)
    // No CURSOR_API_KEY in the fixture run: unavailable, with the fix, and no models.
    let cloud = try #require(harnesses.first { $0.id == .cursorCloud })
    #expect(!cloud.available && cloud.fix?.contains("CURSOR_API_KEY") == true && cloud.models.isEmpty)
    #expect(cloud.capabilities.steer == false)
    // The picker says "Run codex login" but shows a sentence fix as it is.
    #expect(harnesses.first { $0.id == .codex }?.fixCommand == "codex login")
    #expect(cloud.fixCommand == nil && harnesses.first { $0.id == .hermes }?.fixCommand == nil)
  }

  @Test func readsAThreadBeingHandedOff() throws {
    let devices = try decodeFixture([Device].self, "devices.json")
    #expect(devices.map(\.name) == ["Mac B"])
    #expect(devices.first?.reachability == .online)
    #expect(devices.first?.canTake == true)

    let d = try decodeFixture(ThreadDetail.self, "thread-handoff.json")
    let h = try #require(d.handoff, "the handoff decodes")
    #expect(h.outgoing)
    #expect((h.from.name, h.to.name) == ("Mac A", "Mac B"))
    #expect(h.state == .offered(stale: false))
    #expect(d.blocked == h.text(now: h.at), "the server's block while it waits is the card's line")
    #expect(HandoffBanner(h, status: d.thread.status, now: h.at) == .card(tone: .waiting, text: "Waiting for Mac B to pick it up.", cancel: true))
  }

  @Test func readsAThreadMidTurn() throws {
    let d = try decodeFixture(ThreadDetail.self, "thread.json")
    #expect(d.thread.status == .running)
    // Auto picked the effort for the fixture thread (apps/server/harness/auto.ts).
    #expect(d.thread.effort == "low")
    #expect(d.channel?.id == "acme")
    #expect(d.pending.map(\.state) == [.held])
    #expect(d.live)
    for e in d.events {
      if case .unknown = e.content { Issue.record("event \(e.id) of kind \(e.kind) did not decode: \(e.payload)") }
    }
    #expect(Set(d.events.map(\.kind)).isSuperset(of: ["init", "user", "tool_use", "tool_result", "assistant_text", "result"]))
  }

  @Test func readsMessagesARestartParked() throws {
    let d = try decodeFixture(ThreadDetail.self, "thread-recovered.json")
    #expect(d.thread.status == .failed)
    #expect(d.pending.map(\.state) == [.held, .held])
    #expect(d.pending.map(\.delivery) == [.recovered, .uncertain])
    #expect(d.pending.map(\.requestID) == ["req-1", "req-2"])
    #expect(d.pending.allSatisfy { $0.isParked })
    #expect(d.pending.map { $0.label(lead: false) } == [
      "Held after a restart, waiting for Resume", "May have reached the agent before the restart",
    ])
    let parked = ParkedMessages(d.pending)
    #expect(parked.recovered.map(\.requestID) == ["req-1"])
    #expect(parked.uncertain.map(\.requestID) == ["req-2"])

    let resumed = try decodeFixture(RecoveryAnswer.self, "requests-resumed.json")
    #expect(resumed.thread.id == d.thread.id)
    // The resumed one is the runner's again; the uncertain one still waits on Ben.
    #expect(resumed.pending.first?.requestID == "req-1")
    #expect(resumed.pending.first?.isParked == false)
    #expect(resumed.pending.last?.delivery == .uncertain)
  }

  @Test func readsACrewReportHeldForAStoppedParent() throws {
    let d = try decodeFixture(ThreadDetail.self, "thread-report-held.json")
    #expect(d.thread.status == .stopped)
    let r = try #require(d.pending.first)
    #expect(d.pending.count == 1)
    #expect(r.kind == "crew_report")
    #expect(r.delivery == .recovered)
    #expect(r.isParked)
    #expect(r.isOmnis)
    #expect(!r.isEditable)
    #expect(r.text == "ack: TOOL:300 check the stock")
    let child = try #require(r.threadID)
    #expect(r.label(lead: false) == "Crew report \(r.taskID ?? ""), held for Resume")
    #expect(ParkedMessages(d.pending).recovered == [r])
    #expect(ParkedMessages.heading(d.pending) == "1 crew report is waiting for Resume")
    #expect(PendingMsg.reportNotes(d.pending) == [child: "report held for Resume"])
    #expect(PendingOrder.moved(d.pending, uuid: r.uuid, step: -1) == nil)
  }

  @Test func readsAWorktreeThatCouldNotBePrepared() throws {
    let d = try decodeFixture(ThreadDetail.self, "thread-setup-failed.json")
    #expect(d.thread.status == .failed)
    #expect(d.thread.setup == .failed)
    #expect(d.thread.setupError?.contains("git worktree add failed") == true)
    #expect(d.thread.branch?.hasPrefix("omni/") == true)
    // The first prompt waits, recovered, for Retry, and Ben can still edit it.
    let first = try #require(d.pending.first)
    #expect(d.pending.count == 1)
    #expect(first.requestID == "thread-start")
    #expect(first.delivery == .recovered)
    #expect(first.isEditable)
    #expect(first.label(lead: false, setup: d.thread.setup) == "Waits for the worktree")
    #expect(first.label(lead: false) == "Held after a restart, waiting for Resume")
    // Retry answers at once: preparing, the prompt still waiting.
    let retried = try decodeFixture(RecoveryAnswer.self, "setup-retried.json")
    #expect(retried.thread.id == d.thread.id)
    #expect(retried.thread.setup == .preparing)
    #expect(retried.thread.setupError == nil)
    #expect(retried.pending.map(\.requestID) == ["thread-start"])
    // A thread that needs no worktree has none.
    #expect(try decodeFixture(ThreadDetail.self, "thread.json").thread.setup == nil)
  }

  @Test func readsAThreadStoppedAtItsUsageLimit() throws {
    let d = try decodeFixture(ThreadDetail.self, "thread-limited.json")
    #expect(d.thread.status == .failed)
    #expect(d.thread.limit == .limited)
    let resets = try #require(d.thread.limitResetsAt)
    #expect(LimitStop.view(d.thread)?.actions == [.schedule, .resume])
    let scheduled = try decodeFixture(RecoveryAnswer.self, "limit-scheduled.json")
    #expect(scheduled.thread.limit == .scheduled)
    #expect(scheduled.thread.limitResetsAt == resets)
    #expect(LimitStop.view(scheduled.thread)?.actions == [.cancel, .resume])
    #expect(try decodeFixture(RecoveryAnswer.self, "limit-cancelled.json").thread.limit == .limited)
    // Resume now: the stop is gone, and Omni's continuation waits for its turn.
    let resumed = try decodeFixture(RecoveryAnswer.self, "limit-resumed.json")
    #expect(resumed.thread.limit == nil)
    #expect(LimitStop.view(resumed.thread) == nil)
    #expect(resumed.pending.map(\.text) == ["Continue where you left off."])
    #expect(resumed.pending.first?.source == "limit")
    // A thread no limit stopped has none.
    #expect(try decodeFixture(ThreadDetail.self, "thread.json").thread.limit == nil)
  }

  /// apps/web/tests/web-message-context.test.ts renders the same record to the same label, range and source line.
  @Test func readsTheContextOnASentAndAQueuedMessage() throws {
    let d = try decodeFixture(ThreadDetail.self, "thread-context.json")
    let sent = d.events.compactMap { e -> MessageContextList? in
      if case .user(let m) = e.content, let c = m.context, !c.isEmpty { c } else { nil }
    }
    #expect(sent.count == 1)
    let queued = try #require(d.pending.first?.context)
    for list in [try #require(sent.first), queued] {
      let readings = ContextReading.read(list, kinds: [DiffSelectionContext.self])
      #expect(readings.count == 1)
      guard case .known(let record, let value)? = readings.first, let body = value as? DiffSelectionContext.Body else {
        Issue.record("the record does not read as a diff selection: \(readings)")
        continue
      }
      #expect(record.label == "src/cart.ts:1-3")
      #expect(DiffSelectionContext.label(body) == record.label)
      #expect(record.note == "this reduce reads better with names")
      #expect(DiffSelectionContext.range(body) == "new lines 1–3")
      #expect(DiffSelectionContext.sourceLine(body) == "Unstaged · HEAD ccccccc · blob a31fcc1")
      #expect(body.rows.map(\.kind) == [.context, .del, .add, .context])
    }
  }

  @Test func readsTheKindOfASavedRequest() throws {
    let record = try decodeFixture([SavedRequest].self, "requests-record.json")
    #expect(record.allSatisfy { $0.kind == "user" })
  }

  @Test func readsAThreadMidTurnWithItsRequestIDs() throws {
    let d = try decodeFixture(ThreadDetail.self, "thread.json")
    #expect(d.pending.first?.requestID != nil)
    #expect(d.pending.first?.delivery == .held)
    #expect(d.pending.first?.isParked == false)
  }

  @Test func readsEveryThreadStreamMessage() throws {
    let messages = try Self.threadStream()
    var events = 0, artifacts = 0, threads = 0, contexts = 0
    for m in messages {
      switch m {
      case .event(let e):
        events += 1
        if case .unknown = e.content { Issue.record("event \(e.id) of kind \(e.kind) did not decode: \(e.payload)") }
      case .artifact: artifacts += 1
      case .thread: threads += 1
      case .context: contexts += 1
      // The recorded turn runs no mod; StreamMessageTests reads a toast.
      case .modToast: break
      case .unknown(let json): Issue.record("unknown message: \(json)")
      }
    }
    #expect(events > 0)
    #expect(contexts > 0)
    #expect(artifacts == 1)
    #expect(threads > 0)
  }

  @Test func readsEveryFeedEvent() throws {
    let events = try Self.feed()
    #expect(events.contains { if case .usage(.claudeCode, _?) = $0 { true } else { false } })
    #expect(events.contains { if case .artifact = $0 { true } else { false } })
    #expect(events.contains { if case .thread = $0 { true } else { false } })
    #expect(events.contains { if case .tasks(let t) = $0 { !t.isEmpty } else { false } })
    for e in events {
      if case .unknown(let json) = e { Issue.record("unknown feed event: \(json)") }
    }
  }

  @Test func readsTheErrorEnvelope() async throws {
    let t = StubTransport(status: 404, body: try fixture("error-not-found.json"))
    await #expect(throws: OmniAPIError.http(status: 404, message: "not found")) {
      try await OmniClient(port: 4799, transport: t).thread("nope")
    }
  }
}
