import Foundation
import Testing
@testable import OmniKit

private func machine(_ id: String, _ reachability: String = "online") throws -> Device {
  try decode(Device.self, #"{"id":"\#(id)","name":"\#(id)","reachability":"\#(reachability)","dnsName":null,"lastSeen":null}"#)
}

/// GET /api/setup with `runOn.device` set, or without `runOn` as a server from before run-on sends it.
private func setupState(device: String?) -> String {
  guard let device else { return SetupTests.state }
  return SetupTests.state.replacingOccurrences(of: #""automations":{}"#, with: #""runOn":{"device":"\#(device)"},"automations":{}"#)
}

@Suite struct RunOnRulesTests {
  @Test func keepsTheSavedMachineWhileOffline() throws {
    let box = try machine("omarchy")
    let asleep = try machine("mini", "offline")
    let unsure = try machine("studio", "unknown")
    #expect(RunOnRules.resolved("omarchy", devices: [box, asleep]) == "omarchy")
    #expect(RunOnRules.resolved("studio", devices: [unsure]) == "studio", "Tailscale can't tell: the server decides")
    #expect(RunOnRules.resolved("", devices: [box]) == "")
    #expect(RunOnRules.resolved("gone", devices: [box]) == "", "a machine sync no longer lists")
    #expect(RunOnRules.resolved("mini", devices: [box, asleep]) == "mini", "keep the target so the server refuses the send")
    #expect(RunOnRules.resolved("omarchy", devices: []) == "")
  }

  @Test func sendsHereOrTheIdOnlyWhileThereIsAChoice() throws {
    let box = try machine("omarchy")
    #expect(RunOnRules.sent("", devices: [box]) == "here")
    #expect(RunOnRules.sent("omarchy", devices: [box]) == "omarchy")
    #expect(RunOnRules.sent("", devices: []) == nil, "no picker: the server's default")
  }

  @Test func namesThePick() throws {
    let box = try machine("omarchy")
    #expect(RunOnRules.label("", devices: [box]) == "This Mac")
    #expect(RunOnRules.label("omarchy", devices: [box]) == "omarchy")
    #expect(RunOnRules.label("gone", devices: [box]) == "This Mac", "the server runs a machine sync dropped here")
  }

  @Test func newThreadCarriesTheDeviceOnlyWhenSet() throws {
    let here = NewThread(channel: "acme", prompt: "Fix", device: "here")
    #expect(try JSONDecoder().decode(JSONValue.self, from: try OmniJSON.encoder().encode(here))
      == .object(["channel": .string("acme"), "prompt": .string("Fix"), "device": .string("here")]))
    let unset = NewThread(channel: "acme", prompt: "Fix")
    #expect(try JSONDecoder().decode(JSONValue.self, from: try OmniJSON.encoder().encode(unset))
      == .object(["channel": .string("acme"), "prompt": .string("Fix")]))
  }
}

@MainActor @Suite struct RunOnModelTests {
  @Test func readsTheSavedDefaultAndAnOlderServerMeansThisMac() async throws {
    let model = RunOnModel()
    model.connect(api: OmniClient(port: 4799, transport: StubTransport(body: setupState(device: "omarchy"))))
    await model.load()
    #expect(model.saved == "omarchy")

    model.connect(api: OmniClient(port: 4799, transport: StubTransport(body: setupState(device: nil))))
    #expect(model.saved == "", "a new connection starts on this Mac")
    await model.load()
    #expect(model.saved == "")
  }

  @Test func savesOnlyTheRunOnSection() async throws {
    let t = StubTransport(body: setupState(device: "omarchy"))
    let model = RunOnModel()
    model.connect(api: OmniClient(port: 4799, transport: t))
    await model.save("omarchy")
    #expect(model.saved == "omarchy")
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "PUT")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/setup")
    #expect(try bodyJSON(req) == .object(["runOn": .object(["device": .string("omarchy")])]))
  }

  @Test func aRefusedSaveKeepsTheOldDefaultAndSaysWhy() async {
    let model = RunOnModel()
    model.connect(api: OmniClient(port: 4799, transport: StubTransport(status: 400, body: #"{"error":"Pick a synced machine, or this one."}"#)))
    await model.save("bad id")
    #expect(model.saved == "")
    #expect(model.error == "Pick a synced machine, or this one.")
  }
}

@MainActor private final class RecordingNewThreadAPI: NewThreadAPI {
  var sent: [NewThread] = []
  nonisolated func createThread(_ new: NewThread, files: [UploadFile]) async throws(OmniAPIError) -> OmniThread {
    await MainActor.run { self.sent.append(new) }
    return try! OmniJSON.decoder().decode(OmniThread.self, from: Data(threadJSON(status: "running").utf8))
  }
}

@MainActor @Suite struct RunOnComposerTests {
  private func make(_ api: RecordingNewThreadAPI, _ dir: TempDir) -> NewThreadComposerModel {
    NewThreadComposerModel(fixedChannel: "acme", api: api, drafts: DraftStore(directory: dir.url))
  }

  @Test func followsTheSavedDefaultUntilBenPicks() throws {
    let dir = TempDir("runon")
    defer { dir.remove() }
    let m = make(RecordingNewThreadAPI(), dir)
    let box = try machine("omarchy")
    let mini = try machine("mini")
    m.updateRunOn(devices: [], saved: "omarchy")
    #expect(m.runOn == "", "not listed yet: this Mac")
    m.updateRunOn(devices: [box, mini], saved: "omarchy")
    #expect(m.runOn == "omarchy")
    m.selectRunOn("")
    m.updateRunOn(devices: [box, mini], saved: "mini")
    #expect(m.runOn == "", "a pick wins over the default")
    m.selectRunOn("mini")
    m.updateRunOn(devices: [box, try machine("mini", "offline")], saved: "omarchy")
    #expect(m.runOn == "mini", "keep an offline pick until Ben changes it")
  }

  @Test func refusesAnOfflinePick() throws {
    let dir = TempDir("runon")
    defer { dir.remove() }
    let m = make(RecordingNewThreadAPI(), dir)
    m.updateRunOn(devices: [try machine("mini", "offline")], saved: "")
    m.selectRunOn("mini")
    #expect(m.runOn == "")
  }

  @Test func sendsThePickWhileThereIsAChoice() async throws {
    let dir = TempDir("runon")
    defer { dir.remove() }
    let api = RecordingNewThreadAPI()
    let m = make(api, dir)
    m.text = "No choice"
    _ = await m.send()
    m.updateRunOn(devices: [try machine("omarchy")], saved: "omarchy")
    m.text = "On the box"
    _ = await m.send()
    m.selectRunOn("")
    m.text = "Here"
    _ = await m.send()
    #expect(api.sent.map(\.device) == [nil, "omarchy", "here"])
  }
}
