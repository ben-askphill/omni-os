import Foundation
import Testing
import OmniKit

private func art(_ id: Int, _ kind: String = "html") throws -> Artifact {
  try decode(Artifact.self, #"{"id":\#(id),"thread_id":"t1","path":"/tmp/a\#(id)","name":"a\#(id)","kind":"\#(kind)","size":10,"created_at":"2026-09-28T07:57:15.045Z","updated_at":"2026-09-28T07:57:15.045Z"}"#)
}

private func list(_ items: [(Int, String)]) throws -> [Artifact] { try items.map { try art($0.0, $0.1) } }

@Suite struct InspectorSelectionTests {
  @Test func theParamWins() throws {
    let s = InspectorSelection.initial(artifacts: try list([(1, "html"), (2, "text"), (3, "html")]), param: 2)
    #expect(s == InspectorSelection(tab: .artifacts, artifactID: 2))
  }

  @Test func newestHTMLElseNewestFileElseDetails() throws {
    #expect(InspectorSelection.initial(artifacts: try list([(1, "html"), (2, "text"), (3, "screenshot")])) == .init(tab: .artifacts, artifactID: 1))
    #expect(InspectorSelection.initial(artifacts: try list([(1, "text"), (2, "csv"), (3, "screenshot")])) == .init(tab: .artifacts, artifactID: 2))
    #expect(InspectorSelection.initial(artifacts: try list([(1, "screenshot")])) == .init(tab: .details, artifactID: nil))
    #expect(InspectorSelection.initial(artifacts: []) == .init(tab: .details, artifactID: nil))
  }

  @Test func aNewHTMLIsSelectedAndShownEvenTheFirst() throws {
    var s = InspectorSelection.initial(artifacts: [])
    let first = try art(1)
    s.arrived(first)
    #expect(s == .init(tab: .artifacts, artifactID: 1))
    #expect(s.shown(in: [first])?.id == 1)
  }

  @Test func aMissingSelectionFallsBackToTheNewestFile() throws {
    let s = InspectorSelection(tab: .artifacts, artifactID: 9)
    #expect(s.shown(in: try list([(1, "text"), (2, "screenshot"), (3, "markdown")]))?.id == 3)
    #expect(s.shown(in: []) == nil)
  }
}

@Suite struct RequestPolicyTests {
  static let blocked = [
    "http://localhost:4747/api/status", "http://localhost/", "https://app.localhost/x", "http://127.0.0.1:4747/api/threads",
    "http://127.1.2.3/", "http://0.0.0.0:80/", "http://[::1]/", "http://[::ffff:7f00:1]/", "http://100.64.0.1/", "http://100.100.5.5:8080/",
    "http://100.127.255.255/", "https://bens-mac.tail1234.ts.net/", "http://192.168.1.20:4747/api", "http://bens-mac.local:4747/",
    "ws://localhost:4747/api/feed", "http://user@127.0.0.1/", "http://2130706433/", "http://0x7f.1/",
  ]
  static let allowed = [
    "https://example.com/", "https://cdn.jsdelivr.net/npm/x.js", "http://100.63.255.255/", "http://100.128.0.1/", "http://101.64.0.1/",
    "https://example.com:47470/", "http://notlocalhost.com/", "https://ts.net.example.com/", "data:text/html,hi", "omni-artifact://5/a.html",
    "http://192.168.1.20:8080/",
  ]

  @Test(arguments: blocked) func blocksThePrivateWay(_ text: String) throws {
    let url = try #require(URL(string: text))
    #expect(RequestPolicy.isBlocked(url, omniPort: 4747))
  }

  @Test(arguments: allowed) func letsThePublicWebThrough(_ text: String) throws {
    let url = try #require(URL(string: text))
    #expect(!RequestPolicy.isBlocked(url, omniPort: 4747))
  }

  @Test func theRuleListSaysTheSameAsThePolicy() throws {
    let rules = try #require(try JSONSerialization.jsonObject(with: Data(RequestPolicy.ruleListJSON(omniPort: 4747).utf8)) as? [[String: Any]])
    let filters = try rules.map { rule -> NSRegularExpression in
      let trigger = try #require(rule["trigger"] as? [String: Any])
      #expect((rule["action"] as? [String: Any])?["type"] as? String == "block")
      return try NSRegularExpression(pattern: try #require(trigger["url-filter"] as? String))
    }
    func matches(_ text: String) -> Bool {
      filters.contains { $0.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil }
    }
    // Numeric spellings like 2130706433 reach the rule list already written as 127.0.0.1 by WebKit.
    for text in Self.blocked where !text.contains("2130706433") && !text.contains("0x7f") { #expect(matches(text), "\(text)") }
    for text in Self.allowed { #expect(!matches(text), "\(text)") }
  }
}

@Suite struct CSVTests {
  @Test func parsesQuotesAndBreaks() {
    let r = CSV.parse("a,b\n\"x,1\",\"say \"\"hi\"\"\"\r\n\"two\nlines\",z")
    #expect(r.rows == [["a", "b"], ["x,1", "say \"hi\""], ["two\nlines", "z"]])
    #expect(!r.truncated)
  }

  @Test func handlesEmptyAndTrailing() {
    #expect(CSV.parse("").rows.isEmpty)
    #expect(CSV.parse("a,b\n").rows == [["a", "b"]])
    #expect(CSV.parse("a,,c").rows == [["a", "", "c"]])
    #expect(CSV.parse("a\r\nb\r\n").rows == [["a"], ["b"]])
  }

  @Test func stopsAtTheRowCap() {
    let src = (1...10).map(String.init).joined(separator: "\n") + "\n"
    let r = CSV.parse(src, maxRows: 3)
    #expect(r.rows.count == 3)
    #expect(r.truncated)
  }
}

@Suite struct InspectorDetailsTests {
  @Test func quotesForTheShell() {
    #expect(ThreadDetails.shellQuote("/Users/ben/code") == "/Users/ben/code")
    #expect(ThreadDetails.shellQuote("/Users/ben/my code") == "'/Users/ben/my code'")
    #expect(ThreadDetails.shellQuote("it's") == #"'it'\''s'"#)
  }

  @Test func buildsTheResumeCommand() {
    #expect(ThreadDetails.resumeCommand(harness: .claudeCode, sessionID: "s1", cwd: "/x y") == "cd '/x y' && claude --resume s1")
    #expect(ThreadDetails.resumeCommand(harness: .codex, sessionID: "s1", cwd: "/x") == "cd /x && codex resume s1")
    #expect(ThreadDetails.resumeCommand(harness: .cursor, sessionID: "s1", cwd: "/x") == "cd /x && cursor-agent --resume s1")
    #expect(ThreadDetails.resumeCommand(harness: HarnessID(rawValue: "other"), sessionID: "s1", cwd: "/x") == "cd /x && claude --resume s1")
    #expect(ThreadDetails.resumeCommand(harness: .codex, sessionID: nil, cwd: "/x") == nil)
  }

  @Test func readsMCPServers() {
    let ok = MCPServer("github:connected")
    #expect(ok.name == "github" && ok.ok && ok.label == "github")
    let bad = MCPServer("notion:failed")
    #expect(bad.name == "notion" && !bad.ok)
    #expect(MCPServer("plain").ok && MCPServer("plain").name == "plain")
    #expect(MCPServer("0f3c2a1b-1234-4abc-8def-0123456789ab:connected").label == "0f3c2a1b…")
    #expect(MCPServer("claude.ai Figma:needs-auth").name == "claude.ai Figma")
  }
}
