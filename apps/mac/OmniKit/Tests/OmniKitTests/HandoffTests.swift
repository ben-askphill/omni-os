import Foundation
import Synchronization
import Testing
import OmniKit

private let air = #"{"id":"m-air","name":"Ben's MacBook Air"}"#
private let pro = #"{"id":"m-pro","name":"Ben's MacBook Pro"}"#

func handoffJSON(_ state: String, outgoing: Bool = true, at: String = "2026-10-23T09:00:00.000Z", leftBehind: String? = nil) -> String {
  let left = leftBehind.map { #""\#($0)""# } ?? "null"
  return #"{"id":"o1","from":\#(air),"to":\#(pro),"outgoing":\#(outgoing),"at":"\#(at)","state":\#(state),"leftBehind":\#(left)}"#
}

private func view(_ state: String, outgoing: Bool = true) throws -> HandoffView {
  try decode(HandoffView.self, handoffJSON(state, outgoing: outgoing))
}

private func text(_ state: String, outgoing: Bool = true) throws -> String {
  let v = try view(state, outgoing: outgoing)
  return HandoffView.text(from: v.from, to: v.to, outgoing: v.outgoing, state: v.state)
}

private func device(_ reachability: String, lastSeen: String? = nil) throws -> Device {
  let seen = lastSeen.map { #""\#($0)""# } ?? "null"
  return try decode(
    Device.self, #"{"id":"m-pro","name":"Ben's MacBook Pro","reachability":"\#(reachability)","dnsName":"pro.tail.ts.net","lastSeen":\#(seen)}"#)
}

/// handoffText in packages/shared/handoff.ts, case by case.
@Suite struct HandoffTextTests {
  @Test func saysEachPrepareStepFromEitherMac() throws {
    #expect(try text(#"{"phase":"preparing","step":"stopping"}"#) == "Handing off to Ben's MacBook Pro: stopping the turn here.")
    #expect(try text(#"{"phase":"preparing","step":"uploading"}"#) == "Handing off to Ben's MacBook Pro: uploading the session.")
    #expect(try text(#"{"phase":"preparing","step":"packing"}"#, outgoing: false) == "Handing off to Ben's MacBook Pro: packing the worktree.")
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

  @Test func endsTheErrorWithOneFullStop() throws {
    let stopped = "The handoff to Ben's MacBook Pro failed: upload failed. The thread is stopped here; reply to continue it."
    #expect(try text(#"{"phase":"failed","error":"upload failed","where":"here"}"#) == stopped)
    #expect(try text(#"{"phase":"failed","error":"upload failed.","where":"there"}"#) == stopped, "the giving Mac says the same either way")
    #expect(
      try text(#"{"phase":"failed","error":"its worktree has changes","where":"there"}"#, outgoing: false)
        == "Could not pick this thread up from Ben's MacBook Air: its worktree has changes.")
    #expect(
      try text(#"{"phase":"failed","error":"no session","where":"here"}"#, outgoing: false)
        == "The handoff to Ben's MacBook Pro failed: no session. The thread is stopped here; reply to continue it.")
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
    let left = try decode(HandoffView.self, handoffJSON(#"{"phase":"accepted"}"#, leftBehind: "~/phillbert has uncommitted changes"))
    #expect(left.leftBehind == "~/phillbert has uncommitted changes")
    #expect(left.from.name == "Ben's MacBook Air")
    #expect(left.outgoing)
  }

  @Test func isInFlightUntilTakenOrCalledOff() throws {
    #expect(try view(#"{"phase":"preparing","step":"stopping"}"#).inFlight)
    #expect(try view(#"{"phase":"offered","stale":true}"#).inFlight)
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
  }

  @Test func theThreadStreamCarriesThemToo() throws {
    let m = try decode(
      ThreadStreamMessage.self,
      #"{"kind":"thread","thread":\#(threadJSON(status: "running")),"blocked":"Busy elsewhere.","handoff":\#(handoffJSON(#"{"phase":"preparing","step":"packing"}"#))}"#)
    guard case .thread(_, nil, nil, let blocked, let handoff) = m else { Issue.record("not a thread: \(m)"); return }
    #expect(blocked == "Busy elsewhere.")
    #expect(handoff?.state == .preparing(.packing))
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
    #expect(try device("online").reachabilityLabel(now: now, calendar: calendar) == "Online")
    #expect(try device("unknown").reachabilityLabel(now: now, calendar: calendar) == "Can't check Tailscale")
    #expect(try device("offline").reachabilityLabel(now: now, calendar: calendar) == "Offline")
    #expect(
      try device("offline", lastSeen: "2026-10-23T11:40:00.000Z").reachabilityLabel(now: now, calendar: calendar)
        == "Offline, last seen 20m ago")
    #expect(
      try device("offline", lastSeen: "2026-10-22T16:05:00.000Z").reachabilityLabel(now: now, calendar: calendar)
        == "Offline, last seen yesterday 18:05")
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
}

/// GET /api/sync/status and /api/devices, answering with whatever the test set last.
private final class FakeDevicesAPI: DevicesAPI {
  private struct State {
    var sync = (configured: true, enabled: true)
    var devices: Result<[Device], OmniAPIError> = .success([])
  }
  private let state = Mutex(State())

  func set(configured: Bool = true, enabled: Bool = true, devices: Result<[Device], OmniAPIError>) {
    state.withLock {
      $0.sync = (configured, enabled)
      $0.devices = devices
    }
  }

  func syncStatus() async throws(OmniAPIError) -> SyncStatus {
    let s = state.withLock { $0.sync }
    return try! decode(
      SyncStatus.self,
      #"{"configured":\#(s.configured),"enabled":\#(s.enabled),"running":false,"machineId":"m-air","lastSyncAt":null,"lastError":null,"signedOut":false,"failures":0,"nextSyncAt":null,"pending":0,"held":0,"deferred":0,"cursor":0}"#)
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
