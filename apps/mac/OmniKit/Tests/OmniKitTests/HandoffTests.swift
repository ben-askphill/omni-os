import Foundation
import Synchronization
import Testing
import OmniKit

private let air = #"{"id":"m-air","name":"Ben's MacBook Air"}"#
private let pro = #"{"id":"m-pro","name":"Ben's MacBook Pro"}"#

/// A handoff from the Air to the Pro. `idle` and `requested` are left out unless set, as older servers do.
func handoffJSON(
  _ state: String, outgoing: Bool = true, at: String = "2026-10-23T09:00:00.000Z", leftBehind: String? = nil, idle: Bool = false,
  requested: Bool = false
) -> String {
  let left = leftBehind.map { #""\#($0)""# } ?? "null"
  let flags = (idle ? #","idle":true"# : "") + (requested ? #","requested":true"# : "")
  return #"{"id":"o1","from":\#(air),"to":\#(pro),"outgoing":\#(outgoing),"at":"\#(at)","state":\#(state),"leftBehind":\#(left)\#(flags)}"#
}

/// The Air holds the thread; the Pro, reading it, could take it.
func takeoverJSON(running: Bool = true, refused: String? = nil) -> String {
  let r = refused.map { #""\#($0)""# } ?? "null"
  return #"{"from":\#(air),"to":\#(pro),"running":\#(running),"refused":\#(r)}"#
}

private func view(_ state: String, outgoing: Bool = true, idle: Bool = false, requested: Bool = false) throws -> HandoffView {
  try decode(HandoffView.self, handoffJSON(state, outgoing: outgoing, idle: idle, requested: requested))
}

private func text(_ state: String, outgoing: Bool = true, idle: Bool = false, requested: Bool = false) throws -> String {
  let v = try view(state, outgoing: outgoing, idle: idle, requested: requested)
  return HandoffView.text(from: v.from, to: v.to, outgoing: v.outgoing, state: v.state, idle: v.idle, requested: v.requested)
}

private func device(_ reachability: String, lastSeen: String? = nil, name: String = "Ben's MacBook Pro") throws -> Device {
  let seen = lastSeen.map { #""\#($0)""# } ?? "null"
  return try decode(
    Device.self, #"{"id":"\#(name)","name":"\#(name)","reachability":"\#(reachability)","dnsName":"pro.tail.ts.net","lastSeen":\#(seen)}"#)
}

/// handoffText in packages/shared/handoff.ts, case by case.
@Suite struct HandoffTextTests {
  @Test func saysEachPrepareStepOnTheGivingMac() throws {
    #expect(try text(#"{"phase":"preparing","step":"stopping"}"#) == "Handing off to Ben's MacBook Pro: stopping the turn here.")
    #expect(try text(#"{"phase":"preparing","step":"uploading"}"#) == "Handing off to Ben's MacBook Pro: uploading the session.")
    #expect(try text(#"{"phase":"preparing","step":"packing"}"#) == "Handing off to Ben's MacBook Pro: packing the worktree.")
    #expect(try text(#"{"phase":"preparing","step":"packing"}"#, outgoing: false) == "Ben's MacBook Air is handing this thread to this Mac.")
  }

  @Test func saysWhoIsWaitingOnWhom() throws {
    #expect(try text(#"{"phase":"offered","stale":false}"#) == "Waiting for Ben's MacBook Pro to pick it up.")
    #expect(
      try text(#"{"phase":"offered","stale":true}"#)
        == "Ben's MacBook Pro has not picked this thread up yet. It may be asleep or not running Omni.")
    #expect(try text(#"{"phase":"offered","stale":true}"#, outgoing: false) == "Picking this thread up from Ben's MacBook Air.")
  }

  @Test func saysWhereItRunsOnceTaken() throws {
    #expect(try text(#"{"phase":"accepted"}"#) == "Running on Ben's MacBook Pro. Handed off from this Mac.")
    #expect(try text(#"{"phase":"accepted"}"#, outgoing: false) == "Handed off from Ben's MacBook Air. Running on this Mac.")
  }

  @Test func saysTheNextMessageContinuesAThreadHandedOffBetweenTurns() throws {
    #expect(try text(#"{"phase":"accepted"}"#, idle: true) == "Handed off to Ben's MacBook Pro. Your next message continues it there.")
    #expect(try view(#"{"phase":"accepted"}"#).idle == false)
  }

  @Test func saysWhoAskedWhenTakenOver() throws {
    let accepted = #"{"phase":"accepted"}"#
    #expect(try text(accepted, requested: true) == "Ben's MacBook Pro took this thread over. Running there.")
    #expect(try text(accepted, outgoing: false, requested: true) == "Taken over from Ben's MacBook Air. Running on this Mac.")
    #expect(try text(accepted, idle: true, requested: true) == "Ben's MacBook Pro took this thread over. The next message runs there.")
    #expect(
      try text(accepted, outgoing: false, idle: true, requested: true) == "Taken over from Ben's MacBook Air. Your next message continues it here.")
  }

  @Test func saysATakeOverIsWaitingOnTheMacThatHoldsIt() throws {
    #expect(try text(#"{"phase":"requested","stale":false}"#, outgoing: false) == "Asking Ben's MacBook Air to hand this thread over.")
    #expect(
      try text(#"{"phase":"requested","stale":true}"#, outgoing: false)
        == "Ben's MacBook Air has not answered. It may be asleep; it hands the thread over when it wakes.")
    #expect(try text(#"{"phase":"expired"}"#, outgoing: false) == "Ben's MacBook Air did not answer within an hour, so the request expired.")
  }

  @Test func saysWhyATakeOverWasDeclinedOnBothMacs() throws {
    let declined = #"{"phase":"declined","error":"crew threads stay with their parent"}"#
    #expect(try text(declined) == "Ben's MacBook Pro asked for this thread, and it stays here: crew threads stay with their parent.")
    #expect(try text(declined, outgoing: false) == "Ben's MacBook Air kept this thread: crew threads stay with their parent.")
  }

  @Test func endsTheErrorWithOneFullStop() throws {
    let stopped = "The handoff to Ben's MacBook Pro failed: upload failed. The thread is stopped here; reply to continue it."
    #expect(try text(#"{"phase":"failed","error":"upload failed","where":"here"}"#) == stopped)
    #expect(try text(#"{"phase":"failed","error":"upload failed.","where":"there"}"#) == stopped, "the giving Mac says the same either way")
    #expect(
      try text(#"{"phase":"failed","error":"its worktree has changes","where":"there"}"#, outgoing: false)
        == "Could not pick this thread up from Ben's MacBook Air: its worktree has changes. It stays there.")
    #expect(
      try text(#"{"phase":"failed","error":"no session","where":"here"}"#, outgoing: false)
        == "Ben's MacBook Air could not hand this thread over: no session. It stays there.")
  }

  @Test func saysItWasCancelled() throws {
    #expect(try text(#"{"phase":"cancelled"}"#) == "The handoff to Ben's MacBook Pro was cancelled.")
    #expect(try text(#"{"phase":"cancelled"}"#, outgoing: false) == "The handoff to Ben's MacBook Pro was cancelled.")
  }
}

@Suite struct HandoffViewTests {
  @Test func decodesEachPhase() throws {
    #expect(try view(#"{"phase":"preparing","step":"uploading"}"#).state == .preparing(.uploading))
    #expect(try view(#"{"phase":"offered","stale":true}"#).state == .offered(stale: true))
    #expect(try view(#"{"phase":"accepted"}"#).state == .accepted)
    #expect(try view(#"{"phase":"failed","error":"x","where":"there"}"#).state == .failed(error: "x", at: .there))
    #expect(try view(#"{"phase":"cancelled"}"#).state == .cancelled)
    #expect(try view(#"{"phase":"requested","stale":true}"#).state == .requested(stale: true))
    #expect(try view(#"{"phase":"declined","error":"x"}"#).state == .declined(error: "x"))
    #expect(try view(#"{"phase":"expired"}"#).state == .expired)
    #expect(try view(#"{"phase":"accepted"}"#, requested: true).requested)
    #expect(try !view(#"{"phase":"accepted"}"#).requested, "older servers leave requested out")
    let left = try decode(HandoffView.self, handoffJSON(#"{"phase":"accepted"}"#, leftBehind: "~/phillbert has uncommitted changes"))
    #expect(left.leftBehind == "~/phillbert has uncommitted changes")
    #expect(left.from.name == "Ben's MacBook Air")
    #expect(left.outgoing)
  }

  @Test func isInFlightUntilTakenOrCalledOff() throws {
    #expect(try view(#"{"phase":"preparing","step":"stopping"}"#).inFlight)
    #expect(try view(#"{"phase":"offered","stale":true}"#).inFlight)
    #expect(try view(#"{"phase":"requested","stale":true}"#, outgoing: false).inFlight)
    #expect(try !view(#"{"phase":"declined","error":"x"}"#).inFlight)
    #expect(try !view(#"{"phase":"expired"}"#).inFlight)
    #expect(try !view(#"{"phase":"accepted"}"#).inFlight)
    #expect(try !view(#"{"phase":"failed","error":"x","where":"here"}"#).inFlight)
    #expect(try !view(#"{"phase":"cancelled"}"#).inFlight)
  }

  @Test func anOfferGoesStaleOnScreenOncePatienceRunsOut() throws {
    let v = try view(#"{"phase":"offered","stale":false}"#)
    #expect(v.text(now: v.at.addingTimeInterval(89)) == "Waiting for Ben's MacBook Pro to pick it up.")
    #expect(v.phase(now: v.at.addingTimeInterval(91)) == .offered(stale: true))
    #expect(v.text(now: v.at.addingTimeInterval(91)).hasPrefix("Ben's MacBook Pro has not picked this thread up yet."))
    let taken = try view(#"{"phase":"accepted"}"#)
    #expect(taken.phase(now: taken.at.addingTimeInterval(3_600)) == .accepted)
  }

  @Test func aTakeOverGoesStaleOnScreenToo() throws {
    let v = try view(#"{"phase":"requested","stale":false}"#, outgoing: false, requested: true)
    #expect(v.phase(now: v.at.addingTimeInterval(89)) == .requested(stale: false))
    #expect(v.phase(now: v.at.addingTimeInterval(91)) == .requested(stale: true))
    #expect(v.text(now: v.at.addingTimeInterval(91)).hasPrefix("Ben's MacBook Air has not answered."))
  }

  @Test func aThreadDetailCarriesItsBlockAndHandoff() throws {
    let d = try decode(
      ThreadDetail.self,
      #"{"thread":\#(threadJSON(status: "stopped")),"events":[],"blocked":"This thread is running on Ben's MacBook Pro.","handoff":\#(handoffJSON(#"{"phase":"accepted"}"#))}"#)
    #expect(d.blocked == "This thread is running on Ben's MacBook Pro.")
    #expect(d.handoff?.state == .accepted)
    let plain = try decode(ThreadDetail.self, #"{"thread":\#(threadJSON()),"events":[],"handoff":null}"#)
    #expect(plain.blocked == nil && plain.handoff == nil)
  }

  @Test func aPhaseThisAppDoesNotKnowLeavesTheThreadReadable() throws {
    let d = try decode(ThreadDetail.self, #"{"thread":\#(threadJSON()),"events":[],"handoff":\#(handoffJSON(#"{"phase":"teleporting"}"#))}"#)
    #expect(d.handoff == nil)
    #expect(d.thread.id == "t1")
    let m = try decode(ThreadStreamMessage.self, #"{"kind":"thread","thread":\#(threadJSON()),"handoff":\#(handoffJSON(#"{"phase":"teleporting"}"#))}"#)
    guard case .thread(let t, nil, nil, nil, nil, nil) = m else { Issue.record("the stream's thread message still reads: \(m)"); return }
    #expect(t.id == "t1")
  }

  @Test func theThreadStreamCarriesThemToo() throws {
    let m = try decode(
      ThreadStreamMessage.self,
      #"{"kind":"thread","thread":\#(threadJSON(status: "running")),"blocked":"Busy elsewhere.","handoff":\#(handoffJSON(#"{"phase":"preparing","step":"packing"}"#))}"#)
    guard case .thread(_, nil, nil, let blocked, let handoff, nil) = m else { Issue.record("not a thread: \(m)"); return }
    #expect(blocked == "Busy elsewhere.")
    #expect(handoff?.state == .preparing(.packing))
  }
}

@Suite struct TakeoverTests {
  @Test func decodesWhoHoldsItAndWhetherItCanBeTaken() throws {
    let t = try decode(Takeover.self, takeoverJSON())
    #expect((t.from.name, t.to.name) == ("Ben's MacBook Air", "Ben's MacBook Pro"))
    #expect(t.running && t.refused == nil)
    let refused = try decode(Takeover.self, takeoverJSON(running: false, refused: "Crew threads stay with their parent."))
    #expect(refused.refused == "Crew threads stay with their parent.")
  }

  /// takeoverNote and takeoverConfirm in packages/shared/handoff.ts.
  @Test func saysWhereItRunsAndWhatTakingItDoes() throws {
    let running = try decode(Takeover.self, takeoverJSON())
    #expect(running.note == "This thread is running on Ben's MacBook Air.")
    #expect(running.confirm.title == "Take over from Ben's MacBook Air?")
    #expect(
      running.confirm.body
        == "Ben's MacBook Air stops the current turn and hands the thread here. The agent continues on Ben's MacBook Pro where it was cut off.")
    let idle = try decode(Takeover.self, takeoverJSON(running: false))
    #expect(idle.note == "Last ran on Ben's MacBook Air.")
    #expect(idle.confirm.title == "Take over from Ben's MacBook Air?")
    #expect(idle.confirm.body == "Ben's MacBook Air sends its latest session and changes here. Your next message runs on Ben's MacBook Pro.")
  }

  @Test func theDetailAndTheStreamCarryIt() throws {
    let d = try decode(ThreadDetail.self, #"{"thread":\#(threadJSON(status: "running")),"events":[],"takeover":\#(takeoverJSON())}"#)
    #expect(d.takeover?.running == true)
    #expect(try decode(ThreadDetail.self, #"{"thread":\#(threadJSON()),"events":[]}"#).takeover == nil, "older servers leave it out")
    let m = try decode(ThreadStreamMessage.self, #"{"kind":"thread","thread":\#(threadJSON()),"takeover":\#(takeoverJSON(running: false))}"#)
    guard case .thread(_, nil, nil, nil, nil, let takeover) = m else { Issue.record("not a thread: \(m)"); return }
    #expect(takeover?.running == false)
  }

  @Test func oneThisAppCannotReadLeavesTheThreadReadable() throws {
    let d = try decode(ThreadDetail.self, #"{"thread":\#(threadJSON()),"events":[],"takeover":{"from":"Mac A"}}"#)
    #expect(d.takeover == nil)
    #expect(d.thread.id == "t1")
  }
}

/// handoffBanner in apps/web/src/handoff.ts.
@Suite struct HandoffBannerTests {
  private func banner(_ state: String, outgoing: Bool = true, status: ThreadStatus = .running) throws -> HandoffBanner? {
    let v = try view(state, outgoing: outgoing)
    return HandoffBanner(v, status: status, now: v.at)
  }

  @Test func aCardWithCancelOnlyOnTheGivingMacWhileTheOtherHasNotTakenIt() throws {
    #expect(try banner(#"{"phase":"preparing","step":"stopping"}"#) == .card(tone: .working, text: "Handing off to Ben's MacBook Pro: stopping the turn here.", cancel: true))
    #expect(try banner(#"{"phase":"preparing","step":"stopping"}"#, outgoing: false) == .card(tone: .working, text: "Ben's MacBook Air is handing this thread to this Mac.", cancel: false))
    #expect(try banner(#"{"phase":"offered","stale":false}"#) == .card(tone: .waiting, text: "Waiting for Ben's MacBook Pro to pick it up.", cancel: true))
    guard case .card(.alert, _, true)? = try banner(#"{"phase":"offered","stale":true}"#) else { Issue.record("a stale offer alerts"); return }
    #expect(try banner(#"{"phase":"offered","stale":false}"#, outgoing: false, status: .stopped) == .card(tone: .working, text: "Picking this thread up from Ben's MacBook Air.", cancel: false))
  }

  @Test func aTakeOverWaitsWithCancelAndAlertsOnceStale() throws {
    #expect(
      try banner(#"{"phase":"requested","stale":false}"#, outgoing: false)
        == .card(tone: .waiting, text: "Asking Ben's MacBook Air to hand this thread over.", cancel: true))
    guard case .card(.alert, _, true)? = try banner(#"{"phase":"requested","stale":true}"#, outgoing: false) else {
      Issue.record("a stale Take over alerts and can still be called off"); return
    }
  }

  @Test func aDeclinedOrExpiredTakeOverAlertsWithoutCancel() throws {
    guard case .card(.alert, _, false)? = try banner(#"{"phase":"declined","error":"x"}"#, outgoing: false) else {
      Issue.record("a declined Take over is an alert card"); return
    }
    guard case .card(.alert, _, false)? = try banner(#"{"phase":"declined","error":"x"}"#, status: .running) else {
      Issue.record("the holding Mac says so while its turn runs on"); return
    }
    #expect(
      try banner(#"{"phase":"expired"}"#, outgoing: false, status: .stopped)
        == .card(tone: .alert, text: "Ben's MacBook Air did not answer within an hour, so the request expired.", cancel: false))
  }

  @Test func aFailureShowsUntilTheThreadRunsAgain() throws {
    guard case .card(.alert, _, false)? = try banner(#"{"phase":"failed","error":"x","where":"here"}"#, status: .stopped) else {
      Issue.record("a failure is an alert card"); return
    }
    #expect(try banner(#"{"phase":"failed","error":"x","where":"here"}"#, status: .running) == nil)
    #expect(try banner(#"{"phase":"failed","error":"x","where":"here"}"#, status: .queued) == nil)
  }

  @Test func oneQuietLineOnceSettled() throws {
    #expect(try banner(#"{"phase":"accepted"}"#, status: .stopped) == .line(tone: .done, text: "Running on Ben's MacBook Pro. Handed off from this Mac."))
    #expect(try banner(#"{"phase":"cancelled"}"#, status: .running) == .line(tone: .cancelled, text: "The handoff to Ben's MacBook Pro was cancelled."))
    #expect(HandoffBanner(nil, status: .running) == nil)
  }
}

@Suite struct DeviceTests {
  @Test func refusesOnlyAMacTailscaleKnowsIsAway() throws {
    #expect(try device("online").canTake)
    #expect(try device("unknown").canTake)
    #expect(try !device("offline").canTake)
    #expect(try device("someday").canTake, "a reachability this app does not know is not a refusal")
  }

  @Test func labelsReachability() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Europe/Amsterdam")!
    let now = try #require(OmniJSON.parseDate("2026-10-23T12:00:00.000Z"))
    #expect(try device("online").reachabilityLabel(now: now, calendar: calendar) == "Online on Tailscale")
    #expect(try device("unknown").reachabilityLabel(now: now, calendar: calendar) == "Can't check Tailscale")
    #expect(try device("offline").reachabilityLabel(now: now, calendar: calendar) == "Asleep or offline")
    #expect(
      try device("offline", lastSeen: "2026-10-23T11:40:00.000Z").reachabilityLabel(now: now, calendar: calendar)
        == "Asleep or offline, last seen 20m ago")
    #expect(
      try device("offline", lastSeen: "2026-10-22T16:05:00.000Z").reachabilityLabel(now: now, calendar: calendar)
        == "Asleep or offline, last seen Yesterday 18:05")
  }

  @Test func listsOnlineMacsFirstThenUnknownThenAsleep() throws {
    let list = try [
      device("offline", name: "Attic Mini"), device("unknown", name: "Studio"), device("online", name: "Pro"),
      device("unknown", name: "Air"), device("online", name: "iMac"),
    ]
    #expect(Device.picker(list).map(\.name) == ["iMac", "Pro", "Air", "Studio", "Attic Mini"])
  }
}

@Suite struct HandoffClientTests {
  @Test func handsOffCancelsAndListsDevices() async throws {
    let answer = #"{"thread":\#(threadJSON(status: "running")),"handoff":\#(handoffJSON(#"{"phase":"preparing","step":"stopping"}"#))}"#
    let t = StubTransport { req in
      StubTransport.Reply(body: req.url!.path == "/api/devices" ? "[]" : answer)
    }
    let client = OmniClient(port: 4799, transport: t)
    let a = try await client.handOff("t 1", to: "m-pro")
    #expect(a.handoff?.state == .preparing(.stopping))
    #expect(a.thread.status == .running)
    _ = try await client.cancelHandoff("t 1")
    #expect(try await client.devices().isEmpty)
    #expect(t.requests.map { "\($0.httpMethod!) \($0.url!.absoluteString.replacingOccurrences(of: "http://127.0.0.1:4799", with: ""))" } == [
      "POST /api/threads/t%201/handoff",
      "POST /api/threads/t%201/handoff/cancel",
      "GET /api/devices",
    ])
    #expect(try bodyJSON(t.requests[0]) == .object(["to": .string("m-pro")]))
  }

  @Test func takesOverWithAnEmptyBody() async throws {
    let requested = handoffJSON(#"{"phase":"requested","stale":false}"#, outgoing: false, requested: true)
    let t = StubTransport { _ in StubTransport.Reply(body: #"{"thread":\#(threadJSON(status: "running")),"handoff":\#(requested)}"#) }
    let client = OmniClient(port: 4799, transport: t)
    let a = try await client.takeOver("t 1")
    #expect(a.handoff?.state == .requested(stale: false))
    #expect(a.handoff?.requested == true)
    #expect(t.requests.map { "\($0.httpMethod!) \($0.url!.absoluteString.replacingOccurrences(of: "http://127.0.0.1:4799", with: ""))" } == [
      "POST /api/threads/t%201/takeover"
    ])
    #expect(try bodyJSON(t.requests[0]) == .object([:]))
  }
}

/// GET /api/sync/status and /api/devices, answering with whatever the test set last.
private final class FakeDevicesAPI: DevicesAPI {
  private struct State {
    var sync = (configured: true, enabled: true, signedOut: false)
    var devices: Result<[Device], OmniAPIError> = .success([])
  }
  private let state = Mutex(State())

  func set(configured: Bool = true, enabled: Bool = true, signedOut: Bool = false, devices: Result<[Device], OmniAPIError>) {
    state.withLock {
      $0.sync = (configured, enabled, signedOut)
      $0.devices = devices
    }
  }

  func syncStatus() async throws(OmniAPIError) -> SyncStatus {
    let s = state.withLock { $0.sync }
    return try! decode(
      SyncStatus.self,
      #"{"configured":\#(s.configured),"enabled":\#(s.enabled),"running":false,"machineId":"m-air","lastSyncAt":null,"lastError":null,"signedOut":\#(s.signedOut),"failures":0,"nextSyncAt":null,"pending":0,"held":0,"deferred":0,"cursor":0}"#)
  }

  func devices() async throws(OmniAPIError) -> [Device] {
    try state.withLock { $0.devices }.get()
  }
}

@MainActor @Suite struct DevicesModelTests {
  @Test func listsTheOtherMacsOnlyWhileSyncIsOn() async throws {
    let api = FakeDevicesAPI()
    let model = DevicesModel()
    model.connect(api: api)
    api.set(devices: .success([try device("online")]))
    await model.refresh()
    #expect(model.devices.map(\.name) == ["Ben's MacBook Pro"])

    api.set(devices: .failure(.unreachable("down")))
    await model.refresh()
    #expect(model.devices.count == 1, "a failed ask keeps the list")

    api.set(enabled: false, devices: .success([try device("online")]))
    await model.refresh()
    #expect(model.devices.isEmpty, "paused sync cannot carry an offer")

    api.set(configured: false, devices: .success([try device("online")]))
    await model.refresh()
    #expect(model.devices.isEmpty)

    api.set(signedOut: true, devices: .success([try device("online")]))
    await model.refresh()
    #expect(model.devices.isEmpty, "a Mac the relay signed out cannot send an offer")
  }

  @Test func offersNothingWithoutAThreadThatCanGo() async throws {
    let api = FakeDevicesAPI()
    let model = DevicesModel()
    model.connect(api: api)
    api.set(devices: .success([try device("online")]))
    await model.refresh()
    #expect(model.targets(nil) == nil)
    model.connect(api: api)
    #expect(model.devices.isEmpty, "a new connection starts empty")
  }
}
