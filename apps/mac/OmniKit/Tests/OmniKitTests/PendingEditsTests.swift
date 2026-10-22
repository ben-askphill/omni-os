import Foundation
import Testing
import OmniKit

// Editing, removing and reordering unsent messages from the Mac app's side (PendingEdits.swift), as
// apps/web/tests/web-pending-edits.test.ts does for the Web UI. The server answers are the recorded fixtures.

private func pending(_ json: String) throws -> [PendingMsg] {
  try OmniJSON.decoder().decode([PendingMsg].self, from: Data(json.utf8))
}

private func msg(_ uuid: String, _ state: String, delivery: String? = nil, kind: String = "user", requestID: Bool = true, text: String? = nil) -> String {
  let rid = requestID ? #","request_id":"r-\#(uuid)""# : ""
  return #"{"uuid":"\#(uuid)","kind":"\#(kind)","text":"\#(text ?? uuid)","mode":"queue","state":"\#(state)","delivery":"\#(delivery ?? state)"\#(rid)}"#
}

@MainActor @Suite struct PendingEditsTests {
  @Test func onlyBensUnsentSavedMessagesAreEditable() throws {
    let items = try pending(
      "[\(msg("a", "held")),\(msg("b", "waiting")),\(msg("c", "held", delivery: "recovered")),\(msg("d", "sent")),"
        + "\(msg("e", "held", kind: "crew_report")),\(msg("f", "held", requestID: false))]")
    #expect(items.map(\.isEditable) == [true, true, true, false, false, false])

    let resumed = try decodeFixture(RecoveryAnswer.self, "requests-resumed.json")
    #expect(resumed.pending.map(\.isEditable) == [false, true])
  }

  @Test func omnisOwnMessagesAreNotEditableOrMovable() throws {
    // A crew report and a team's go, both saved and parked: Resume or Discard, never Edit or a move.
    let team = #"{"uuid":"t","kind":"user","text":"All 2 reports are in.","source":"team","mode":"steer","state":"held","delivery":"recovered","request_id":"team-settle:x"}"#
    let report = #"{"uuid":"r","kind":"crew_report","text":"done","mode":"steer","state":"held","delivery":"recovered","request_id":"crew-report:c:9","thread_id":"c"}"#
    let items = try pending("[\(team),\(report),\(msg("p1", "held", delivery: "recovered")),\(msg("p2", "held", delivery: "recovered"))]")
    #expect(items.map(\.isOmnis) == [true, true, false, false])
    #expect(items.map(\.isEditable) == [false, false, true, true])
    #expect(PendingOrder.moved(items, uuid: "p2", step: -1) == ["p2", "p1"])
    #expect(PendingOrder.moved(items, uuid: "t", step: 1) == nil)
    #expect(ParkedMessages.heading(items) == "4 messages and crew reports are waiting for Resume")
    #expect(PendingMsg.reportNotes(items) == ["c": "report held for Resume"])
  }

  @Test func steerNowIsOfferedOnlyForAHeldMessageAndPostsItsID() async throws {
    let items = try pending(
      "[\(msg("a", "held")),\(msg("b", "waiting")),\(msg("c", "held", delivery: "recovered")),\(msg("d", "sent")),"
        + "\(msg("e", "held", kind: "crew_report"))]")
    #expect(items.map(\.canSteerNow) == [true, false, false, false, false])

    let t = StubTransport(body: try fixture("requests-cancelled.json"))
    let model = PendingEditsModel(threadID: "t 1")
    let answer = await model.steer(items[0], using: OmniClient(port: 4799, transport: t))
    #expect(answer != nil)
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "POST")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/threads/t%201/requests/steer")
    #expect(try bodyJSON(req) == .object(["ids": .array([.string("a")])]))
  }

  @Test func movesWithinItsGroupOnly() throws {
    let items = try pending(
      "[\(msg("sent", "sent")),\(msg("a", "held")),\(msg("b", "held")),\(msg("w", "waiting")),"
        + "\(msg("p1", "held", delivery: "recovered")),\(msg("p2", "held", delivery: "uncertain"))]")
    #expect(PendingOrder.moved(items, uuid: "b", step: -1) == ["b", "a", "w", "p1", "p2"])
    #expect(PendingOrder.moved(items, uuid: "p1", step: 1) == ["a", "b", "w", "p2", "p1"])
    #expect(PendingOrder.moved(items, uuid: "a", step: -1) == nil)
    #expect(PendingOrder.moved(items, uuid: "b", step: 1) == nil)
    #expect(PendingOrder.moved(items, uuid: "p1", step: -1) == nil)
    #expect(PendingOrder.moved(items, uuid: "sent", step: 1) == nil)
  }

  @Test func readsTheEditAnswersAndSendsTheRecordedBody() async throws {
    let edited = try decodeFixture(EditAnswer.self, "request-edited.json")
    #expect(edited.request.prompt == "and check the totals twice")
    #expect(edited.request.requestID == "req-2")
    #expect(edited.pending.last?.text == "and check the totals twice")
    let cancelled = try decodeFixture(RecoveryAnswer.self, "requests-cancelled.json")
    #expect(!cancelled.pending.contains { $0.requestID == "req-2" })
    let record = try decodeFixture([SavedRequest].self, "requests-record.json")
    #expect(record.first { $0.requestID == "req-2" }?.state == .cancelled)

    let t = StubTransport(body: try fixture("request-edited.json"))
    let answer = try await OmniClient(port: 4799, transport: t).editRequest(
      in: "t 1", request: "r/1", prompt: "and check the totals twice", keep: [], files: [])
    #expect(answer.request.pos == edited.request.pos)
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "PATCH")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/threads/t%201/requests/r%2F1")
    let expected = try JSONDecoder().decode(JSONValue.self, from: Data(try fixture("request-edit-request.json").utf8))
    #expect(try bodyJSON(req) == expected)
  }

  @Test func anEditKeepsItsTextWhenTheMessageIsSentWhileItIsOpen() throws {
    let model = PendingEditsModel(threadID: "t1")
    let held = try pending("[\(msg("a", "held", text: "first draft"))]")
    model.open(held[0])
    model.update("a") { $0.prompt = "second draft" }
    // Still held: nothing changes.
    model.reconcile(held)
    #expect(model.draft(for: "a")?.prompt == "second draft")
    // The turn ended and the runner sent it.
    model.reconcile(try pending("[\(msg("a", "sent", text: "first draft"))]"))
    #expect(model.draft(for: "a") == nil)
    #expect(model.stale.map(\.prompt) == ["second draft"])
    #expect(model.stale.first?.error == PendingEditDraft.staleNote)
    // It stays until Ben copies, sends or dismisses it.
    model.reconcile([])
    #expect(model.stale.count == 1)
    model.close("a")
    #expect(model.drafts.isEmpty)

    // An untouched edit just closes.
    model.open(held[0])
    model.reconcile([])
    #expect(model.drafts.isEmpty)
  }

  @Test func aSaveThatLosesTheRaceTurnsStaleAndASaveThatWinsCloses() async throws {
    let held = try pending("[\(msg("a", "held", text: "first draft"))]")
    let lost = StubTransport(status: 409, body: try fixture("error-already-sent.json"))
    let model = PendingEditsModel(threadID: "t1")
    model.open(held[0])
    model.update("a") { $0.prompt = "too late" }
    #expect(await model.save("a", using: OmniClient(port: 4799, transport: lost)) == nil)
    #expect(model.stale.map(\.prompt) == ["too late"])

    // Any other failure leaves the edit open with the reason.
    let down = StubTransport(status: 500, body: #"{"error":"boom"}"#)
    model.open(held[0])
    model.update("a") { $0.prompt = "again" }
    #expect(await model.save("a", using: OmniClient(port: 4799, transport: down)) == nil)
    #expect(model.draft(for: "a")?.status == .editing)
    #expect(model.draft(for: "a")?.error == "boom")

    let won = StubTransport(body: try fixture("request-edited.json"))
    let answer = await model.save("a", using: OmniClient(port: 4799, transport: won))
    #expect(answer?.request.prompt == "and check the totals twice")
    #expect(model.drafts.isEmpty)
    let multipartless = try #require(won.requests.first)
    #expect(try bodyJSON(multipartless) == .object(["prompt": .string("again"), "keep": .array([])]))
  }

  @Test func resumingWhileAnEditIsOpenKeepsTheEditAndAStaleOrderIsRefused() async throws {
    // The store reconciles its edits with every pending list: here the answer to Resume.
    let recovered = try decodeFixture(ThreadDetail.self, "thread-recovered.json")
    let store = ThreadStore(id: recovered.thread.id, client: OmniClient(port: 4799, transport: StubTransport(body: "{}")))
    store.apply(recovery: RecoveryAnswer(thread: recovered.thread, pending: recovered.pending))
    let first = try #require(recovered.pending.first)
    store.edits.open(first)
    store.edits.update(first.uuid) { $0.prompt = "then write it up properly" }
    let resumed = try decodeFixture(RecoveryAnswer.self, "requests-resumed.json")
    store.apply(recovery: resumed)
    #expect(store.edits.stale.map(\.prompt) == ["then write it up properly"])

    // A move made from the list before Resume: the server refuses it, the error says so and nothing moves.
    let refused = StubTransport(status: 409, body: #"{"error":"The queue changed while you were reordering it. Try again."}"#)
    let answer = await store.edits.move(recovered.pending[1], step: -1, in: recovered.pending, using: OmniClient(port: 4799, transport: refused))
    #expect(answer == nil)
    #expect(store.edits.error == "The queue changed while you were reordering it. Try again.")
    #expect(try bodyJSON(try #require(refused.requests.first)) == .object(["ids": .array([.string(recovered.pending[1].uuid), .string(first.uuid)])]))
    #expect(store.pending == resumed.pending)
  }
}
