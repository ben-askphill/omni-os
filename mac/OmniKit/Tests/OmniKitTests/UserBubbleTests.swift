import Foundation
import Testing
import OmniKit

// The cases of tests/slash-pills.test.ts, and the rules of UserBubble and QueuedMessages in
// web/src/components/Transcript.tsx.

private func hit(_ name: String, _ start: Int, _ end: Int, source: String = "personal") throws -> SlashHit {
  try decode(SlashHit.self, #"{"name":"\#(name)","source":"\#(source)","description":"\#(name) description","start":\#(start),"end":\#(end)}"#)
}

private func slash(command: SlashHit? = nil, mentions: [SlashHit]? = nil) throws -> SlashRecord {
  let enc = { (h: SlashHit) in
    #"{"name":"\#(h.name)","source":"\#(h.source)","description":"\#(h.description)","start":\#(h.start),"end":\#(h.end)}"#
  }
  var fields: [String] = []
  if let command { fields.append(#""command":\#(enc(command))"#) }
  if let mentions { fields.append(#""mentions":[\#(mentions.map(enc).joined(separator: ","))]"#) }
  return try decode(SlashRecord.self, "{\(fields.joined(separator: ","))}")
}

private func message(_ json: String) throws -> UserMessage { try decode(UserMessage.self, json) }

private func pending(_ state: String, mode: String = "steer", kind: String = "user", task: String? = nil, role: String? = nil) throws -> PendingMsg {
  var s = #"{"uuid":"p1","kind":"\#(kind)","text":"more","mode":"\#(mode)","state":"\#(state)""#
  if let task { s += #","task_id":"\#(task)""# }
  if let role { s += #","role":"\#(role)""# }
  return try decode(PendingMsg.self, s + "}")
}

@Suite struct UserBubbleTests {
  @Test func makesAPillOfTheLeadingCommandAndOfEachMentionAfterIt() throws {
    let tdd = try hit("tdd", 0, 4), pdf = try hit("document-skills:pdf", 14, 18)
    #expect(SlashPiece.split("/tdd 31 using /pdf now", slash: try slash(command: tdd, mentions: [pdf])) == [
      SlashPiece("/tdd", hit: tdd), SlashPiece(" 31 using "), SlashPiece("/pdf", hit: pdf), SlashPiece(" now"),
    ])
  }

  @Test func makesPillsOfMentionsInAMessageThatStartsWithPlainText() throws {
    let a = try hit("tdd", 12, 16), b = try hit("tdd", 21, 25)
    #expect(SlashPiece.split("fix it with /tdd and /TDD", slash: try slash(mentions: [a, b])) == [
      SlashPiece("fix it with "), SlashPiece("/tdd", hit: a), SlashPiece(" and "), SlashPiece("/TDD", hit: b),
    ])
  }

  @Test func leavesTheTextWholeWithNoCommandsOrASpanThatNoLongerPointsAtAName() throws {
    #expect(SlashPiece.split("just text", slash: nil) == [SlashPiece("just text")])
    #expect(SlashPiece.split("just text", slash: try slash(mentions: [try hit("tdd", 2, 6)])) == [SlashPiece("just text")])
    #expect(SlashPiece.split("", slash: nil) == [])
  }

  @Test func splitsOnlyThePartThatIsShown() throws {
    let tdd = try hit("tdd", 0, 4), late = try hit("tdd", 12, 16)
    #expect(SlashPiece.split("fix it with /tdd", slash: try slash(command: tdd, mentions: [late]), visible: 10) == [SlashPiece("fix it wit")])
    #expect(SlashPiece.split("/tdd then more text", slash: try slash(command: tdd), visible: 9) == [SlashPiece("/tdd", hit: tdd), SlashPiece(" then")])
  }

  @Test func countsOffsetsInUTF16LikeJavaScript() throws {
    // "é" is one unit, "😀" two: the command after them starts at 5.
    let cmd = try hit("tdd", 5, 9)
    #expect(SlashPiece.split("é😀 a/tdd x", slash: try slash(mentions: [cmd])) == [SlashPiece("é😀 a"), SlashPiece("/tdd", hit: cmd), SlashPiece(" x")])
  }

  @Test func skipsAHitThatOverlapsTheOneBefore() throws {
    let a = try hit("tdd", 0, 4), b = try hit("td", 0, 3)
    #expect(SlashPiece.split("/tdd x", slash: try slash(command: a, mentions: [b])).count == 2)
  }

  @Test func cutsALongMessageAt1200UnitsPast1400() throws {
    let short = try message(#"{"text":"\#(String(repeating: "a", count: 1400))"}"#)
    #expect(!short.isLong)
    #expect(short.pieces(cut: true).map(\.text).joined().count == 1400)

    let long = try message(#"{"text":"\#(String(repeating: "a", count: 1401))"}"#)
    #expect(long.isLong)
    #expect(long.pieces(cut: true).map(\.text).joined().count == 1200)
    #expect(long.pieces(cut: false).map(\.text).joined().count == 1401)
  }

  @Test func neverCutsASurrogatePairInHalf() throws {
    let text = String(repeating: "a", count: 1199) + String(repeating: "😀", count: 200)
    let m = try message(#"{"text":"\#(text)"}"#)
    #expect(m.isLong)
    #expect(m.pieces(cut: true).map(\.text).joined() == String(repeating: "a", count: 1199))
  }

  @Test(arguments: [
    (#"{"text":"x","source":"conductor"}"#, "from Conductor"),
    (#"{"text":"x","source":"automation"}"#, "Automation"),
    (#"{"text":"x","source":"capture"}"#, "Captured"),
    (#"{"text":"x","source":"import"}"#, "Imported"),
    (#"{"text":"x","source":"ben"}"#, nil),
    (#"{"text":"x"}"#, nil),
  ] as [(String, String?)])
  func labelsTheSource(_ json: String, _ want: String?) throws {
    #expect(try message(json).sourceLabel == want)
  }

  @Test(arguments: [
    (#"{"text":"x","mode":"steer"}"#, "Steered"),
    (#"{"text":"x","mode":"interrupt"}"#, "Interrupted and sent"),
    (#"{"text":"x","mode":"queue"}"#, nil),
    (#"{"text":"x","mode":"steer","dropped":true}"#, nil),
    (#"{"text":"x"}"#, nil),
  ] as [(String, String?)])
  func labelsHowItWasSent(_ json: String, _ want: String?) throws {
    #expect(try message(json).sendLabel == want)
  }

  @Test(arguments: [
    ("project", "project"), ("personal", "personal"), ("plugin", "plugin"), ("mcp", "mcp"), ("builtin", "built-in"),
    ("omni", "omni"), ("other", "other"),
  ])
  func tagsACommandsSource(_ source: String, _ want: String) throws {
    #expect(try hit("x", 0, 2, source: source).sourceTag == want)
  }

  @Test func labelsAMessageTheAgentHasNotRead() throws {
    #expect(try pending("waiting").label(lead: false) == "Waiting for a free slot")
    #expect(try pending("held").label(lead: false) == "Queued, runs after this turn")
    #expect(try pending("sent").label(lead: true) == "Sent, starting now")
    #expect(try pending("sent", mode: "interrupt").label(lead: false) == "Interrupting, runs next")
    #expect(try pending("sent").label(lead: false) == "Steering, delivered at its next step")
  }

  @Test func labelsACrewReportTheAgentHasNotRead() throws {
    #expect(try pending("sent", kind: "crew_report", task: "T-1", role: "dev").label(lead: true) == "Crew report T-1 from dev, starting now")
    #expect(try pending("sent", kind: "crew_report").label(lead: false) == "Crew report, delivered at its next step")
    #expect(try pending("waiting", kind: "crew_report", role: "qa").label(lead: false) == "Crew report from qa, waiting for a free slot")
    #expect(try pending("held", kind: "crew_report", task: "T-2").label(lead: false) == "Crew report T-2 queued")
  }

  @Test func leadsWithTheFirstSentMessageOnlyBetweenTurns() throws {
    let list = [try pending("held"), try pending("sent"), try pending("sent")]
    #expect(PendingMsg.lead(in: list, starting: true) == 1)
    #expect(PendingMsg.lead(in: list, starting: false) == nil)
    #expect(PendingMsg.lead(in: [try pending("held")], starting: true) == nil)
  }

  @Test func aThumbnailKeepsItsShapeInsideTheBox() {
    #expect(Attachment.thumbnailSize(CGSize(width: 320, height: 200)) == CGSize(width: 224, height: 140))
    #expect(Attachment.thumbnailSize(CGSize(width: 100, height: 400)) == CGSize(width: 44, height: 176))
    #expect(Attachment.thumbnailSize(CGSize(width: 80, height: 60)) == CGSize(width: 80, height: 60), "never scaled up")
    #expect(Attachment.thumbnailSize(.zero) == .zero)
  }
}
