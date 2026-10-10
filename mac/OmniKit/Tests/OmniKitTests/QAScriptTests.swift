#if DEBUG
import Foundation
import Testing
import OmniKit

@Suite struct QAScriptTests {
  @Test func readsEveryKindOfStep() throws {
    let script = try QAScript(json: Data("""
      [
        {"route": "#/c/acme"},
        {"wait": {"for": "sidebarLoaded", "timeout": 5}},
        {"wait": "serverState:notRunning"},
        {"sleep": 0.5},
        {"snapshot": "home"},
        {"port": 4759},
        {"open": "settings"},
        {"server": "start"},
        {"server": "stop"},
        {"server": "check"},
        {"quit": true}
      ]
      """.utf8))
    #expect(script.steps == [
      .route(.channel(id: "acme")),
      .wait(.sidebarLoaded, timeout: .seconds(5)),
      .wait(.serverState("notRunning"), timeout: .seconds(10)),
      .sleep(.milliseconds(500)),
      .snapshot("home"),
      .port(4759),
      .open(.settings),
      .server(.start),
      .server(.stop),
      .server(.check),
      .quit,
    ])
  }

  @Test func readsTheThreadSteps() throws {
    let script = try QAScript(json: Data("""
      [
        {"appearance": "dark"},
        {"appearance": "light"},
        {"wait": "thread:t1"},
        {"scroll": "top"},
        {"scroll": "bottom"},
        {"scroll": "through"},
        {"expand": true},
        {"meter": true},
        {"openThread": "t2"}
      ]
      """.utf8))
    #expect(script.steps == [
      .appearance(.dark),
      .appearance(.light),
      .wait(.thread("t1"), timeout: .seconds(10)),
      .scroll(.top),
      .scroll(.bottom),
      .scroll(.through),
      .expand,
      .meter,
      .openThread("t2"),
    ])
  }

  @Test func sumsUpFrames() {
    let stats = QAFrameStats(gaps: [16, 17, 16, 50, 16, 34])
    #expect(stats.frames == 6)
    #expect(stats.worst == 50)
    #expect(stats.slow == 2)
    #expect(stats.summary == "6 frames, mean 24.8 ms, worst 50.0 ms, 2 over 33 ms")
    #expect(QAFrameStats(gaps: []).summary == "0 frames")
  }

  @Test func opensATabOfSettings() throws {
    let script = try QAScript(json: Data(#"[{"settings": "secrets"}, {"settings": "sync"}, {"settings": "appearance"}, {"settings": "connection"}]"#.utf8))
    #expect(script.steps == [.settings(.secrets), .settings(.sync), .settings(.appearance), .settings(.connection)])
    #expect(throws: QAScriptError.self) { try QAScript(json: Data(#"[{"settings": "garage"}]"#.utf8)) }
  }

  @Test func takesTheStepsUnderAKeyToo() throws {
    let script = try QAScript(json: Data(##"{"steps": [{"route": "#/"}, {"quit": true}]}"##.utf8))
    #expect(script.steps == [.route(.home), .quit])
  }

  @Test(arguments: [
    #"[{"jump": 1}]"#,
    #"[{"wait": {"for": "lunch"}}]"#,
    #"[{"wait": "serverState:asleep"}]"#,
    #"[{"wait": "connection:maybe"}]"#,
    #"[{"snapshot": "../escape"}]"#,
    #"[{"snapshot": ""}]"#,
    #"[{"open": "garage"}]"#,
    #"[{"openThread": ""}]"#,
    #"[{"server": "reboot"}]"#,
    #"[{"port": 0}]"#,
    #"[{"port": 4747}]"#,
    #"[{"sleep": -1}]"#,
    #"[{"appearance": "sepia"}]"#,
    #"[{"scroll": "left"}]"#,
    #"[{"wait": "thread:"}]"#,
    #"{"nope": []}"#,
  ])
  func rejectsWhatItDoesNotKnow(json: String) {
    #expect(throws: QAScriptError.self) { try QAScript(json: Data(json.utf8)) }
  }

  @Test func namesTheBadStep() throws {
    let error = try #require(throws: QAScriptError.self) {
      try QAScript(json: Data(##"[{"route": "#/"}, {"wait": {"for": "lunch"}}]"##.utf8))
    }
    #expect(error.message.contains("step 2"))
    #expect(error.message.contains("lunch"))
  }

  @Test func aRunNeedsAServerPortOtherThanTheLiveOne() throws {
    let qa = ["Omni", "-OmniQAScript", "[]", "-OmniQAOut", "/tmp/qa"]
    #expect(try QALaunch.serverPort(in: qa + ["-serverPort", "4757"]) == 4757)
    for bad in [[], ["-serverPort"], ["-serverPort", "4747"], ["-serverPort", "abc"], ["-serverPort", "70000"],
                ["-serverPort", "4757", "-serverPort", "4747"]] {
      #expect(throws: QAScriptError.self, "\(bad)") { try QALaunch.serverPort(in: qa + bad) }
    }
  }

  @Test func conditionsReadTheFacts() throws {
    var facts = QAFacts(serverState: "running", connection: "open", sidebarLoaded: true, channels: ["acme"])
    #expect(try QACondition("sidebarLoaded").holds(in: facts))
    #expect(try QACondition("serverState:running").holds(in: facts))
    #expect(try !QACondition("serverState:notRunning").holds(in: facts))
    #expect(try QACondition("connection:open").holds(in: facts))
    #expect(try QACondition("channel:acme").holds(in: facts))
    #expect(try !QACondition("channel:globex").holds(in: facts))
    #expect(try !QACondition("thread:t1").holds(in: facts))
    facts.shownThread = "t1"
    #expect(try QACondition("thread:t1").holds(in: facts))
    facts.sidebarLoaded = false
    #expect(try !QACondition("sidebarLoaded").holds(in: facts))
  }

  @Test func aServerStartedInAQARunUsesItsOwnDataAndFakeCLIs() {
    let out = URL(filePath: "/tmp/qa/run1", directoryHint: .isDirectory)
    let repo = URL(filePath: "/code/omni-os", directoryHint: .isDirectory)
    let env = QAServer.environment(out: out, repo: repo)
    #expect(env["OMNI_DATA_DIR"] == "/tmp/qa/run1/data")
    #expect(env["OMNI_BRAIN_DIR"] == "/tmp/qa/run1/brain")
    #expect(env["OMNI_CLAUDE_BIN"] == "/code/omni-os/tests/fixtures/fake-claude.mjs")
    #expect(env["OMNI_CODEX_BIN"] == "/code/omni-os/tests/fixtures/fake-codex.mjs")
    #expect(env["OMNI_CURSOR_BIN"] == "/code/omni-os/tests/fixtures/fake-cursor.mjs")
    #expect(env["OMNI_BROWSER"] == "0")
    let launched = ServerEnvironment.child(app: ["HOME": "/Users/ben"], path: "/bin", port: 4758, extra: env)
    #expect(launched["OMNI_DATA_DIR"] == "/tmp/qa/run1/data")
    #expect(launched["OMNI_PORT"] == "4758")
  }

  @Test func blankSnapshotsAreFlagged() {
    #expect(QASnapshot.looksBlank(pixels: [UInt32](repeating: 0, count: 10_000)))
    var speck = [UInt32](repeating: 0xFFFF_FFFF, count: 10_000)
    speck[5] = 0xFF00_00FF
    #expect(QASnapshot.looksBlank(pixels: speck))
    var drawn = [UInt32](repeating: 0xFFFF_FFFF, count: 10_000)
    for i in stride(from: 0, to: 10_000, by: 7) { drawn[i] = UInt32(i) }
    #expect(!QASnapshot.looksBlank(pixels: drawn))
  }
}
#endif
