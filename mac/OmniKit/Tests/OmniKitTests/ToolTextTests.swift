import AppKit
import Foundation
import Testing
import OmniKit

/// A tool call as the server sends it, `input` as JSON text.
func toolUse(_ name: String, _ input: String, id: String = "u1", parent: String? = nil) throws -> ToolUse {
  let parentJSON = parent.map { #""\#($0)""# } ?? "null"
  let row = try decode(EventRow.self, eventJSON(kind: "tool_use", payload: #"{"id":"\#(id)","name":"\#(name)","input":\#(input),"parent":\#(parentJSON)}"#))
  guard case .toolUse(let use) = row.content else { throw TimedOut(what: "a tool_use, got \(row.content)") }
  return use
}

// Expected values are what toolLabel and toolSummary in web/src/components/Transcript.tsx give for the same input.

@Suite struct ToolTextTests {
  @Test(arguments: [
    ("Bash", "Bash"),
    ("mcp__plugin_github_github__search_issues", "github · search_issues"),
    ("mcp__0f3c2a1b-1234-4abc-8def-0123456789ab__read", "mcp · read"),
    ("mcp__claude_ai_Figma__get_screenshot", "claude_ai_Figma · get_screenshot"),
    ("mcp__a__b__c", "a · b__c"),
    ("mcp__plugin_x__tool", "plugin_x · tool"),
    ("mcp____x", "mcp____x"),
  ])
  func labelsTools(_ name: String, _ want: String) {
    #expect(ToolText.label(name) == want)
  }

  @Test(arguments: [
    ("Bash", #"{"command":"npm test\nnpm run lint","description":"Run tests"}"#, nil, "npm test"),
    ("Bash", #"{"description":"Run tests"}"#, nil, "Run tests"),
    ("BashOutput", #"{"bash_id":"b1"}"#, nil, "b1"),
    ("Read", #"{"file_path":"/Users/ben/code/omni/src/a.ts"}"#, "/Users/ben/code/omni", "src/a.ts"),
    ("NotebookEdit", #"{"notebook_path":"/Users/ben/n/a/b/c.ipynb"}"#, nil, ".../a/b/c.ipynb"),
    ("Glob", #"{"pattern":"**/*.ts"}"#, nil, "**/*.ts"),
    ("Grep", #"{"pattern":"cartTotal","path":"/Users/ben/code/omni/src"}"#, "/Users/ben/code/omni", "cartTotal  in src"),
    ("Grep", #"{"pattern":"cartTotal"}"#, nil, "cartTotal"),
    ("Grep", #"{"pattern":"x","path":""}"#, nil, "x"),
    ("WebFetch", #"{"url":"https://example.com"}"#, nil, "https://example.com"),
    ("WebSearch", #"{"query":"swift observation"}"#, nil, "swift observation"),
    ("Task", #"{"description":"Find the cart code","subagent_type":"Explore"}"#, nil, "Find the cart code (Explore)"),
    ("Agent", #"{"description":"Plan"}"#, nil, "Plan"),
    ("TodoWrite", #"{"todos":[{"status":"completed"},{"status":"in_progress"},"odd"]}"#, nil, "1/3 done"),
    ("TodoWrite", #"{"todos":"none"}"#, nil, "0/0 done"),
    ("Skill", #"{"command":"pdf"}"#, nil, "pdf"),
    ("KillShell", #"{"shell_id":"s9"}"#, nil, "s9"),
    ("mcp__plugin_github_github__search_issues", #"{"query":"cart total","perPage":5}"#, nil, "cart total"),
    ("mcp__x__y", #"{"perPage":5,"owner":"ben","repo":"omni"}"#, nil, "5"),
    ("mcp__x__y", #"{"b":1,"2":"two","a":"first"}"#, nil, "two"),
    ("mcp__x__y", #"{"zeta":{"a":1},"alpha":"",  "mid" : "second","beta":"third"}"#, nil, "second"),
    ("mcp__x__y", #"{"flag":true,"list":["a"],"obj":{"a":"b"}}"#, nil, "true"),
    ("Other", "42", nil, "42"),
    ("Other", "null", nil, ""),
    ("Other", "1.5", nil, "1.5"),
    ("Other", #"{"id":0,"name":""}"#, nil, "0"),
    ("Other", #"["first","second"]"#, nil, "first"),
    ("Other", "{}", nil, ""),
    ("Other", #"{"say\"it":"escaped","z":"no"}"#, nil, "escaped"),
  ] as [(String, String, String?, String)])
  func summarizesCalls(_ name: String, _ input: String, _ cwd: String?, _ want: String) throws {
    #expect(ToolText.summary(try toolUse(name, input), cwd: cwd) == want)
  }

  @Test func cutsALongFirstLine() throws {
    let s = ToolText.summary(try toolUse("Bash", #"{"command":"   \#(String(repeating: "x", count: 200))"}"#), cwd: nil)
    #expect(s == String(repeating: "x", count: 159) + "...")
    #expect(ToolText.summary(try toolUse("Bash", #"{"command":"\#(String(repeating: "y", count: 160))"}"#), cwd: nil).count == 160)
  }

  @Test func listsTheInputKeysInJavaScriptOrder() throws {
    #expect(try toolUse("x", #"{"zeta":1,"alpha":{"b":[1,{"c":"}"}]},"mid":"a\"b","2":0,"10":0,"01":0}"#).inputKeys == ["2", "10", "zeta", "alpha", "mid", "01"])
    #expect(try toolUse("x", #"[1,2]"#).inputKeys.isEmpty)
  }

  @Test(arguments: [
    ("Bash", "terminal"), ("BashOutput", "terminal"),
    ("Read", "doc"), ("Edit", "doc"), ("Write", "doc"), ("MultiEdit", "doc"), ("Glob", "doc"), ("Grep", "doc"),
    ("WebFetch", "globe"), ("WebSearch", "globe"), ("mcp__claude-in-chrome__browser_batch", "globe"),
    ("Task", "square.3.layers.3d"), ("Agent", "square.3.layers.3d"),
    ("TodoWrite", "wrench.and.screwdriver"), ("NotebookEdit", "wrench.and.screwdriver"),
  ])
  func picksAnIcon(_ name: String, _ symbol: String) {
    #expect(ToolText.icon(name) == symbol)
    #expect(NSImage(systemSymbolName: symbol, accessibilityDescription: nil) != nil, "\(symbol) is an SF Symbol")
  }

  @Test func setsCommandsAndPathsInMonospace() {
    #expect(["Bash", "Read", "Edit", "Write", "MultiEdit", "Glob", "Grep"].allSatisfy(ToolText.isMonospaced))
    #expect(!ToolText.isMonospaced("WebFetch"))
    #expect(!ToolText.isMonospaced("BashOutput"))
  }
}
