import Foundation
import Testing
@testable import OmniKit

// A channel's named actions and their runs (packages/shared/channel-actions.ts, apps/server/actions-api.ts), on the
// recorded fixtures and on JSON in the same shape.

private func runJSON(
  state: String = "failed", port: String = "null", exitCode: String = "1", output: String = "1 failing\\n", bytes: Int = 10,
  ended: String = #""2026-01-05T09:00:12.000Z""#
) -> String {
  """
  {"id":"r1","thread_id":"t1","action_id":"a1","name":"Tests","command":"npm test","cwd":"/tmp/acme","port":\(port),
   "state":"\(state)","exit_code":\(exitCode),"error":null,"output":"\(output)","output_bytes":\(bytes),
   "started_at":"2026-01-05T09:00:00.000Z","ended_at":\(ended)}
  """
}

private func run(_ json: String) throws -> ActionRun { try decode(ActionRun.self, json) }

private func encoded(_ input: ChannelActionInput) throws -> JSONValue {
  try JSONDecoder().decode(JSONValue.self, from: try OmniJSON.encoder().encode(input))
}

@Suite struct ChannelActionsFixtureTests {
  @Test func readsTheChannelsActions() throws {
    let list = try decodeFixture([ChannelAction].self, "channel-actions.json")
    #expect(list.map(\.name) == ["Theme check", "Theme preview", "Tests"])
    #expect(list.map(\.port) == [nil, 0, nil])
    #expect(list.map(\.position) == [0, 1, 2])
    #expect(list.map(\.setup) == [.background, nil, nil])
    #expect(list.allSatisfy { $0.channelID == "acme" && $0.secrets.isEmpty })
    let one = try decodeFixture(ChannelAction.self, "channel-action.json")
    #expect(one == list[0])
  }

  @Test func readsAThreadsActionsAndRuns() throws {
    let t = try decodeFixture(ThreadActions.self, "thread-actions.json")
    #expect(t.blocked == nil)
    #expect(t.actions.count == 3)
    #expect(t.setupRun == nil && t.backgroundSetupRun == nil)
    #expect(t.setupAction?.name == "Theme check")
    #expect(t.runs.map(\.state) == [.running, .stopped, .failed, .succeeded])
    #expect(t.runs.map(\.exitCode) == [nil, nil, 1, 0])
    #expect(t.keepPolling)
    #expect(t.running(t.actions[1])?.id == "00000000-0000-4000-8000-000000000041")
    #expect(t.running(t.actions[0]) == nil && t.running(t.actions[2]) == nil)
  }

  @Test func readsARunAndItsStop() throws {
    let started = try decodeFixture(ActionRun.self, "action-run.json")
    #expect(started.state == .running && started.port == 4799 && started.endedAt == nil && started.output.isEmpty)
    let stopped = try decodeFixture(ActionRun.self, "action-run-stopped.json")
    #expect(stopped.id == started.id && stopped.state == .stopped)
    #expect(stopped.error == "Stopped by Ben." && stopped.exitCode == nil && stopped.endedAt != nil)
    #expect(stopped.summary() == "Port 4799 · 0s")
    #expect(!stopped.outputWasCut && stopped.outputNote == nil)
  }

  @Test func encodesTheRecordedRequest() throws {
    let input = ChannelActionInput(name: "Theme check", command: #"echo "Theme check passed""#, setup: .background)
    #expect(try encoded(input) == (try decodeFixture(JSONValue.self, "channel-action-request.json")))
  }
}

@Suite struct ChannelActionsTests {
  @Test func sendsPortAsNullOrANumber() throws {
    #expect(try encoded(ChannelActionInput(name: "a", command: "b"))["port"] == .null)
    #expect(try encoded(ChannelActionInput(name: "a", command: "b", port: 0))["port"] == .number(0))
    #expect(try encoded(ChannelActionInput(name: "a", command: "b", secrets: ["X"], port: 9292))["port"] == .number(9292))
  }

  @Test func sendsSetupAsNullOrAMode() throws {
    #expect(try encoded(ChannelActionInput(name: "a", command: "b"))["setup"] == .null)
    #expect(try encoded(ChannelActionInput(name: "a", command: "b", setup: .blocking))["setup"] == .string("blocking"))
    #expect([SetupMode.blocking, .background].map(\.label) == ["Before the agent starts", "Alongside the agent"])
  }

  @Test func readsTheSetupRun() throws {
    let json = #"{"actions":[],"runs":[\#(runJSON(state: "running", exitCode: "null", ended: "null"))],"blocked":null,"setup_run":\#(runJSON(state: "running", exitCode: "null", ended: "null"))}"#
    let t = try decode(ThreadActions.self, json)
    #expect(t.setupRun?.id == "r1" && t.setupRun?.state == .running)
    #expect(t.backgroundSetupRun?.id == "r1")
    #expect(t.keepPolling)
    let failed = try decode(ThreadActions.self, #"{"actions":[],"runs":[],"blocked":null,"setup_run":\#(runJSON())}"#)
    #expect(failed.backgroundSetupRun?.exitCode == 1 && !failed.keepPolling)
    for state in ["succeeded", "stopped"] {
      let done = try decode(ThreadActions.self, #"{"actions":[],"runs":[],"blocked":null,"setup_run":\#(runJSON(state: state))}"#)
      #expect(done.backgroundSetupRun == nil)
    }
  }

  @Test func labelsStatesAndPorts() {
    #expect([ActionRunState.running, .succeeded, .failed, .stopped].map(\.label) == ["Running", "Succeeded", "Failed", "Stopped"])
    #expect(ActionRunState(rawValue: "paused").label == "Paused")
    #expect(ChannelActions.portLabel(nil) == "No port")
    #expect(ChannelActions.portLabel(0) == "A free port per run")
    #expect(ChannelActions.portLabel(9292) == "Port 9292")
  }

  @Test func summarizesARun() throws {
    #expect(try run(runJSON(port: "9301")).summary() == "Port 9301 · 12s · exit 1")
    #expect(try run(runJSON(state: "succeeded", exitCode: "0")).summary() == "12s · exit 0")
    let live = try run(runJSON(state: "running", port: "9300", exitCode: "null", ended: "null"))
    let now = live.startedAt.addingTimeInterval(75)
    #expect(live.summary(now: now) == "Port 9300 · 1m 15s")
    #expect(live.summary(now: live.startedAt.addingTimeInterval(-5)) == "Port 9300 · 0s")
  }

  @Test func saysWhenTheStartOfTheOutputWasCut() throws {
    let full = String(repeating: "x", count: ChannelActions.outputLimit)
    let cut = try run(runJSON(output: full, bytes: 1_300_000))
    #expect(cut.outputWasCut)
    #expect(cut.outputNote == "Showing the last 64 KB of 1.2 MB")
    // Colour codes count as printed bytes but are not kept: a short coloured output was not cut.
    #expect(!(try run(runJSON(output: "ok", bytes: 40))).outputWasCut)
    #expect(!(try run(runJSON(output: full, bytes: ChannelActions.outputLimit))).outputWasCut)
  }

  @Test func pollsOnlyWhileARunRuns() throws {
    let idle = try decode(ThreadActions.self, #"{"actions":[],"runs":[\#(runJSON())],"blocked":"The worktree is being prepared."}"#)
    #expect(!idle.keepPolling && idle.blocked == "The worktree is being prepared.")
    let busy = try decode(ThreadActions.self, #"{"actions":[],"runs":[\#(runJSON(state: "running", exitCode: "null", ended: "null"))],"blocked":null}"#)
    #expect(busy.keepPolling)
  }
}

@Suite struct PreparationStepTests {
  private let action = try! decodeFixture([ChannelAction].self, "channel-actions.json")[0]

  private func describe(_ steps: [PreparationStep]) -> [String] {
    steps.map { "\($0.title) \($0.state)" }
  }

  @Test func checksOutThenSetsUpThenStartsTheAgent() throws {
    #expect(describe(PreparationStep.steps(setup: .preparing, action: action, run: nil)) == [
      "Checkout active", "Setup \"Theme check\" waiting", "Agent waiting",
    ])
    let running = try run(runJSON(state: "running", exitCode: "null", ended: "null"))
    let steps = PreparationStep.steps(setup: .preparing, action: action, run: running)
    #expect(describe(steps) == ["Checkout done", "Setup \"Tests\" active", "Agent waiting"])
    #expect(steps[1].detail == "Alongside the agent")
    let passed = try run(runJSON(state: "succeeded", exitCode: "0"))
    #expect(describe(PreparationStep.steps(setup: .preparing, action: action, run: passed)) == [
      "Checkout done", "Setup \"Tests\" done", "Agent active",
    ])
  }

  @Test func leavesOutSetupWhenTheChannelHasNone() {
    #expect(describe(PreparationStep.steps(setup: .preparing, action: nil, run: nil)) == ["Checkout active", "Agent waiting"])
    #expect(describe(PreparationStep.steps(setup: .failed, action: nil, run: nil)) == ["Checkout failed", "Agent waiting"])
  }

  @Test func marksTheStepAFailedPreparationEndedOn() throws {
    #expect(describe(PreparationStep.steps(setup: .failed, action: action, run: try run(runJSON()))) == [
      "Checkout done", "Setup \"Tests\" failed", "Agent waiting",
    ])
    #expect(PreparationStep.steps(setup: .failed, action: action, run: try run(runJSON()))[1].detail == nil)
    #expect(describe(PreparationStep.steps(setup: .failed, action: action, run: try run(runJSON(state: "stopped")))) == [
      "Checkout done", "Setup \"Tests\" failed", "Agent waiting",
    ])
    #expect(describe(PreparationStep.steps(setup: .failed, action: action, run: nil)) == [
      "Checkout failed", "Setup \"Theme check\" waiting", "Agent waiting",
    ])
    #expect(PreparationStep.steps(setup: nil, action: action, run: nil).allSatisfy { $0.state == .done })
  }
}

@Suite struct ChannelActionDraftTests {
  @Test func upperCasesSecretsAsTyped() {
    var d = ChannelActionDraft()
    d.secrets = "shopify_cli_theme_token, figma_token  extra"
    #expect(d.secrets == "SHOPIFY_CLI_THEME_TOKEN, FIGMA_TOKEN  EXTRA")
    #expect(d.secretNames == ["SHOPIFY_CLI_THEME_TOKEN", "FIGMA_TOKEN", "EXTRA"])
    d.secrets = " , "
    #expect(d.secretNames.isEmpty)
  }

  @Test func turnsThePortChoiceIntoTheBody() {
    var d = ChannelActionDraft()
    d.name = "Theme preview"
    d.command = "shopify theme dev --port $OMNI_PORT"
    #expect(d.input == ChannelActionInput(name: "Theme preview", command: "shopify theme dev --port $OMNI_PORT", port: nil))
    d.portMode = .free
    #expect(d.input?.port == 0)
    d.portMode = .fixed
    #expect(d.input == nil)
    d.fixedPort = " 9292 "
    #expect(d.input?.port == 9292)
    d.fixedPort = "92a"
    #expect(d.input == nil)
    d.fixedPort = "0"
    #expect(d.input == nil)
  }

  @Test func startsFromAnAction() throws {
    let list = try decodeFixture([ChannelAction].self, "channel-actions.json")
    let preview = ChannelActionDraft(list[1])
    #expect(preview.portMode == .free && preview.fixedPort.isEmpty && preview.name == "Theme preview")
    let fixed = ChannelActionDraft(try decode(ChannelAction.self, """
      {"id":"a","channel_id":"acme","name":"Dev","command":"x --port 9292","secrets":["A_TOKEN","B"],"port":9292,
       "position":0,"created_at":"2026-01-05T09:00:00.000Z","updated_at":"2026-01-05T09:00:00.000Z"}
      """))
    #expect(fixed.portMode == .fixed && fixed.fixedPort == "9292")
    #expect(fixed.secrets == "A_TOKEN, B")
    #expect(fixed.input == ChannelActionInput(name: "Dev", command: "x --port 9292", secrets: ["A_TOKEN", "B"], port: 9292))
    #expect(ChannelActionDraft(list[0]).portMode == .none)
    #expect(ChannelActionDraft(list[0]).setup == .background && ChannelActionDraft(list[0]).input?.setup == .background)
    #expect(preview.setup == nil && preview.input?.setup == nil)
  }
}

@Suite struct ChannelActionsClientTests {
  @Test func managesAChannelsActions() async throws {
    let t = StubTransport { req in
      switch req.httpMethod {
      case "DELETE": .init(body: #"{"ok":true}"#)
      case "GET": .init(body: try fixture("channel-actions.json"))
      default: .init(status: req.httpMethod == "POST" ? 201 : 200, body: try fixture("channel-action.json"))
      }
    }
    let client = OmniClient(port: 4799, transport: t)
    let input = ChannelActionInput(name: "Theme check", command: #"echo "Theme check passed""#, setup: .background)
    #expect(try await client.channelActions("a b").count == 3)
    #expect(try await client.createChannelAction("acme", input).name == "Theme check")
    _ = try await client.updateChannelAction("acme", action: "x/1", input)
    try await client.deleteChannelAction("acme", action: "x1")
    let r = t.requests
    #expect(r.map { $0.httpMethod ?? "" } == ["GET", "POST", "PATCH", "DELETE"])
    #expect(r.map { $0.url?.path(percentEncoded: true) ?? "" } == [
      "/api/channels/a%20b/actions", "/api/channels/acme/actions", "/api/channels/acme/actions/x%2F1",
      "/api/channels/acme/actions/x1",
    ])
    #expect(try bodyJSON(r[1]) == (try decodeFixture(JSONValue.self, "channel-action-request.json")))
    #expect(try bodyJSON(r[2]) == (try bodyJSON(r[1])))
  }

  @Test func runsStopsAndRetriesInAThread() async throws {
    let t = StubTransport { req in
      if req.httpMethod == "GET" { return .init(body: try fixture("thread-actions.json")) }
      let stop = req.url?.path.hasSuffix("/stop") == true
      return .init(status: stop ? 200 : 201, body: try fixture(stop ? "action-run-stopped.json" : "action-run.json"))
    }
    let client = OmniClient(port: 4799, transport: t)
    #expect(try await client.threadActions("t1").runs.count == 4)
    #expect(try await client.runAction("a1", thread: "t1").state == .running)
    #expect(try await client.stopActionRun("r1", thread: "t1")?.state == .stopped)
    #expect(try await client.retryActionRun("r1", thread: "t1").state == .running)
    #expect(t.requests.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" } == [
      "GET /api/threads/t1/actions", "POST /api/threads/t1/actions/a1/run", "POST /api/threads/t1/action-runs/r1/stop",
      "POST /api/threads/t1/action-runs/r1/retry",
    ])
  }

  @Test func passesOnTheServersRefusal() async throws {
    let t = StubTransport(status: 409, body: #"{"error":"Port 9292 is taken by Theme preview in another thread."}"#)
    await #expect(throws: OmniAPIError.http(status: 409, message: "Port 9292 is taken by Theme preview in another thread.")) {
      _ = try await OmniClient(port: 4799, transport: t).runAction("a1", thread: "t1")
    }
  }
}
