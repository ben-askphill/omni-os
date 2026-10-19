import Testing
import OmniKit

@Suite struct UpdateCheckTests {
  let main = "3259341aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

  @Test func showsForACommitThatDiffersAndClearsWhenItMatches() {
    let behind = UpdateCheck.notices(serverHead: "14ff270bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", appCommit: main, mainHead: main)
    #expect(behind == UpdateNotices(serverBehind: true, appBehind: false))
    let app = UpdateCheck.notices(serverHead: main, appCommit: "14ff270bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", mainHead: main)
    #expect(app == UpdateNotices(serverBehind: false, appBehind: true))
    #expect(UpdateCheck.notices(serverHead: main, appCommit: main, mainHead: main).isEmpty)
  }

  @Test func whatItCannotKnowNeverShows() {
    #expect(UpdateCheck.notices(serverHead: nil, appCommit: nil, mainHead: main).isEmpty)
    #expect(UpdateCheck.notices(serverHead: "", appCommit: "", mainHead: main).isEmpty)
    #expect(UpdateCheck.notices(serverHead: "abc1234", appCommit: "def5678", mainHead: nil).isEmpty)
  }

  @Test func anAbbreviationMatchesButOnlyFromSevenCharacters() {
    #expect(UpdateCheck.same("3259341", main + "\n"))
    #expect(UpdateCheck.same("3259341AAA", main))
    #expect(!UpdateCheck.same("32593", main))
    #expect(!UpdateCheck.same("3259342", main))
  }
}
