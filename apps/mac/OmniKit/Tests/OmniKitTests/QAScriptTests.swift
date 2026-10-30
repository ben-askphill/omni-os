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

  @Test func readsTheDeliveriesStep() throws {
    let script = try QAScript(json: Data("""
      [
        {"deliveries": "ci-fixer"},
        {"deliveries": {"automation": "ci-fixer", "open": "failed"}},
        {"deliveries": {"automation": "ci-fixer", "older": true}},
        {"deliveries": {"automation": "ci-fixer", "open": "00000000-0000-4000-8000-000000000009", "older": false}}
      ]
      """.utf8))
    #expect(script.steps == [
      .deliveries(QADeliveries(automation: "ci-fixer", open: nil, older: false)),
      .deliveries(QADeliveries(automation: "ci-fixer", open: "failed", older: false)),
      .deliveries(QADeliveries(automation: "ci-fixer", open: nil, older: true)),
      .deliveries(QADeliveries(automation: "ci-fixer", open: "00000000-0000-4000-8000-000000000009", older: false)),
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
        {"scroll": "nudge"},
        {"scroll": "earlier"},
        {"scroll": "gap"},
        {"expand": true},
        {"meter": true},
        {"modelPicker": true},
        {"modelPicker": "cursor"},
        {"foldAll": true},
        {"editPending": "then write it up properly"},
        {"webhookSecret": "ci-fixer"},
        {"searchHit": 0},
        {"subagent": 1},
        {"imageZoom": 2},
        {"imageZoom": "fit"},
        {"nativeBrowser": "http://localhost:4900/"},
        {"openThread": "t2"},
        {"takeOver": "takeover-confirm"}
      ]
      """.utf8))
    #expect(script.steps == [
      .appearance(.dark),
      .appearance(.light),
      .wait(.thread("t1"), timeout: .seconds(10)),
      .scroll(.top),
      .scroll(.bottom),
      .scroll(.through),
      .scroll(.nudge),
      .scroll(.earlier),
      .scroll(.gap),
      .expand,
      .meter,
      .modelPicker(""),
      .modelPicker("cursor"),
      .foldAll,
      .editPending("then write it up properly"),
      .webhookSecret("ci-fixer"),
      .searchHit(0),
      .subagent(1),
      .imageZoom(2),
      .imageZoom(nil),
      .nativeBrowser("http://localhost:4900/"),
      .openThread("t2"),
      .takeOver("takeover-confirm"),
    ])
  }

  @Test func readsRunPickerStep() throws {
    let script = try QAScript(json: Data(#"[{"run":{"harness":"codex","model":"gpt-6.1","effort":"high"}},{"run":{"harness":"claude-code","model":""}}]"#.utf8))
    #expect(script.steps == [.run(Run(harness: .codex, model: "gpt-6.1", effort: "high")), .run(Run(harness: .claudeCode, model: "", effort: ""))])
    #expect(throws: QAScriptError.self) { try QAScript(json: Data(#"[{"run":{"model":"x"}}]"#.utf8)) }
  }

  @Test func readsTheLineSelectionSteps() throws {
    let script = try QAScript(json: Data(#"""
      [{"selectLines": {"file": "src/cart.ts", "from": 1, "to": 3}}, {"addContext": "names read better"}, {"addContext": ""},
       {"openContext": 0}]
      """#.utf8))
    #expect(script.steps == [.selectLines(file: "src/cart.ts", from: 1, to: 3), .addContext("names read better"), .addContext(""), .openContext(0)])
    for bad in [
      #"[{"selectLines": {"file": "src/cart.ts", "from": 1}}]"#, #"[{"selectLines": {"file": "", "from": 1, "to": 2}}]"#,
      #"[{"selectLines": {"file": "a", "from": -1, "to": 2}}]"#, #"[{"selectLines": "src/cart.ts"}]"#,
      #"[{"addContext": true}]"#, #"[{"openContext": -1}]"#, #"[{"openContext": "first"}]"#,
    ] {
      #expect(throws: QAScriptError.self, "\(bad)") { try QAScript(json: Data(bad.utf8)) }
    }
  }

  @Test func readsTheTerminalSelectionSteps() throws {
    let script = try QAScript(json: Data(#"[{"selectTerminal": true}, {"addTerminal": "why does this fail?"}, {"addTerminal": ""}]"#.utf8))
    #expect(script.steps == [.selectTerminal, .addTerminal("why does this fail?"), .addTerminal("")])
    for bad in [#"[{"selectTerminal": false}]"#, #"[{"selectTerminal": "all"}]"#, #"[{"addTerminal": true}]"#, #"[{"addTerminal": 1}]"#] {
      #expect(throws: QAScriptError.self, "\(bad)") { try QAScript(json: Data(bad.utf8)) }
    }
  }

  @Test func readsTheAnnotateStepsAndTheBrowserFrameCondition() throws {
    let script = try QAScript(
      json: Data(#"[{"wait": "browserFrame"}, {"annotate": "start"}, {"annotate": {"drag": [0.1, 0.2, 0.6, 0.5], "note": "the total"}}, {"annotate": {"drag": [0, 0, 1, 1]}}, {"annotate": {"tap": [0.4, 0.3], "note": "this button"}}, {"annotate": {"tap": [0, 1]}}, {"annotate": "add"}, {"annotate": "cancel"}]"#.utf8))
    #expect(script.steps == [
      .wait(.browserFrame, timeout: .seconds(10)), .annotate(.start),
      .annotate(.drag(x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.5, note: "the total")), .annotate(.drag(x0: 0, y0: 0, x1: 1, y1: 1, note: "")),
      .annotate(.tap(x: 0.4, y: 0.3, note: "this button")), .annotate(.tap(x: 0, y: 1, note: "")), .annotate(.add), .annotate(.cancel),
    ])
    for bad in [#"[{"annotate": "go"}]"#, #"[{"annotate": true}]"#, #"[{"annotate": {"drag": [0, 0, 1]}}]"#, #"[{"annotate": {"drag": [0, 0, 1, 2]}}]"#, #"[{"annotate": {"drag": [0, 0, 1, 1], "note": 3}}]"#, #"[{"annotate": {"tap": [0.5]}}]"#, #"[{"annotate": {"tap": [0.5, 2]}}]"#, #"[{"annotate": {"tap": [0.5, 0.5], "note": 3}}]"#, #"[{"wait": "browserFrame:x"}]"#] {
      #expect(throws: QAScriptError.self, "\(bad)") { try QAScript(json: Data(bad.utf8)) }
    }
    #expect(QACondition.browserFrame.holds(in: QAFacts(serverState: "running", connection: "open", sidebarLoaded: true, channels: [], browserFrame: true)))
    #expect(!QACondition.browserFrame.holds(in: QAFacts(serverState: "running", connection: "open", sidebarLoaded: true, channels: [])))
  }

  @Test func readsTheBrowserAddressStep() throws {
    let script = try QAScript(json: Data(#"[{"browserAddress": "example.com"}, {"browserAddress": {"type": "example.org", "escape": true}}, {"browserAddress": {"type": "a.b"}}]"#.utf8))
    #expect(script.steps == [.browserAddress("example.com", escape: false), .browserAddress("example.org", escape: true), .browserAddress("a.b", escape: false)])
    for bad in [#"[{"browserAddress": ""}]"#, #"[{"browserAddress": true}]"#, #"[{"browserAddress": {"escape": true}}]"#, #"[{"browserAddress": {"type": "x", "escape": "yes"}}]"#] {
      #expect(throws: QAScriptError.self, "\(bad)") { try QAScript(json: Data(bad.utf8)) }
    }
  }

  @Test func readsTheMarkingSteps() throws {
    let json = ##"[{"annotate": {"shape": "arrow", "from": [0.1, 0.2], "to": [0.5, 0.6]}}, {"annotate": {"pen": [[0.1, 0.1], [0.2, 0.3], [0.4, 0.2]]}}, {"annotate": {"text": "wrong total", "at": [0.3, 0.7]}}, {"annotate": {"color": "#3b82f6", "stroke": 8}}, {"annotate": {"move": [0.3, 0.4], "by": [0.1, 0]}}, {"annotate": "undo"}, {"annotate": {"note": "fix these"}}]"##
    #expect(try QAScript(json: Data(json.utf8)).steps == [
      .annotate(.shape(tool: "arrow", x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.6)),
      .annotate(.pen(points: [[0.1, 0.1], [0.2, 0.3], [0.4, 0.2]])),
      .annotate(.text("wrong total", x: 0.3, y: 0.7)),
      .annotate(.style(color: "#3b82f6", stroke: 8)),
      .annotate(.move(x: 0.3, y: 0.4, dx: 0.1, dy: 0)),
      .annotate(.undo),
      .annotate(.note("fix these")),
    ])
    for bad in [#"[{"annotate": {"shape": "star", "from": [0, 0], "to": [1, 1]}}]"#, #"[{"annotate": {"shape": "line", "from": [0, 0]}}]"#, #"[{"annotate": {"pen": [[0, 0]]}}]"#, #"[{"annotate": {"text": "x", "at": [2, 0]}}]"#, #"[{"annotate": {"color": 3}}]"#, #"[{"annotate": {"move": [0, 0]}}]"#] {
      #expect(throws: QAScriptError.self, "\(bad)") { try QAScript(json: Data(bad.utf8)) }
    }
  }

  @Test func readsTheLiveAnnotateSteps() throws {
    let json = #"[{"annotate": "live"}, {"annotate": {"hover": [0.4, 0.3]}}, {"annotate": {"livePick": [0.5, 0.2], "note": "why blue?"}}, {"annotate": {"liveDrag": [0.1, 0.2, 0.6, 0.5]}}, {"annotate": "send"}, {"annotate": {"optionClick": [0.2, 0.8]}}, {"annotate": {"pageScroll": -120}}, {"annotate": "escape"}]"#
    #expect(try QAScript(json: Data(json.utf8)).steps == [
      .annotate(.live), .annotate(.hover(x: 0.4, y: 0.3)), .annotate(.livePick(x: 0.5, y: 0.2, note: "why blue?")),
      .annotate(.liveDrag(x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.5, note: "")), .annotate(.send), .annotate(.optionClick(x: 0.2, y: 0.8)), .annotate(.pageScroll(-120)), .annotate(.escape),
    ])
    for bad in [#"[{"annotate": {"hover": [0.5]}}]"#, #"[{"annotate": {"hover": [0.5, 0.5], "note": "x"}}]"#, #"[{"annotate": {"optionClick": [0.5, 2]}}]"#, #"[{"annotate": {"optionClick": [0.5, 0.5], "note": "x"}}]"#, #"[{"annotate": {"pageScroll": "down"}}]"#, #"[{"annotate": {"pageScroll": true}}]"#, #"[{"annotate": {"livePick": [2, 0]}}]"#, #"[{"annotate": {"liveDrag": [0, 0, 1]}}]"#, #"[{"annotate": {"livePick": [0, 0], "note": 1}}]"#] {
      #expect(throws: QAScriptError.self, "\(bad)") { try QAScript(json: Data(bad.utf8)) }
    }
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
    let script = try QAScript(json: Data(#"[{"settings": "general"}, {"settings": "workspace"}, {"settings": "machines"}, {"settings": "secrets"}]"#.utf8))
    #expect(script.steps == [.settings(.general), .settings(.workspace), .settings(.machines), .settings(.secrets)])
    // The eight tabs before #404 open the tab that holds that page now; "connection" is Server's name before that.
    let old = try QAScript(json: Data(#"[{"settings": "sync"}, {"settings": "storage"}, {"settings": "appearance"}, {"settings": "server"}, {"settings": "profile"}, {"settings": "connection"}]"#.utf8))
    #expect(old.steps == [.settings(.machines), .settings(.machines), .settings(.general), .settings(.machines), .settings(.general), .settings(.machines)])
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
    #"[{"folder": "open"}]"#,
    #"[{"folder": {"drag": "A thread"}}]"#,
    #"[{"folder": {"menu": "Specs", "shot": "../x"}}]"#,
    #"[{"folder": {"rename": "Specs", "delete": "Specs"}}]"#,
    #"[{"screen": ""}]"#,
    #"[{"takeOver": "../x"}]"#,
    #"[{"deliveries": ""}]"#,
    #"[{"deliveries": {"open": "failed"}}]"#,
    #"[{"deliveries": {"automation": "x", "older": "yes"}}]"#,
    #"[{"deliveries": {"automation": "x", "open": 3}}]"#,
    #"[{"deliveries": {"automation": "x", "bogus": 1}}]"#,
    #"{"nope": []}"#,
  ])
  func rejectsWhatItDoesNotKnow(json: String) {
    #expect(throws: QAScriptError.self) { try QAScript(json: Data(json.utf8)) }
  }

  @Test func readsFolderSteps() throws {
    let script = try QAScript(json: Data(#"""
      [{"folder": {"new": "acme"}}, {"folder": {"new": "acme", "name": "Specs"}}, {"folder": {"rename": "Specs"}},
       {"folder": {"delete": "Specs"}}, {"folder": {"drag": "A thread", "over": "Specs"}},
       {"folder": {"file": "A thread", "into": "Specs"}}, {"folder": {"menu": "Specs", "shot": "menu-dark"}},
       {"folder": "reset"}, {"screen": "delete-dark"}, {"folder": {"here": "Specs"}}]
      """#.utf8))
    #expect(
      script.steps == [
        .folder(.new(channel: "acme")), .folder(.create(channel: "acme", name: "Specs")), .folder(.rename(folder: "Specs")),
        .folder(.delete(folder: "Specs")), .folder(.drag(thread: "A thread", over: "Specs")),
        .folder(.file(thread: "A thread", into: "Specs")), .folder(.menu(folder: "Specs", shot: "menu-dark")),
        .folder(.reset), .screen("delete-dark"), .folder(.here(folder: "Specs")),
      ])
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
    #expect(env["OMNI_CLAUDE_BIN"] == "/code/omni-os/packages/test-fixtures/fake-claude.mjs")
    #expect(env["OMNI_CODEX_BIN"] == "/code/omni-os/packages/test-fixtures/fake-codex.mjs")
    #expect(env["OMNI_CURSOR_BIN"] == "/code/omni-os/packages/test-fixtures/fake-cursor.mjs")
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
