import Foundation
import Testing
import OmniKit

// Questions from ask_user_question: the event payloads, what became of each, and the card's draft, with the same
// cases as packages/shared/tests/question.test.ts.

private func opt(_ label: String) -> QuestionOption { QuestionOption(label: label, description: "\(label) description") }
private let single = Question(question: "Which goal first?", options: [opt("Acne"), opt("Volero")])
private let multi = Question(question: "Which stores?", options: [opt("NL"), opt("DE"), opt("FR")], multiSelect: true)

private let asked = (
  "question",
  #"{"id":"q1","questions":[{"question":"Which goal first?","header":"Goal","options":[{"label":"Acne","description":"Acne description"},{"label":"Volero","description":"Volero description"}],"multiSelect":false}]}"#
)
private func answered(_ state: String, answers: String = "null", id: String = "q1") -> (String, String) {
  ("question_answer", #"{"id":"\#(id)","state":"\#(state)","answers":\#(answers),"via":"tool"}"#)
}
private let askCall = ("tool_use", #"{"id":"call1","name":"mcp__omni-ask__ask_user_question","input":{"questions":[]}}"#)
private let askResult = ("tool_result", #"{"tool_use_id":"call1","text":"User has answered","is_error":false,"truncated":false}"#)

private func encoded(_ value: some Encodable) throws -> String {
  String(decoding: try OmniJSON.encoder().encode(value), as: UTF8.self)
}

/// Both layouts of the transcript, which must agree.
private func layouts(_ list: [(String, String)]) throws -> [TranscriptItem] {
  let e = try events(list)
  let built = Transcript.build(e)
  var live = Transcript()
  for n in e.indices { live.update(Array(e[...n])) }
  #expect(live.items == built)
  #expect(Transcript(e).items == built)
  return built
}

private func questions(_ items: [TranscriptItem]) -> [ThreadQuestion] {
  items.compactMap { if case .question(let q) = $0 { q } else { nil } }
}

@Suite struct QuestionTests {
  @Test func decodesTheTwoEventPayloads() throws {
    let e = try events([asked, answered("answered", answers: #"[{"selected":["Acne"],"other":null}]"#)])
    guard case .question(let p) = e[0].content else { Issue.record("not a question: \(e[0].content)"); return }
    #expect(p.id == "q1")
    #expect(p.questions == [Question(question: "Which goal first?", header: "Goal", options: [opt("Acne"), opt("Volero")])])
    guard case .questionAnswer(let a) = e[1].content else { Issue.record("not an answer: \(e[1].content)"); return }
    #expect(a.state == .answered)
    #expect(a.answers == [QuestionAnswer(selected: ["Acne"], other: nil)])
    #expect(a.via == .tool)
  }

  @Test func defaultsMultiSelectToFalse() throws {
    let e = try events([("question", #"{"id":"q1","questions":[{"question":"Which?","options":[{"label":"A","description":""},{"label":"B","description":""}]}]}"#)])
    guard case .question(let p) = e[0].content else { Issue.record("not a question"); return }
    #expect(p.questions[0].multiSelect == false)
    #expect(p.questions[0].header == nil)
  }

  @Test func readsAQuestionAsPendingUntilItsAnswerEvent() throws {
    #expect(ThreadQuestion.all(in: try events([asked])) == [
      ThreadQuestion(id: "q1", eventID: 1, questions: [Question(question: "Which goal first?", header: "Goal", options: [opt("Acne"), opt("Volero")])])
    ])
    let later = try events([asked, ("assistant_text", #"{"text":"waiting"}"#), answered("answered", answers: #"[{"selected":["Acne"],"other":null}]"#)])
    let q = try #require(ThreadQuestion.all(in: later).first)
    #expect(q.state == .answered)
    #expect(q.answers == [QuestionAnswer(selected: ["Acne"], other: nil)])
  }

  @Test func keepsTheFirstAnswerWhenTwoArrive() throws {
    let q = try #require(ThreadQuestion.all(in: try events([asked, answered("dismissed"), answered("skipped")])).first)
    #expect(q.state == .dismissed)
    #expect(q.answers == nil)
  }

  @Test func preselectsTheFirstOptionOnASingleChoiceQuestionOnly() {
    let d = QuestionDraft([single, multi])
    #expect(d.answers == [QuestionAnswer(selected: ["Acne"], other: nil), nil])
    #expect(d.canAdvance)
    var second = d
    second.page = 1
    #expect(!second.canAdvance)
  }

  @Test func swapsOnSingleChoiceAndTogglesOnMultiSelectKeepingOptionOrder() {
    #expect(single.choose("Volero", in: QuestionDraft([single]).picks[0]).selected == ["Volero"])
    var p = QuestionDraft([multi]).picks[0]
    p = multi.choose("FR", in: p)
    p = multi.choose("NL", in: p)
    #expect(p.selected == ["NL", "FR"])
    #expect(multi.choose("FR", in: p).selected == ["NL"])
  }

  @Test func countsOtherOnlyOnceItHasText() {
    var p = single.choose(nil, in: QuestionDraft([single]).picks[0])
    #expect(p.answer == nil)
    p.other = " Both "
    #expect(p.answer == QuestionAnswer(selected: [], other: "Both"))
  }

  @Test func sendsNullForASkippedQuestion() {
    var d = QuestionDraft([single, multi])
    d.skipped = [true, false]
    #expect(d.answers == [nil, nil])
  }

  @Test func encodesAnswersAsTheServerReadsThem() throws {
    struct Body: Encodable { let answers: [QuestionAnswer?] }
    let body = Body(answers: [QuestionAnswer(selected: ["NL", "FR"], other: nil), nil, QuestionAnswer(selected: [], other: "BE")])
    #expect(try encoded(body) == #"{"answers":[{"other":null,"selected":["NL","FR"]},null,{"other":"BE","selected":[]}]}"#)
  }

  @Test func postsTheAnswersToTheQuestion() async throws {
    let t = StubTransport(body: #"{"state":"answered","via":"tool"}"#)
    let r = try await OmniClient(port: 4799, transport: t).answerQuestion(
      threadID: "t 1", questionID: "q1", answers: [QuestionAnswer(selected: ["Acne"], other: nil), nil])
    #expect(r.state == .answered)
    #expect(r.via == .tool)
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "POST")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/threads/t%201/questions/q1/answer")
    #expect(try bodyJSON(req) == .object(["answers": .array([.object(["selected": .array([.string("Acne")]), "other": .null]), .null])]))
  }

  @Test func listsTheQuestionsTheCrewWaitsOnWithTheThreadThatAsked() async throws {
    let t = StubTransport(body: try fixture("crew-questions.json"))
    let list = try await OmniClient(port: 4799, transport: t).crewQuestions(threadID: "conductor")
    #expect(t.requests[0].url?.path == "/api/threads/conductor/crew-questions")
    #expect(list.count == 1)
    let q = try #require(list.first)
    #expect(q.threadID == "00000000-0000-4000-8000-000000000074")
    #expect(q.channelID == "acme")
    #expect(q.byline == "T-7C8B · Size the digest")
    #expect(q.id == q.question.id)
    #expect(q.question.eventID == 230)
    #expect(q.question.state == .pending && q.question.answers == nil)
    #expect(q.question.questions.map(\.header) == ["Digest"])
    #expect(q.question.questions[0].options.map(\.label) == ["Acme EU", "Acme US"])

    let untitled = try OmniJSON.decoder().decode(
      CrewQuestion.self,
      from: Data(
        #"{"thread_id":"t2","thread_title":"","task_id":null,"channel_id":"acme","question":{"id":"q2","event_id":3,"questions":[],"state":"pending","answers":null}}"#
          .utf8))
    #expect(untitled.byline == "Untitled")
  }

  @Test func saysEachAnswerInWords() {
    #expect(QuestionAnswer.words(QuestionAnswer(selected: ["NL", "FR"], other: "BE")) == "NL, FR, BE")
    #expect(QuestionAnswer.words(nil) == "Skipped")
  }

  @Test func recognizesTheQuestionToolUnderEitherServerName() {
    #expect(Question.isTool("mcp__omni-ask__ask_user_question"))
    #expect(Question.isTool("mcp__omni_ask__ask_user_question"))
    #expect(!Question.isTool("AskUserQuestion"))
    #expect(!Question.isTool("mcp__omni-ask__ask_user_question_v2"))
  }

  @Test func showsTheCardInPlaceOfItsToolCall() throws {
    let items = try layouts([
      ("user", #"{"text":"plan it"}"#), ("tool_use", #"{"id":"r","name":"Read","input":{}}"#), askCall, asked, askResult,
      ("assistant_text", #"{"text":"Going with Acne."}"#),
    ])
    #expect(items.map(\.id) == [.event(1), .event(2), .event(4), .event(6)])
    guard case .tools(let g) = items[1] else { Issue.record("not the tools: \(items[1])"); return }
    #expect(g.calls.map(\.name) == ["Read"])
    #expect(questions(items).map(\.state) == [.pending])
  }

  @Test func foldsTheCardOnceAnswered() throws {
    let items = try layouts([askCall, asked, answered("answered", answers: #"[{"selected":[],"other":"Pink Gellac"}]"#), askResult])
    #expect(items.map(\.id) == [.event(2)])
    let q = try #require(questions(items).first)
    #expect(q.state == .answered)
    #expect(q.words(at: 0) == "Pink Gellac")
  }

  @Test func waitsOnAPendingQuestionWithoutTheWorkingLine() throws {
    let pending = Transcript(try events([("user", #"{"text":"go"}"#), askCall, asked]))
    #expect(pending.hasPendingQuestion)
    #expect(pending.waitsOnQuestion)
    #expect(!pending.showsWorking(running: true))
    let done = Transcript(try events([("user", #"{"text":"go"}"#), askCall, asked, answered("skipped", answers: "[null]")]))
    #expect(!done.hasPendingQuestion)
    #expect(done.showsWorking(running: true))
  }

  @Test func listsAQuestionBlockerAsWaitingOnBen() throws {
    let json = #"{"thread":\#(threadJSON()),"result":null,"blockers":[{"kind":"question","detail":"Which goal first?","count":1}],"at":"2026-09-28T07:57:15.045Z"}"#
    let item = try OmniJSON.decoder().decode(NeedsYouItem.self, from: Data(json.utf8))
    #expect(item.blockers.first?.kind == .question)
    #expect(item.reason.tone == .needs)
    #expect(item.reason.label == "Waiting on your answer")
    #expect(item.reason.detail == "Which goal first?")
  }
}
