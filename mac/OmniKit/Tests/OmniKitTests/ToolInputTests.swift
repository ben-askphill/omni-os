import Foundation
import Testing
import OmniKit

// What ToolInput in web/src/components/Transcript.tsx shows for a call it expands. Pretty JSON is what
// JSON.stringify(input, null, 2) prints.

@Suite struct ToolInputTests {
  @Test func showsACommandWithItsDescription() throws {
    #expect(ToolInput(try toolUse("Bash", #"{"command":"npm test","description":"Run tests"}"#)) == .bash(description: "Run tests", command: "$ npm test"))
    #expect(ToolInput(try toolUse("Bash", #"{"command":"ls"}"#)) == .bash(description: nil, command: "$ ls"))
  }

  @Test func showsAnEditAsOldAndNewText() throws {
    let edit = ToolInput(try toolUse("Edit", #"{"file_path":"/a/b.ts","old_string":"x = 1","new_string":"x = 2"}"#))
    #expect(edit == .edits(path: "/a/b.ts", [ToolInput.Edit(old: "x = 1", new: "x = 2")]))
    let added = ToolInput(try toolUse("Edit", #"{"file_path":"/a/b.ts","new_string":"y"}"#))
    #expect(added == .edits(path: "/a/b.ts", [ToolInput.Edit(old: nil, new: "y")]))
  }

  @Test func showsTheFirstEightEditsOfAMultiEdit() throws {
    let edits = (1...10).map { #"{"old_string":"o\#($0)","new_string":"n\#($0)"}"# }.joined(separator: ",")
    guard case .edits(let path, let list) = ToolInput(try toolUse("MultiEdit", #"{"file_path":"/a","edits":[\#(edits)]}"#)) else {
      Issue.record("not edits")
      return
    }
    #expect(path == "/a")
    #expect(list.count == 8)
    #expect(list.first == ToolInput.Edit(old: "o1", new: "n1"))
    // Without an edits list, the call itself is the one edit.
    #expect(ToolInput(try toolUse("MultiEdit", #"{"file_path":"/a","old_string":"p","new_string":"q"}"#)) == .edits(path: "/a", [ToolInput.Edit(old: "p", new: "q")]))
  }

  @Test func showsTheFirst80LinesOfAWrite() throws {
    #expect(ToolInput(try toolUse("Write", #"{"file_path":"/a.md","content":"one\ntwo"}"#)) == .write(path: "/a.md", lines: 2, preview: "one\ntwo"))
    let content = (1...81).map(String.init).joined(separator: "\\n")
    let long = ToolInput(try toolUse("Write", #"{"file_path":"/a.md","content":"\#(content)"}"#))
    #expect(long == .write(path: "/a.md", lines: 81, preview: (1...80).map(String.init).joined(separator: "\n") + "\n..."))
    #expect(ToolInput(try toolUse("Write", #"{"file_path":"/e"}"#)) == .write(path: "/e", lines: 1, preview: ""))
  }

  @Test func showsASubAgentsPrompt() throws {
    #expect(ToolInput(try toolUse("Task", #"{"description":"d","prompt":"Find the cart"}"#)) == .prompt("Find the cart"))
    #expect(ToolInput(try toolUse("Agent", #"{"prompt":"Plan"}"#)) == .prompt("Plan"))
  }

  @Test func showsTodosAsAChecklist() throws {
    guard case .todos(let list) = ToolInput(try toolUse("TodoWrite", #"{"todos":[{"content":"A","status":"completed"},{"content":"B"}]}"#)) else {
      Issue.record("not todos")
      return
    }
    #expect(list.map(\.content) == ["A", "B"])
    #expect(list.map(\.state) == ["completed", "pending"])
  }

  @Test func printsAnyOtherInputAsJavaScriptWouldIndentIt() throws {
    let use = try toolUse("mcp__x__y", #"{"zeta":{"a":[1,{"b":"c\"d\\n"}],"e":{},"f":[]},"2":true,"alpha":null,"n":-1.5}"#)
    #expect(ToolInput(use) == .json("""
      {
        "2": true,
        "zeta": {
          "a": [
            1,
            {
              "b": "c\\"d\\\\n"
            }
          ],
          "e": {},
          "f": []
        },
        "alpha": null,
        "n": -1.5
      }
      """))
  }

  @Test func wrapsAnInputThatIsNotAnObject() throws {
    #expect(ToolInput(try toolUse("Other", "42")) == .json("{\n  \"value\": 42\n}"))
    #expect(ToolInput(try toolUse("Other", "null")) == .json("{\n  \"value\": null\n}"))
    #expect(ToolInput(try toolUse("Other", #"["a"]"#)) == .json("[\n  \"a\"\n]"))
    #expect(ToolInput(try toolUse("Other", #""hi""#)) == .json("{\n  \"value\": \"hi\"\n}"))
  }

  @Test func showsNothingForAnEmptyInput() throws {
    #expect(ToolInput(try toolUse("Other", "{}")) == .none)
    let row = try decode(EventRow.self, eventJSON(kind: "tool_use", payload: #"{"id":"u1","name":"Other"}"#))
    guard case .toolUse(let bare) = row.content else { Issue.record("not a tool use"); return }
    #expect(ToolInput(bare) == .none)
  }

  @Test func cutsLongJSONAt6000Units() throws {
    let use = try toolUse("Other", #"{"text":"\#(String(repeating: "x", count: 7000))"}"#)
    guard case .json(let s) = ToolInput(use) else { Issue.record("not json"); return }
    #expect(s.utf16.count == 6004)
    #expect(s.hasSuffix("xx\n..."))
    #expect(s.hasPrefix("{\n  \"text\": \"xxx"))
  }
}
