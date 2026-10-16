import Foundation
import Testing
import OmniKit

// The Changes panel's model on the recorded answers (tests/web-changes.test.ts checks the Web UI's against the same).

@Suite struct ChangesTests {
  @Test func groupsTheRecordedChanges() throws {
    let changes = try decodeFixture(BranchChanges.self, "changes.json")
    let view = try #require(ChangesView(changes))
    #expect(view.groups.map(\.kind) == [.committed, .staged, .unstaged, .untracked])
    #expect(view.groups.map { $0.files.map(\.file.label) } == [
      ["README.md", "legacy.txt", "logo.png", "src/cart.ts"],
      ["README.md → docs/README.md"],
      ["legacy.txt", "src/cart.ts"],
      ["notes.md"],
    ])
    #expect(view.fileCount == 8 && view.additions == 7 && view.deletions == 2)
    #expect(view.groups.map(\.kind.title) == ["Committed", "Staged", "Unstaged", "Untracked"])
    #expect("\(view.base.short), \(view.base.label)" == "ccccccc, main when the thread started")
    #expect(view.branch == "omni/00000000")
  }

  @Test func bindsNoticesAndLetters() throws {
    let view = try #require(ChangesView(try decodeFixture(BranchChanges.self, "changes.json")))
    let logo = view.groups[0].files[2]
    #expect(logo.file.notice == "Binary file, not shown.")
    #expect(logo.diff.binary && logo.diff.rows.isEmpty && logo.diff.add == 0)
    #expect(view.groups.map { $0.files.map(\.file.letter) } == [["A", "A", "A", "A"], ["R"], ["D", "M"], ["A"]])
    #expect(view.groups[0].files[0].file.notice == nil)
  }

  @Test func numbersLinesInTheOldAndNewFile() throws {
    let view = try #require(ChangesView(try decodeFixture(BranchChanges.self, "changes.json")))
    let cart = view.groups[2].files[1].diff
    #expect(cart.rows.map(\.kind) == [.hunk, .context, .del, .add, .context])
    #expect(cart.rows.map(\.old) == [nil, 1, 2, nil, 3])
    #expect(cart.rows.map(\.new) == [nil, 1, nil, 2, 3])
    #expect(cart.numbered)
  }

  @Test func unavailableSaysWhy() throws {
    let changes = try decodeFixture(BranchChanges.self, "changes-unavailable.json")
    #expect(!changes.available)
    #expect(changes.reason?.contains("no repository") == true)
    #expect(ChangesView(changes) == nil)
  }

  @Test func numbersAHunkWithoutCounts() {
    let rows = DiffLine.number(["@@ -5 +5,2 @@", " a", "+b", "\\ No newline at end of file", "@@@ -1 -1 +1 @@@", " c"])
    #expect(rows.map(\.old) == [nil, 5, nil, nil, nil, nil])
    #expect(rows.map(\.new) == [nil, 5, 6, nil, nil, nil])
    #expect(rows[3].kind == .note)
  }

  @Test func getsTheThreadsChanges() async throws {
    let t = StubTransport(body: try fixture("changes-unavailable.json"))
    let changes = try await OmniClient(port: 4799, transport: t).changes(forThread: "a b")
    #expect(!changes.available)
    #expect(t.requests.first?.url?.absoluteString == "http://127.0.0.1:4799/api/threads/a%20b/changes")
  }

  @Test func showsASavedTurn() throws {
    let changes = try decodeFixture(TurnChanges.self, "turns.json")
    #expect(changes.turns.map(\.title) == ["Turn 2", "Turn 1"])
    let view = try #require(TurnChangesView(changes))
    #expect(view.turn.id == changes.turns[0].id)
    #expect(view.turn.state == .ready && view.turn.stateNote == nil)
    #expect(view.turn.completionUID != nil)
    #expect(view.groups.map(\.kind.title) == ["Changed in this turn"])
    #expect(view.groups[0].files.map { [$0.file.letter, $0.file.label] } == [["M", "src/cart.ts"], ["A", "todo.md"]])
    #expect(view.fileCount == 2 && view.additions == 2 && view.deletions == 0)
    #expect(view.turn.headMove == "ccccccc → ccccccc")
    #expect(view.turn.before?.ref.hasPrefix("refs/omni/turns/") == true)
  }

  @Test func aTurnWithNothingToShowSaysWhy() throws {
    let unavailable = try decodeFixture(TurnChanges.self, "turns-unavailable.json")
    #expect(!unavailable.available && unavailable.reason?.contains("worktree") == true)
    #expect(TurnChangesView(unavailable) == nil)
  }

  @Test func getsATurnByID() async throws {
    let t = StubTransport(body: try fixture("turns-unavailable.json"))
    let client = OmniClient(port: 4799, transport: t)
    _ = try await client.turns(forThread: "a b")
    _ = try await client.turns(forThread: "a b", turn: "t 1")
    #expect(t.requests.map { $0.url?.absoluteString } == [
      "http://127.0.0.1:4799/api/threads/a%20b/turns",
      "http://127.0.0.1:4799/api/threads/a%20b/turns?turn=t%201",
    ])
  }
}
