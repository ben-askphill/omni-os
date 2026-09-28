import Foundation
import Testing
import OmniKit

@Suite struct DiffParserTests {
  let renamed = """
    diff --git a/old/name.ts b/new/name.ts
    similarity index 90%
    rename from old/name.ts
    rename to new/name.ts
    index 111..222 100644
    --- a/old/name.ts
    +++ b/new/name.ts
    @@ -1,3 +1,3 @@
     keep
    -gone
    +here
    diff --git a/logo.png b/logo.png
    index 333..444 100644
    Binary files a/logo.png and b/logo.png differ
    diff --git a/src/a.ts b/src/a.ts
    --- a/src/a.ts
    +++ b/src/a.ts
    @@ -1 +1,2 @@
    +one
    +two
    \\ No newline at end of file

    """

  @Test func splitsFilesAndCountsLines() {
    let files = DiffParser.parse(renamed)
    #expect(files.map(\.path) == ["new/name.ts", "logo.png", "src/a.ts"])
    #expect(files.map(\.add) == [1, 0, 2])
    #expect(files.map(\.del) == [1, 0, 0])
  }

  @Test func headerLinesStayOutOfTheCounts() {
    // "--- a/..." and "+++ b/..." sit before the first hunk, so they are header, not removed or added lines.
    let file = DiffParser.parse(renamed)[0]
    #expect(file.lines.first == "@@ -1,3 +1,3 @@")
    #expect(file.header.contains("--- a/old/name.ts"))
    #expect(file.lines.count == 4)
  }

  @Test func marksBinaryFiles() {
    let files = DiffParser.parse(renamed)
    #expect(files.map(\.binary) == [false, true, false])
    #expect(files[1].lines.isEmpty)
  }

  @Test func countsDashDashDashInsideAHunk() {
    let files = DiffParser.parse("diff --git a/x b/x\n@@ -1 +1 @@\n--- removed text\n+++ added text\n")
    #expect(files[0].add == 1 && files[0].del == 1)
  }

  @Test func textWithoutAGitHeaderIsOneFile() {
    let files = DiffParser.parse("Could not load diff: gh failed\n")
    #expect(files.map(\.path) == ["(diff)"])
    #expect(DiffParser.parse("  \n\n").isEmpty)
  }

  @Test func keepsCarriageReturnsOnTheLine() {
    let files = DiffParser.parse("diff --git a/x b/x\n@@ -1 +1 @@\r\n-a\r\n+b\r\n")
    #expect(files[0].lines == ["@@ -1 +1 @@\r", "-a\r", "+b\r"])
  }

  @Test func opensEveryFileUnlessTheDiffIsBigAndTheFileIsLong() {
    func file(changes: Int) -> FileDiff {
      FileDiff(path: "f", header: [], lines: [], add: changes, del: 0, binary: false)
    }
    let small = (0..<12).map { _ in file(changes: 500) }
    #expect(small.allSatisfy { DiffParser.startsOpen($0, fileCount: small.count) })
    #expect(DiffParser.startsOpen(file(changes: 199), fileCount: 13))
    #expect(!DiffParser.startsOpen(file(changes: 200), fileCount: 13))
    #expect(DiffParser.startsOpen(file(changes: 0), fileCount: 40))
  }

  @Test func showsAtMostTheLineCapUntilAsked() {
    let lines = (0..<1600).map { "+\($0)" }
    let f = FileDiff(path: "f", header: [], lines: lines, add: 1600, del: 0, binary: false)
    #expect(f.shown(all: false).count == 1500)
    #expect(f.shown(all: true).count == 1600)
    #expect(f.hiddenLines == 100)
  }
}

@Suite struct PullRequestTests {
  @Test func openMeansNoStateOrOPEN() {
    #expect(PullRequestState.isOpen(nil))
    #expect(PullRequestState.isOpen("OPEN"))
    #expect(!PullRequestState.isOpen("MERGED"))
    #expect(!PullRequestState.isOpen("CLOSED"))
  }

  @Test func mergeRequestCarriesTheConfirmationTheAPIRequires() async throws {
    let t = StubTransport(body: #"{"ok":true,"output":"Merged"}"#)
    let out = try await OmniClient(port: 4799, transport: t).merge(
      pullRequest: 4, in: "acme", method: .rebase, deleteBranch: false)
    #expect(out == "Merged")
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "POST")
    #expect(req.url?.path == "/api/channels/acme/prs/4/merge")
    #expect(try bodyJSON(req) == .object(["method": .string("rebase"), "delete_branch": .bool(false), "confirm": .bool(true)]))
  }

  @Test func listAsksForTheStateAndDetailForTheNumber() async throws {
    let t = StubTransport(body: "[]")
    let client = OmniClient(port: 4799, transport: t)
    _ = try await client.pullRequests(in: "acme", state: .merged)
    #expect(t.requests[0].url?.absoluteString == "http://127.0.0.1:4799/api/channels/acme/prs?state=merged")
  }

  @Test func decodesTheListAndTheDetail() throws {
    let list = try decodeFixture([PullRequestSummary].self, "prs.json")
    #expect(list.count >= 2)
    #expect(list.contains { $0.isDraft })
    let detail = try decodeFixture(PullRequestDetail.self, "pr.json")
    #expect(detail.number == 12)
    #expect(!detail.diff.isEmpty)
    #expect(detail.checkRuns.count == detail.checks.passed + detail.checks.failed + detail.checks.pending)
  }

  @Test func reviewThreadIsABuilderThreadOnThePR() {
    let new = PullRequestDetail.reviewThread(number: 12, repo: "acme/shop", channel: "acme")
    #expect(new.channel == "acme" && new.role == "builder")
    #expect(new.prompt == "Review PR #12 in acme/shop: summarize the change, risks, and anything that should block merge.")
  }

  @Test func hidesHTMLCommentsFromDescriptions() {
    #expect(PullRequestDetail.cleanBody("<!-- template -->\nReal text\n<!--\nmulti\nline -->") == "Real text")
    #expect(PullRequestDetail.cleanBody(nil) == "")
  }

  @Test func checkStatesGroupAsTheWebUIDoes() {
    #expect(CheckRun(name: "a", state: "SUCCESS", url: nil).tone == .ok)
    #expect(CheckRun(name: "a", state: "SKIPPED", url: nil).tone == .ok)
    #expect(CheckRun(name: "a", state: "TIMED_OUT", url: nil).tone == .bad)
    #expect(CheckRun(name: "a", state: "IN_PROGRESS", url: nil).tone == .pending)
    #expect(CheckRun(name: "a", state: "", url: nil).tone == .pending)
  }
}
