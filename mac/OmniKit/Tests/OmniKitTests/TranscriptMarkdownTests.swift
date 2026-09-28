import Foundation
import Testing
import OmniKit

// What Copy and Copy Thread as Markdown put on the pasteboard.

private func row(_ kind: String, _ payload: String) -> (String, String) { (kind, payload) }

private let thread: [(String, String)] = [
  row("user", #"{"text":"fix the cart","attachments":[{"name":"a.png","path":"/u/a.png","size":10,"mime":"image/png","image":true}]}"#),
  row("tool_use", #"{"id":"a","name":"Bash","input":{"command":"npm test"},"parent":null}"#),
  row("tool_result", #"{"tool_use_id":"a","text":"ok","is_error":false,"truncated":false}"#),
  row("tool_use", #"{"id":"t","name":"Task","input":{"description":"Look"},"parent":null}"#),
  row("tool_use", #"{"id":"g","name":"Grep","input":{"pattern":"a`b"},"parent":"t"}"#),
  row("tool_result", #"{"tool_use_id":"g","text":"no","is_error":true,"truncated":false}"#),
  row("tool_use", #"{"id":"w","name":"TodoWrite","input":{"todos":[{"content":"One","status":"completed"},{"content":"Two","activeForm":"Doing two","status":"in_progress"}]},"parent":null}"#),
  row("tool_result", #"{"tool_use_id":"w","text":"[Request interrupted by user]","is_error":true,"truncated":false}"#),
  row("assistant_text", #"{"text":"Done. See `cart.ts`."}"#),
  row("result", #"{"ok":true,"subtype":"success","duration_ms":1000,"turns":1}"#),
  row("user", #"{"text":"more","source":"conductor","mode":"steer"}"#),
  row("error", #"{"text":"boom\n```x```"}"#),
  row("crew_report", #"{"text":"All good.","task_id":"T-1","thread_id":"c1","title":"Check the checkout","role":"dev","channel":"acme","status":"done"}"#),
  row("crew_report", #"{"text":"","thread_id":"c2"}"#),
]

@Suite struct TranscriptMarkdownTests {
  @Test func writesTheWholeThread() throws {
    let items = Transcript(try events(thread)).items
    #expect(TranscriptMarkdown.thread(title: "Fix the cart", items: items, cwd: nil) == """
      # Fix the cart

      **You**

      fix the cart

      Attached: a.png

      - Bash `npm test`
      - Task `Look`
        - Grep ``a`b`` (error)
      - TodoWrite `1/2 done` (stopped)

      **Plan** 1/2

      - [x] One
      - [ ] Two

      Done. See `cart.ts`.

      *done in 1s · 1 turn*

      **Conductor** · Steered

      more

      **Error**

      ````
      boom
      ```x```
      ````

      **Report from dev** · T-1 · done

      **Check the checkout**

      All good.

      **Report from crew**

      (no reply)

      """)
  }

  @Test func copiesOneRow() throws {
    let items = Transcript(try events(thread)).items
    let copied = items.map { TranscriptMarkdown.copyText($0, cwd: nil) }
    #expect(copied == [
      "fix the cart",
      "- Bash `npm test`\n- Task `Look`\n  - Grep ``a`b`` (error)\n- TodoWrite `1/2 done` (stopped)",
      "- [x] One\n- [ ] Two",
      "Done. See `cart.ts`.",
      "done in 1s · 1 turn",
      "more",
      "boom\n```x```",
      "All good.",
      "",
    ])
  }

  @Test func marksAMessageThatWasNotSent() throws {
    let items = Transcript(try events([row("user", #"{"text":"late","mode":"steer","dropped":true}"#)])).items
    #expect(TranscriptMarkdown.thread(title: "T", items: items, cwd: nil) == "# T\n\n**You** · Not sent\n\nlate\n")
  }

  @Test func shortensPathsToTheThreadsFolder() throws {
    let items = Transcript(try events([row("tool_use", #"{"id":"r","name":"Read","input":{"file_path":"/w/src/a.ts"},"parent":null}"#)])).items
    #expect(TranscriptMarkdown.copyText(try #require(items.first), cwd: "/w") == "- Read `src/a.ts`")
  }
}
