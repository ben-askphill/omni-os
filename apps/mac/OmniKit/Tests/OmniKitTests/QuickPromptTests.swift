import Foundation
import Testing
@testable import OmniKit

private struct FakeAPI: QuickPromptAPI {
  var result: Result<OmniThread, OmniAPIError>
  let seen = Seen()

  final class Seen: @unchecked Sendable {
    var threads: [NewThread] = []
  }

  func createThread(_ new: NewThread) async throws(OmniAPIError) -> OmniThread {
    seen.threads.append(new)
    return try result.get()
  }
}

private func created() throws -> OmniThread {
  try OmniJSON.decoder().decode(OmniThread.self, from: Data(try fixture("thread-created.json").utf8))
}

@MainActor
@Suite struct QuickPromptModelTests {
  @Test func sendsToTheConductorAsTheConductorMarkedAsACapture() async throws {
    let model = QuickPromptModel()
    model.text = "  check the Volero import run  \n"
    let api = FakeAPI(result: .success(try created()))
    let thread = await model.send(api)
    #expect(thread?.title == "Fix the cart")
    #expect(api.seen.threads == [
      NewThread(channel: "conductor", prompt: "check the Volero import run", role: "conductor", source: .capture)
    ])
    #expect(model.text.isEmpty)
    #expect(model.phase == .sent(try created()))
  }

  @Test func anotherChannelGetsNoRole() async throws {
    let model = QuickPromptModel()
    model.channel = "acme"
    model.text = "fix the cart"
    #expect(model.newThread == NewThread(channel: "acme", prompt: "fix the cart", source: .capture))
  }

  @Test func nothingToSendSendsNothing() async throws {
    let model = QuickPromptModel()
    model.text = " \n "
    let api = FakeAPI(result: .success(try created()))
    #expect(!model.canSend)
    #expect(await model.send(api) == nil)
    #expect(api.seen.threads.isEmpty)
    #expect(model.phase == .editing)
  }

  @Test func aFailedSendKeepsTheTextAndTypingClearsTheError() async {
    let model = QuickPromptModel()
    model.text = "hello"
    let api = FakeAPI(result: .failure(.unreachable("connection refused")))
    #expect(await model.send(api) == nil)
    #expect(model.text == "hello")
    guard case .failed = model.phase else { Issue.record("not failed: \(model.phase)"); return }
    model.text = "hello there"
    #expect(model.phase == .editing)
  }

  @Test func resetAfterASendGoesBackToTheConductorButKeepsADraftsChannel() async throws {
    let model = QuickPromptModel()
    model.channel = "acme"
    model.text = "draft"
    model.listening = true
    model.reset()
    #expect(model.channel == "acme" && model.text == "draft" && !model.listening)
    await model.send(FakeAPI(result: .success(try created())))
    model.reset()
    #expect(model.channel == "conductor" && model.phase == .editing)
  }

  @Test func waitsForDictatedWordsToSettle() async {
    let model = QuickPromptModel()
    let waiting = Task { await model.awaitDictation(quiet: .milliseconds(150), timeout: .seconds(3)) }
    try? await Task.sleep(for: .milliseconds(100))
    #expect(model.phase == .finishing)
    #expect(!model.canSend)
    model.text = "book a"
    try? await Task.sleep(for: .milliseconds(60))
    model.text = "book a call with Volero"
    #expect(await waiting.value)
    #expect(model.phase == .editing)
    #expect(model.text == "book a call with Volero")
  }

  @Test func givesUpWhenNoWordsArrive() async {
    let model = QuickPromptModel()
    let started = ContinuousClock.now
    #expect(await model.awaitDictation(quiet: .milliseconds(50), timeout: .milliseconds(200)) == false)
    #expect(ContinuousClock.now - started >= .milliseconds(200))
    model.text = "typed"
    #expect(await model.awaitDictation(quiet: .milliseconds(50), timeout: .milliseconds(200)))
  }
}

@MainActor
@Suite struct QuickPromptSettingsTests {
  private func defaults() -> UserDefaults { UserDefaults(suiteName: "quickprompt-\(UUID().uuidString)")! }

  @Test func onWithDictationAndControlOptionSpaceByDefault() {
    let s = QuickPromptSettings(defaults: defaults(), arguments: [:])
    #expect(s.enabled && s.dictate && s.shortcut == .controlOptionSpace && !s.isVolatile)
  }

  @Test func savesAndReadsBackAndTellsTheFollower() {
    let d = defaults()
    let s = QuickPromptSettings(defaults: d, arguments: [:])
    var changes = 0
    s.follow { changes += 1 }
    s.shortcut = .optionSpace
    s.dictate = false
    s.enabled = false
    #expect(changes == 3)
    let again = QuickPromptSettings(defaults: d, arguments: [:])
    #expect(again.shortcut == .optionSpace && !again.dictate && !again.enabled)
  }

  @Test func aLaunchArgumentSetsItForOneRun() {
    let d = defaults()
    let s = QuickPromptSettings(defaults: d, arguments: [QuickPromptSettings.Key.enabled: "NO"])
    #expect(!s.enabled && s.isVolatile)
    s.shortcut = .shiftOptionSpace
    #expect(d.object(forKey: QuickPromptSettings.Key.shortcut) == nil)
  }

  @Test func shortcutsAreSpaceWithCarbonModifiers() {
    #expect(QuickPromptShortcut.allCases.allSatisfy { $0.keyCode == 49 })
    #expect(QuickPromptShortcut.controlOptionSpace.carbonModifiers == 4096 | 2048)
    #expect(QuickPromptShortcut.optionSpace.carbonModifiers == 2048)
    #expect(QuickPromptShortcut.shiftOptionSpace.carbonModifiers == 512 | 2048)
    #expect(QuickPromptShortcut.controlShiftSpace.carbonModifiers == 4096 | 512)
    #expect(Set(QuickPromptShortcut.allCases.map(\.label)).count == QuickPromptShortcut.allCases.count)
  }
}

#if DEBUG
@Suite struct QuickPromptQAStepTests {
  @Test func parsesTheQuickPromptStep() throws {
    let script = try QAScript(json: Data(#"[{"quickPrompt": "hi"}, {"quickPrompt": {"send": true}}, {"quickPrompt": false}, {"settings": "quickPrompt"}]"#.utf8))
    #expect(script.steps == [.quickPrompt(.open("hi")), .quickPrompt(.send), .quickPrompt(.close), .settings(.quickPrompt)])
    #expect(throws: QAScriptError.self) { try QAScript(json: Data(#"[{"quickPrompt": 3}]"#.utf8)) }
  }
}
#endif
