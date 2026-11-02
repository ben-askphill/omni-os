import Foundation

// Questions an agent asks Ben with Omni's ask_user_question tool (apps/mcp/ask.ts). The client half of
// packages/shared/question.ts: the event payloads, what became of each question, and the card's draft.

public struct QuestionOption: Codable, Hashable, Sendable {
  public let label: String
  public let description: String

  public init(label: String, description: String) {
    self.label = label
    self.description = description
  }
}

public struct Question: Codable, Hashable, Sendable {
  public let question: String
  /// A short tag, at most 12 characters.
  public let header: String?
  public let options: [QuestionOption]
  public let multiSelect: Bool

  public init(question: String, header: String? = nil, options: [QuestionOption], multiSelect: Bool = false) {
    self.question = question
    self.header = header
    self.options = options
    self.multiSelect = multiSelect
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    question = try c.decode(String.self, forKey: .question)
    header = try c.decodeIfPresent(String.self, forKey: .header).flatMap { $0.isEmpty ? nil : $0 }
    options = try c.decode([QuestionOption].self, forKey: .options)
    multiSelect = try c.decodeIfPresent(Bool.self, forKey: .multiSelect) ?? false
  }

  /// The question tool's name as a harness reports the call. The card stands in for that call in the transcript.
  public static func isTool(_ name: String) -> Bool {
    name.wholeMatch(of: /mcp__omni[-_]ask__ask_user_question/) != nil
  }

  /// Picks an option row by its label, or Other with nil. A single choice question swaps; a multi select one toggles.
  public func choose(_ label: String?, in p: QuestionChoice) -> QuestionChoice {
    var p = p
    guard multiSelect else {
      p.selected = label.map { [$0] } ?? []
      p.otherOn = label == nil
      return p
    }
    guard let label else {
      p.otherOn.toggle()
      return p
    }
    let on = p.selected.contains(label)
    p.selected = options.map(\.label).filter { $0 == label ? !on : p.selected.contains($0) }
    return p
  }
}

/// One question's answer: the option labels picked, and the Other text if Ben typed one. A skipped question has none
/// (nil where a list of answers holds it).
public struct QuestionAnswer: Codable, Hashable, Sendable {
  public let selected: [String]
  public let other: String?

  public init(selected: [String], other: String?) {
    self.selected = selected
    self.other = other
  }

  enum CodingKeys: String, CodingKey { case selected, other }

  /// `other` is written as null when there is none: the server reads `{selected, other}`.
  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(selected, forKey: .selected)
    if let other { try c.encode(other, forKey: .other) } else { try c.encodeNil(forKey: .other) }
  }

  /// The labels picked, then the Other text: "NL, FR, BE". "Skipped" for none.
  public static func words(_ a: QuestionAnswer?) -> String {
    guard let a else { return "Skipped" }
    return (a.selected + (a.other.map { [$0] } ?? [])).joined(separator: ", ")
  }
}

/// pending: waiting on Ben. answered: he answered at least one question. skipped: he skipped them all.
/// dismissed: he moved on without answering (sent a message, stopped or archived the thread).
public enum QuestionState: String, Codable, Hashable, Sendable {
  case pending, answered, skipped, dismissed

  /// The card's state line, and the thread's status while one is pending.
  public var label: String {
    switch self {
    case .pending: "Needs your input"
    case .answered: "Answered"
    case .skipped: "Skipped"
    case .dismissed: "Not answered"
    }
  }
}

/// kind `question`: the agent asked.
public struct QuestionPayload: Decodable, Hashable, Sendable {
  public let id: String
  public let questions: [Question]
}

/// kind `question_answer`: Ben acted on a question. The first one for a question wins.
public struct QuestionAnswerPayload: Decodable, Hashable, Sendable {
  public enum Via: String, Decodable, Hashable, Sendable {
    /// The waiting tool call returned it.
    case tool
    /// A message woke the thread, since the call had ended.
    case message
  }

  public let id: String
  public let state: QuestionState
  /// One per question, nil for a skipped one. nil when dismissed.
  public let answers: [QuestionAnswer?]?
  public let via: Via
}

/// A question as the thread shows it: where it was asked and what became of it.
public struct ThreadQuestion: Hashable, Sendable {
  public let id: String
  /// The `question` event, where the card sits.
  public let eventID: Int
  public let questions: [Question]
  public internal(set) var state = QuestionState.pending
  public internal(set) var answers: [QuestionAnswer?]?

  public init(id: String, eventID: Int, questions: [Question], state: QuestionState = .pending, answers: [QuestionAnswer?]? = nil) {
    self.id = id
    self.eventID = eventID
    self.questions = questions
    self.state = state
    self.answers = answers
  }

  /// Ben's answer to the question at `i` as words, nil while there is none to show (pending or dismissed).
  public func words(at i: Int) -> String? {
    guard let answers, answers.indices.contains(i) else { return nil }
    return QuestionAnswer.words(answers[i])
  }

  /// The first answer to a pending question settles it; any later one is ignored.
  mutating func settle(_ a: QuestionAnswerPayload) {
    guard state == .pending, a.id == id else { return }
    state = a.state
    answers = a.answers
  }

  /// Every question in a thread's events, oldest first, each with its answer when one came.
  public static func all(in events: [EventRow]) -> [ThreadQuestion] {
    var out: [ThreadQuestion] = []
    for e in events {
      switch e.content {
      case .question(let p) where !out.contains(where: { $0.id == p.id }):
        out.append(ThreadQuestion(id: p.id, eventID: e.id, questions: p.questions))
      case .questionAnswer(let a):
        if let i = out.firstIndex(where: { $0.id == a.id }) { out[i].settle(a) }
      default: break
      }
    }
    return out
  }
}

/// GET /api/threads/:id/crew-questions sends it with `event_id` in the asking thread.
extension ThreadQuestion: Decodable {
  enum CodingKeys: String, CodingKey {
    case id, questions, state, answers
    case eventID = "event_id"
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      id: try c.decode(String.self, forKey: .id), eventID: try c.decode(Int.self, forKey: .eventID),
      questions: try c.decode([Question].self, forKey: .questions), state: try c.decode(QuestionState.self, forKey: .state),
      answers: try c.decodeIfPresent([QuestionAnswer?].self, forKey: .answers))
  }
}

/// A question a thread delegated from the open one waits on, at any depth: `CrewQuestion` in
/// packages/shared/question.ts. Pending only. Its card answers to `threadID`, the thread that asked.
public struct CrewQuestion: Decodable, Hashable, Sendable, Identifiable {
  public let threadID: String
  public let threadTitle: String
  public let taskID: String?
  public let channelID: String
  public let question: ThreadQuestion

  public var id: String { question.id }
  /// The task it was for, if any, and the thread that asked: "T-AB12 · Build the export", as `CrewPullRequest.byline`.
  public var byline: String {
    [taskID, threadTitle.isEmpty ? "Untitled" : threadTitle].compactMap { $0 }.joined(separator: " · ")
  }

  enum CodingKeys: String, CodingKey {
    case question
    case threadID = "thread_id"
    case threadTitle = "thread_title"
    case taskID = "task_id"
    case channelID = "channel_id"
  }
}

/// What Ben has picked on one question so far. `other` is the typed text; `otherOn` whether the Other row is chosen.
public struct QuestionChoice: Hashable, Sendable {
  public var selected: [String]
  public var otherOn = false
  public var other = ""

  public init(selected: [String], otherOn: Bool = false, other: String = "") {
    self.selected = selected
    self.otherOn = otherOn
    self.other = other
  }

  /// The answer it makes, or nil when it picks nothing (an empty Other counts as nothing).
  public var answer: QuestionAnswer? {
    let typed = other.trimmingCharacters(in: .whitespacesAndNewlines)
    let text = otherOn && !typed.isEmpty ? typed : nil
    return selected.isEmpty && text == nil ? nil : QuestionAnswer(selected: selected, other: text)
  }
}

/// The card's state: one pick per question, the page shown, and the questions Ben skipped.
public struct QuestionDraft: Hashable, Sendable {
  public var page = 0
  public var picks: [QuestionChoice]
  public var skipped: [Bool]

  /// A fresh card: the first option picked on a single choice question, nothing on a multi select one.
  public init(_ questions: [Question]) {
    picks = questions.map { QuestionChoice(selected: $0.multiSelect ? [] : $0.options.prefix(1).map(\.label)) }
    skipped = questions.map { _ in false }
  }

  /// Next (or Send on the last page) can go: the shown question has an answer.
  public var canAdvance: Bool { picks[page].answer != nil }
  public var isLastPage: Bool { page == picks.count - 1 }
  /// What the card sends: one answer per question, nil for each one Ben skipped.
  public var answers: [QuestionAnswer?] { picks.indices.map { skipped[$0] ? nil : picks[$0].answer } }
}

/// POST /api/threads/:id/questions/:qid/answer.
public struct QuestionAnswerReceipt: Decodable, Hashable, Sendable {
  public let state: QuestionState
  public let via: QuestionAnswerPayload.Via?
}

private struct AnswersBody: Encodable, Sendable {
  let answers: [QuestionAnswer?]
}

private struct CrewQuestionsReply: Decodable {
  let items: [CrewQuestion]
}

extension OmniClient {
  /// Ben's answers to a question, one per question in order, nil for each he skipped. 409 when it already has one.
  public func answerQuestion(threadID: String, questionID: String, answers: [QuestionAnswer?]) async throws(OmniAPIError)
    -> QuestionAnswerReceipt
  {
    try await send(
      "POST", "/api/threads/\(uriComponent(threadID))/questions/\(uriComponent(questionID))/answer", body: AnswersBody(answers: answers))
  }

  /// The questions the threads delegated from this one wait on, oldest asked first. Answer each on its own `threadID`.
  public func crewQuestions(threadID: String) async throws(OmniAPIError) -> [CrewQuestion] {
    let reply: CrewQuestionsReply = try await send("GET", "/api/threads/\(uriComponent(threadID))/crew-questions")
    return reply.items
  }
}
