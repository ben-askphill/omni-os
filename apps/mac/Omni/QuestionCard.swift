import OmniKit
import SwiftUI

/// A question the agent asked with ask_user_question, in place of its tool call. Pending, Ben answers it here; once
/// answered, skipped or dismissed it folds to what he said.
struct QuestionCard: View {
  let question: ThreadQuestion
  let threadID: String
  let client: OmniClient
  let ui: TranscriptUI
  /// Once the server has the answer, or already had one (409). A card shown outside the asking thread has no stream to
  /// fold it.
  var answered: (@MainActor () -> Void)? = nil

  var body: some View {
    if question.state == .pending {
      VStack(alignment: .leading, spacing: z(10)) {
        PendingQuestionCard(question: question, threadID: threadID, client: client, ui: ui, answered: answered)
        StatusPill(glyph: .needs, label: QuestionState.pending.label)
      }
    } else {
      QuestionSummary(question: question)
    }
  }
}

/// The card to answer on: one page per question, a row per option and Other, then Skip and Next (Send on the last).
///
/// Keys work while the card has focus, which it takes when it appears unless Ben is typing in the reply box:
/// ↑/↓ move between rows (on a single choice question the pick follows), Space picks the row, ←/→ page, ⌘↵ is
/// Next or Send. ⌘↵ also works from the Other field. The reply box keeps its own ⌘↵ (a new line), since the card's
/// shortcut is only on while the card or its field has focus.
private struct PendingQuestionCard: View {
  let question: ThreadQuestion
  let threadID: String
  let client: OmniClient
  let ui: TranscriptUI
  let answered: (@MainActor () -> Void)?

  private enum Focus: Hashable { case card, other }
  @FocusState private var focus: Focus?
  /// The row the arrow keys are on: an option's index, or the option count for Other.
  @State private var cursor = 0
  @State private var sending = false
  @State private var error: String?

  /// Kept on the transcript's UI state, so a card the lazy stack drops and builds again keeps what Ben picked.
  private var draft: QuestionDraft { ui.drafts[question.id] ?? QuestionDraft(question.questions) }

  var body: some View {
    let d = draft
    let q = question.questions[d.page]
    let choice = d.picks[d.page]
    VStack(alignment: .leading, spacing: 0) {
      header(q, d)
      ForEach(Array(q.options.enumerated()), id: \.offset) { i, o in
        if i > 0 { hairline }
        row(i, q, on: choice.selected.contains(o.label)) {
          Text(o.label)
            .font(.omni(size: 13.5, weight: .semibold))
            .foregroundStyle(Tok.fg)
          if !o.description.isEmpty {
            Text(o.description)
              .font(.omni(size: 12.5))
              .foregroundStyle(Tok.fg3)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
      }
      hairline
      row(q.options.count, q, on: choice.otherOn) {
        Text("Other")
          .font(.omni(size: 13.5, weight: .semibold))
          .foregroundStyle(Tok.fg)
        Text("Type your own answer")
          .font(.omni(size: 12.5))
          .foregroundStyle(Tok.fg3)
      }
      if choice.otherOn {
        // Outside the row: the row's tap would take the field's clicks.
        TextField("Your answer", text: otherText)
          .textFieldStyle(.omni)
          .focused($focus, equals: .other)
          .onSubmit(advance)
          .onExitCommand { focus = .card }
          .padding(.leading, z(44))
          .padding(.trailing, z(16))
          .padding(.bottom, z(12))
      }
      hairline
      footer(d)
    }
    .background(Tok.surface)
    .clipShape(RoundedRectangle(cornerRadius: z(16), style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: z(16), style: .continuous).strokeBorder(Tok.line))
    .focusable()
    .focused($focus, equals: .card)
    .focusEffectDisabled()
    .onKeyPress(.upArrow) { onCard { move(-1) } }
    .onKeyPress(.downArrow) { onCard { move(1) } }
    .onKeyPress(.space) { onCard { pick(cursor) } }
    .onKeyPress(.leftArrow) { onCard { turn(-1) } }
    .onKeyPress(.rightArrow) { onCard { turn(1) } }
    .onAppear(perform: takeFocus)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Question from the agent")
  }

  // MARK: Parts

  private func header(_ q: Question, _ d: QuestionDraft) -> some View {
    HStack(alignment: .center, spacing: z(10)) {
      if let tag = q.header { Chip(text: tag) }
      Text(q.question)
        .font(.omni(size: 14, weight: .semibold))
        .foregroundStyle(Tok.fg)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
      if d.picks.count > 1 {
        HStack(spacing: z(2)) {
          Button { turn(-1) } label: { OmniIcon(name: "chevronLeft", size: 14) }
            .buttonStyle(.icon(size: 24))
            .disabled(d.page == 0 || sending)
            .help("Previous question")
            .accessibilityLabel("Previous question")
          Text("\(d.page + 1) of \(d.picks.count)")
            .font(.omni(size: 12, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(Tok.fg3)
            .fixedSize()
          Button { turn(1) } label: { OmniIcon(name: "chevronRight", size: 14) }
            .buttonStyle(.icon(size: 24))
            .disabled(!canTurnForward(d) || sending)
            .help("Next question")
            .accessibilityLabel("Next question")
        }
      }
    }
    .padding(.horizontal, z(16))
    .padding(.vertical, z(12))
    .background(Tok.surface2)
  }

  private func row(_ i: Int, _ q: Question, on: Bool, @ViewBuilder text: () -> some View) -> some View {
    HStack(alignment: .top, spacing: z(12)) {
      ChoiceMark(on: on, multi: q.multiSelect)
        .padding(.top, z(1.5))
      VStack(alignment: .leading, spacing: z(2)) { text() }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.horizontal, z(16))
    .padding(.vertical, z(10))
    .background(focus == .card && cursor == i ? Tok.wash : .clear)
    .contentShape(Rectangle())
    .onTapGesture {
      cursor = i
      focus = .card
      pick(i)
    }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
  }

  private var hairline: some View {
    Rectangle().fill(Tok.line).frame(height: 1)
  }

  private func footer(_ d: QuestionDraft) -> some View {
    HStack(spacing: z(8)) {
      if let error {
        GlyphView(glyph: .needs, size: 8)
        Text(error)
          .font(.omni(size: 12.5))
          .foregroundStyle(Tok.fg)
          .lineLimit(2)
          .textSelection(.enabled)
      }
      Spacer(minLength: 0)
      Button("Skip", action: skip)
        .buttonStyle(.pill(.secondary, height: 28))
        .disabled(sending)
        .help(d.isLastPage ? "Skip this question and send" : "Skip this question")
      Button(action: advance) {
        HStack(spacing: z(6)) {
          if sending { Loader(size: 12) }
          Text(d.isLastPage ? "Send" : "Next")
          Text("⌘↵")
            .font(.omni(size: 11, weight: .medium))
            .foregroundStyle(Tok.onInk.opacity(0.6))
        }
      }
      .buttonStyle(.pill(.primary, height: 28))
      .keyboardShortcut(focus != nil ? KeyboardShortcut(.return, modifiers: .command) : nil)
      .disabled(!d.canAdvance || sending)
    }
    .padding(.horizontal, z(12))
    .padding(.vertical, z(10))
  }

  private var otherText: Binding<String> {
    Binding(
      get: { draft.picks[draft.page].other },
      set: { text in update { $0.picks[$0.page].other = text } })
  }

  // MARK: Actions

  private func update(_ body: (inout QuestionDraft) -> Void) {
    var d = draft
    body(&d)
    ui.drafts[question.id] = d
  }

  private func onCard(_ action: () -> Void) -> KeyPress.Result {
    guard focus == .card, !sending else { return .ignored }
    action()
    return .handled
  }

  /// Takes focus for the keys, unless Ben is typing elsewhere.
  private func takeFocus() {
    if let field = NSApp.keyWindow?.firstResponder as? NSTextView, !field.string.isEmpty { return }
    focus = .card
  }

  private func move(_ by: Int) {
    let q = question.questions[draft.page]
    cursor = min(max(cursor + by, 0), q.options.count)
    if !q.multiSelect { choose(cursor) }
  }

  /// Picks the row: an option, or Other, whose field then takes the typing.
  private func pick(_ i: Int) {
    choose(i)
    if draft.picks[draft.page].otherOn && i == question.questions[draft.page].options.count { focus = .other }
  }

  private func choose(_ i: Int) {
    update { d in
      let q = question.questions[d.page]
      d.picks[d.page] = q.choose(i < q.options.count ? q.options[i].label : nil, in: d.picks[d.page])
      d.skipped[d.page] = false
    }
    error = nil
  }

  private func canTurnForward(_ d: QuestionDraft) -> Bool {
    !d.isLastPage && (d.canAdvance || d.skipped[d.page])
  }

  private func turn(_ by: Int) {
    let d = draft
    guard by < 0 ? d.page > 0 : canTurnForward(d) else { return }
    show(page: d.page + by)
  }

  private func show(page: Int) {
    update { $0.page = page }
    let q = question.questions[page]
    let pick = draft.picks[page]
    cursor = pick.otherOn && pick.selected.isEmpty ? q.options.count : q.options.firstIndex { pick.selected.contains($0.label) } ?? 0
    if focus == .other { focus = .card }
  }

  private func advance() {
    let d = draft
    guard d.canAdvance, !sending else { return }
    if d.isLastPage { send(d.answers) } else { show(page: d.page + 1) }
  }

  private func skip() {
    guard !sending else { return }
    update { $0.skipped[$0.page] = true }
    let d = draft
    if d.isLastPage { send(d.answers) } else { show(page: d.page + 1) }
  }

  /// Sends the answers. The card folds when the stream brings the answer event; a 409 means one is already there.
  private func send(_ answers: [QuestionAnswer?]) {
    sending = true
    error = nil
    let (client, threadID, id) = (client, threadID, question.id)
    Task {
      do throws(OmniAPIError) {
        _ = try await client.answerQuestion(threadID: threadID, questionID: id, answers: answers)
        answered?()
      } catch .http(status: 409, _) {
        answered?()
      } catch {
        self.error = error.message
        sending = false
      }
    }
  }
}

/// The pending questions of the threads delegated from this one, at any depth, so Ben answers them in the thread he
/// delegated from. Read when the thread opens, on each `needs_you` feed event (a question asked or answered anywhere,
/// the other Mac's included), when the feed opens again after missing events, and once a card's answer lands.
@MainActor @Observable final class CrewQuestionsModel {
  private(set) var items: [CrewQuestion] = []
  /// A sync sends `needs_you` in bursts: one load at a time, and one more after it when more came meanwhile.
  @ObservationIgnored private var loading = false
  @ObservationIgnored private var again = false

  func load(client: OmniClient, thread: String) {
    guard !loading else {
      again = true
      return
    }
    loading = true
    Task {
      repeat {
        again = false
        // A failed read keeps the last list.
        if let list = try? await client.crewQuestions(threadID: thread), list != items { items = list }
      } while again
      loading = false
    }
  }
}

/// Under the transcript, as CrewQuestions.tsx: each question a delegated thread asks, under "<task> · <title> asks",
/// which opens that thread. The card answers to that thread.
struct CrewQuestionCards: View {
  let model: AppModel
  let crew: CrewQuestionsModel
  let threadID: String
  let ui: TranscriptUI

  var body: some View {
    if !crew.items.isEmpty {
      VStack(alignment: .leading, spacing: z(16)) {
        ForEach(crew.items) { c in
          VStack(alignment: .leading, spacing: z(6)) {
            Button {
              model.route = .thread(id: c.threadID)
            } label: {
              HStack(spacing: z(6)) {
                OmniIcon(name: "message", size: 13)
                Text("\(c.byline) asks").lineLimit(1).truncationMode(.middle)
              }
              .font(.omni(size: 12))
              .foregroundStyle(Tok.fg3)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Open thread: \(c.threadTitle)")
            QuestionCard(question: c.question, threadID: c.threadID, client: model.client, ui: ui) {
              crew.load(client: model.client, thread: threadID)
            }
          }
        }
      }
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Questions from delegated threads")
    }
  }
}

/// A radio (single choice) or a checkbox (multi select), drawn in the app's ink.
private struct ChoiceMark: View {
  let on: Bool
  let multi: Bool

  var body: some View {
    ZStack {
      if multi {
        RoundedRectangle(cornerRadius: z(4), style: .continuous)
          .fill(on ? Tok.fg : .clear)
        RoundedRectangle(cornerRadius: z(4), style: .continuous)
          .strokeBorder(on ? Tok.fg : Tok.fg4, lineWidth: 1.5)
        if on {
          OmniIcon(name: "check", size: 12, weight: 3)
            .foregroundStyle(Tok.bg)
        }
      } else {
        Circle().strokeBorder(on ? Tok.fg : Tok.fg4, lineWidth: 1.5)
        if on {
          Circle().fill(Tok.fg).frame(width: z(8), height: z(8))
        }
      }
    }
    .frame(width: z(16), height: z(16))
    .animation(Motion.settle, value: on)
    .accessibilityHidden(true)
  }
}

/// An answered, skipped or dismissed question: each question with what Ben said, and what became of it.
private struct QuestionSummary: View {
  let question: ThreadQuestion

  var body: some View {
    VStack(alignment: .leading, spacing: z(10)) {
      HStack(spacing: z(6)) {
        OmniIcon(name: question.state == .answered ? "check" : "message", size: 13)
        Text(question.state.label)
      }
      .omniCaption()
      ForEach(Array(question.questions.enumerated()), id: \.offset) { i, q in
        VStack(alignment: .leading, spacing: z(2)) {
          Text(q.question)
            .font(.omni(size: 12.5))
            .foregroundStyle(Tok.fg3)
          if let words = question.words(at: i) {
            Text(words)
              .font(.omni(size: 13.5, weight: .medium))
              .foregroundStyle(question.answers?[i] == nil ? Tok.fg3 : Tok.fg)
          }
        }
        .fixedSize(horizontal: false, vertical: true)
        .textSelection(.enabled)
      }
    }
    .padding(.horizontal, z(16))
    .padding(.vertical, z(12))
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(16), style: .continuous))
    .accessibilityElement(children: .combine)
  }
}
