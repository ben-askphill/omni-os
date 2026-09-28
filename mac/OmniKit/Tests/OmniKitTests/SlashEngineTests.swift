import Foundation
import Testing
import OmniKit

/// Cases from tests/slash-menu.test.ts, composer-slash.test.ts and slash-pills.test.ts, through the bundled engine.
private func cmd(_ name: String, _ source: String, aliases: [String]? = nil) -> SlashCommand {
  SlashCommand(name: name, aliases: aliases, description: "\(name) description", source: source, mentionable: source != "builtin")
}

private let list = [
  cmd("tdd", "personal"), cmd("compact", "builtin"), cmd("document-skills:pdf", "plugin", aliases: ["pdf"]),
  cmd("clear", "builtin", aliases: ["reset", "new"]), cmd("model", "builtin"), cmd("deploy-preview", "project"),
]
private let ready = CommandList(status: .ready, commands: list, fetchedAt: 1)
private let engine = SlashEngine.shared

@Suite struct SlashEngineTests {
  @Test func loadsTheBundle() {
    #expect(engine.omniCommands.map(\.name) == ["clear", "new", "rename", "model", "effort", "fast"])
  }

  @Test func findsTheCommandAtTheCaret() {
    #expect(engine.query("/", caret: 1) == SlashQuery(query: "", start: 0, end: 1))
    #expect(engine.query("/tdd fix", caret: 2) == SlashQuery(query: "t", start: 0, end: 4))
    #expect(engine.query("hello /td", caret: 9) == SlashQuery(query: "td", start: 6, end: 9, mention: true))
    #expect(engine.query("/Users/ben", caret: 10) == nil)
    #expect(engine.query("/tdd ", caret: 5) == nil)
  }

  @Test func countsUTF16UnitsBeforeTheCaret() throws {
    // The emoji is two UTF-16 units and one Swift Character.
    let text = "😀 /td"
    let q = try #require(engine.query(text, caret: 6))
    #expect(q == SlashQuery(query: "td", start: 3, end: 6, mention: true))
    #expect(text[q.range(in: text)] == "/td")
    #expect(text.utf16Offset(of: q.range(in: text).upperBound) == 6)
  }

  @Test func groupsAndRanksTheMenu() {
    let at = SlashQuery(query: "", start: 0, end: 1)
    let all = engine.sections(list: ready, at: at, where: .reply)
    #expect(all.map(\.label) == ["Project", "Personal", "Plugins", "Built-in", "Omni"])
    // The harness's /clear and /model give way to Omni's own.
    #expect(all[3].commands.map(\.name) == ["compact"])
    #expect(all[4].commands.map(\.name) == ["clear", "effort", "fast", "model", "new", "rename"])
    #expect(engine.sections(list: ready, at: at, where: .newThread).map(\.label) == ["Project", "Personal", "Plugins", "Built-in"])

    let pdf = engine.sections(list: ready, at: SlashQuery(query: "pdf", start: 0, end: 4), where: .reply)
    #expect(pdf.map(\.label) == [nil])
    #expect(pdf[0].commands.map(\.name) == ["document-skills:pdf"])
  }

  @Test func aMentionMenuListsMentionableCommandsOnly() {
    let at = SlashQuery(query: "", start: 6, end: 7, mention: true)
    let names = engine.sections(list: ready, at: at, where: .reply).flatMap(\.commands).map(\.name)
    #expect(names.contains("tdd"))
    #expect(!names.contains("compact") && !names.contains("rename"))
  }

  @Test func putsRecentCommandsFirst() {
    var withRecent = ready
    withRecent.recent = ["tdd", "gone"]
    let s = engine.sections(list: withRecent, at: SlashQuery(query: "", start: 0, end: 1), where: .newThread)
    #expect(s.first?.label == "Recent")
    #expect(s.first?.commands.map(\.name) == ["tdd"])
  }

  @Test func picksACommand() {
    let at = SlashQuery(query: "t", start: 0, end: 4)
    #expect(engine.pick("/tdd fix", at: at, name: "tdd") == SlashPick(text: "/tdd fix", caret: 5))
    let later = SlashQuery(query: "p", start: 7, end: 9, mention: true)
    #expect(engine.pick("😀 use /p", at: later, name: "pdf") == SlashPick(text: "😀 use /pdf ", caret: 12))
  }

  @Test func sendsPlainTextAndHarnessCommandsAsTyped() {
    let plain = engine.reply("fix the login bug", list: ready, harness: "claude-code")
    #expect(plain == ReplySlash(action: .send, armed: true, label: nil, hint: nil))
    #expect(engine.reply("/tdd 31", list: ready, harness: "claude-code").armed)
    #expect(!engine.reply("  ", list: ready, harness: "claude-code").armed)
  }

  @Test func resolvesOmniCommands() {
    let clear = engine.reply("/clear", list: ready, harness: "claude-code")
    #expect(clear.action == .newThread(prompt: ""))
    #expect(clear.label == "New thread" && clear.armed)
    // Claude Code's own name for it.
    #expect(engine.reply("/reset fix cart", list: ready, harness: "claude-code").action == .newThread(prompt: "fix cart"))

    let none = engine.reply("/rename", list: ready, harness: "claude-code")
    #expect(none.action == .rename(title: "") && !none.armed)
    #expect(none.hint == "Type the new title after /rename.")
    let some = engine.reply("/rename  A   new title ", list: ready, harness: "claude-code")
    #expect(some.action == .rename(title: "A new title") && some.armed && some.hint == nil)
    let long = engine.reply("/rename " + String(repeating: "x", count: 201), list: ready, harness: "claude-code")
    #expect(!long.armed && long.hint == "A title can be up to 200 characters. This one is 201.")

    for name in ["model", "effort", "fast"] {
      let r = engine.reply("/\(name)", list: ready, harness: "codex")
      #expect(r.action == .fixed && !r.armed && r.hint == "The model, effort and fast mode are fixed per thread.")
    }
  }

  @Test func hintsForCommandsThatStayText() {
    #expect(engine.reply("/login", list: ready, harness: "claude-code").hint == "/login only works in a Claude Code terminal, so it sends as text.")
    #expect(engine.reply("/nope", list: ready, harness: "claude-code").hint == "No /nope command in this thread, so it sends as text.")
    // Until the list is in, any name could be a command.
    let loading = CommandList(status: .loading, commands: [], fetchedAt: nil)
    #expect(engine.reply("/nope", list: loading, harness: "claude-code").hint == nil)
    #expect(engine.reply("/nope", list: nil, harness: "claude-code").hint == nil)
    #expect(engine.reply("then /compact", list: ready, harness: "codex").hint == "/compact only works at the start of a message, so here it stays text.")
    #expect(engine.reply("fix with /tdd and /tdd", list: ready, harness: "claude-code").hint == "Claude Code loads /tdd only if the model decides to.")
    #expect(engine.newThreadHint("/clear", list: ready, harness: "claude-code") == "/clear works in a thread's reply box, so here it sends as text.")
    #expect(engine.newThreadHint("/nope", list: ready, harness: "codex") == "No /nope command for Codex in this channel, so it sends as text.")
    #expect(engine.newThreadHint("plain", list: ready, harness: "codex") == nil)
  }

  @Test func splitsPillsLikeTheWebDoes() {
    func hit(_ name: String, _ start: Int, _ end: Int) -> SlashHit {
      SlashHit(name: name, source: "personal", description: "", argumentHint: nil, start: start, end: end)
    }
    let cases: [(String, SlashRecord?, Int?)] = [
      ("/tdd 31 using /pdf now", SlashRecord(command: hit("tdd", 0, 4), mentions: [hit("pdf", 14, 18)]), nil),
      ("😀 /tdd go", SlashRecord(command: nil, mentions: [hit("tdd", 3, 7)]), nil),
      ("😀 /tdd go", SlashRecord(command: nil, mentions: [hit("tdd", 3, 7)]), 5),
      ("just text", SlashRecord(command: nil, mentions: [hit("tdd", 2, 6)]), nil),
      ("", nil, nil),
    ]
    for (text, slash, visible) in cases {
      #expect(engine.pieces(text, slash: slash, visible: visible) == SlashPiece.split(text, slash: slash, visible: visible), "\(text)")
    }
  }
}
