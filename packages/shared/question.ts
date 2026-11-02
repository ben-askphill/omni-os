// Questions an agent asks the user with Omni's ask_user_question tool (apps/mcp/ask.ts), the same shape as Claude
// Code's AskUserQuestion. Pure: the server parses a call and an answer with these, and formats what the agent gets back.
// apps/mac/OmniKit/Sources/OmniKit/Question.swift ports the client half (the draft and the answers it sends).

export interface QuestionOption {
  /** 1 to 5 words, shown bold. */
  label: string;
  /** One line under the label. */
  description: string;
}

export interface Question {
  question: string;
  /** A short tag for the question, at most HEADER_MAX characters. */
  header?: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

/** One question's answer: the option labels picked, and the "Other" text if Ben typed one. Null: Ben skipped it. */
export type Answer = { selected: string[]; other: string | null } | null;

/**
 * pending: waiting on Ben. answered: Ben answered at least one question. skipped: Ben skipped every question.
 * dismissed: Ben moved on without answering (sent a message, stopped or archived the thread).
 */
export type QuestionState = 'pending' | 'answered' | 'skipped' | 'dismissed';

export const QUESTIONS_MAX = 4;
export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 4;
export const HEADER_MAX = 12;
export const OTHER_MAX = 2000;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** An ask_user_question call's `questions`, or why it is refused. The error goes back to the agent, so it says what to fix. */
export function parseQuestions(raw: unknown): Parsed<Question[]> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > QUESTIONS_MAX) {
    return { ok: false, error: `questions must be a list of 1 to ${QUESTIONS_MAX} questions` };
  }
  const out: Question[] = [];
  for (const [i, q] of raw.entries()) {
    const at = `questions[${i}]`;
    if (!isObj(q)) return { ok: false, error: `${at} must be an object` };
    const question = text(q.question);
    if (!question) return { ok: false, error: `${at}.question is empty` };
    if (out.some((o) => o.question === question)) return { ok: false, error: `${at}.question repeats an earlier question` };
    const header = text(q.header);
    if (header.length > HEADER_MAX) return { ok: false, error: `${at}.header is longer than ${HEADER_MAX} characters` };
    if (q.multiSelect !== undefined && typeof q.multiSelect !== 'boolean') return { ok: false, error: `${at}.multiSelect must be true or false` };
    if (!Array.isArray(q.options) || q.options.length < OPTIONS_MIN || q.options.length > OPTIONS_MAX) {
      return { ok: false, error: `${at}.options must have ${OPTIONS_MIN} to ${OPTIONS_MAX} options` };
    }
    const options: QuestionOption[] = [];
    for (const [j, o] of q.options.entries()) {
      const label = isObj(o) ? text(o.label) : '';
      if (!label) return { ok: false, error: `${at}.options[${j}].label is empty` };
      if (/^other$/i.test(label)) return { ok: false, error: `${at}.options[${j}] is "Other": leave it out, the card always offers it` };
      if (options.some((p) => p.label === label)) return { ok: false, error: `${at}.options[${j}].label repeats "${label}"` };
      options.push({ label, description: isObj(o) ? text(o.description) : '' });
    }
    out.push({ question, ...(header && { header }), options, multiSelect: q.multiSelect === true });
  }
  return { ok: true, value: out };
}

/** Ben's answers to these questions, one per question in order, or why they do not fit. Clients send exactly this. */
export function parseAnswers(questions: Question[], raw: unknown): Parsed<Answer[]> {
  if (!Array.isArray(raw) || raw.length !== questions.length) return { ok: false, error: `answers must have ${questions.length} entries` };
  const out: Answer[] = [];
  for (const [i, a] of raw.entries()) {
    const q = questions[i];
    if (a === null) {
      out.push(null);
      continue;
    }
    if (!isObj(a) || !Array.isArray(a.selected)) return { ok: false, error: `answers[${i}] must be null or { selected, other }` };
    const labels = q.options.map((o) => o.label);
    const selected = labels.filter((l) => (a.selected as unknown[]).includes(l));
    if (selected.length !== a.selected.length) return { ok: false, error: `answers[${i}] picks an option the question does not have` };
    const other = text(a.other).slice(0, OTHER_MAX) || null;
    if (!selected.length && !other) return { ok: false, error: `answers[${i}] picks nothing: send null to skip it` };
    if (!q.multiSelect && selected.length + (other ? 1 : 0) > 1) return { ok: false, error: `answers[${i}] picks more than one on a single choice question` };
    out.push({ selected, other });
  }
  return { ok: true, value: out };
}

/** The state answers put a question in. */
export const stateOf = (answers: Answer[]): QuestionState => (answers.every((a) => a === null) ? 'skipped' : 'answered');

/** One answer as words: the labels picked, then the "Other" text. */
export function answerWords(a: Answer): string {
  if (!a) return 'Skipped';
  return [...a.selected, ...(a.other ? [a.other] : [])].join(', ');
}

/**
 * What the agent reads once Ben acts: the ask_user_question result, or the message that carries it when the call
 * did not live to see the answer (a restart). Worded like Claude Code's AskUserQuestion result, so agents read it the same way.
 */
export function resultText(questions: Question[], state: QuestionState, answers: Answer[] | null): string {
  if (state === 'skipped') return 'The user skipped these questions without answering. Go on with your best judgement and say what you assumed.';
  if (state === 'dismissed') return 'The user did not answer these questions. Read their latest message in the thread and go on from there.';
  if (state === 'pending' || !answers) return 'The user has not answered yet.';
  const pairs = questions.map((q, i) => `"${q.question}"="${answers[i] ? answerWords(answers[i]) : 'skipped, use your best judgement'}"`);
  return `User has answered your questions: ${pairs.join(', ')}. You can now continue with the user's answers in mind.`;
}

// ---------- in a thread ----------

/** The event kinds a question lives in: `question` when it is asked, `question_answer` once Ben acts. */
export const QUESTION_EVENT = 'question';
export const ANSWER_EVENT = 'question_answer';

/** The question tool's name as a harness reports the call, so clients can leave the raw call out of the transcript. */
export const isQuestionTool = (name: string) => /^mcp__omni[-_]ask__ask_user_question$/.test(name);

export interface QuestionPayload {
  id: string;
  questions: Question[];
}

export interface AnswerPayload {
  id: string;
  state: Exclude<QuestionState, 'pending'>;
  answers: Answer[] | null;
  /** How the agent got it: the waiting tool call, or a message that woke the thread (the call had ended). */
  via: 'tool' | 'message';
}

/** A question as a client shows it: where it was asked, and what became of it. */
export interface ThreadQuestion {
  id: string;
  /** The `question` event's id, where the card sits in the transcript. */
  event_id: number;
  questions: Question[];
  state: QuestionState;
  answers: Answer[] | null;
}

/**
 * A question a thread delegated from this one waits on (GET /threads/:id/crew-questions), so Ben answers it where he
 * works: the card posts to `thread_id`, the thread that asked. Only pending ones: once answered anywhere it is gone.
 */
export interface CrewQuestion {
  thread_id: string;
  thread_title: string;
  task_id: string | null;
  channel_id: string;
  question: ThreadQuestion;
}

type EventLike = { id: number; kind: string; payload: string | object };
const payloadOf = <T>(e: EventLike) => (typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload) as T;

/** Every question in a thread's events, oldest first, each with its answer when one came. */
export function questionsIn(events: readonly EventLike[]): ThreadQuestion[] {
  const out = new Map<string, ThreadQuestion>();
  for (const e of events) {
    if (e.kind === QUESTION_EVENT) {
      const p = payloadOf<QuestionPayload>(e);
      if (!out.has(p.id)) out.set(p.id, { id: p.id, event_id: e.id, questions: p.questions, state: 'pending', answers: null });
    } else if (e.kind === ANSWER_EVENT) {
      const p = payloadOf<AnswerPayload>(e);
      const q = out.get(p.id);
      if (q && q.state === 'pending') Object.assign(q, { state: p.state, answers: p.answers });
    }
  }
  return [...out.values()];
}

// ---------- the card ----------

/** What Ben has picked on one question so far. `other` is the typed text; `otherOn` whether the Other row is chosen. */
export interface Choice {
  selected: string[];
  otherOn: boolean;
  other: string;
}

/** The card's state: one pick per question, the page shown, and the questions Ben skipped. */
export interface Draft {
  page: number;
  picks: Choice[];
  skipped: boolean[];
}

/** A fresh card: the first option picked on a single choice question, nothing on a multi select one. */
export const newDraft = (questions: Question[]): Draft => ({
  page: 0,
  picks: questions.map((q) => ({ selected: q.multiSelect ? [] : [q.options[0].label], otherOn: false, other: '' })),
  skipped: questions.map(() => false),
});

/** Choose an option row, by its label, or Other with `null`. A single choice question swaps; a multi select one toggles. */
export function choose(q: Question, p: Choice, label: string | null): Choice {
  if (!q.multiSelect) return label === null ? { ...p, selected: [], otherOn: true } : { ...p, selected: [label], otherOn: false };
  if (label === null) return { ...p, otherOn: !p.otherOn };
  const on = p.selected.includes(label);
  const selected = q.options.map((o) => o.label).filter((l) => (l === label ? !on : p.selected.includes(l)));
  return { ...p, selected };
}

/** The answer a pick makes, or null when it picks nothing (an empty Other counts as nothing). */
export function answerOf(p: Choice): Answer {
  const other = p.otherOn ? p.other.trim() || null : null;
  return p.selected.length || other ? { selected: p.selected, other } : null;
}

/** Whether Next (or Send on the last page) can go: the shown question has an answer. */
export const canAdvance = (d: Draft) => answerOf(d.picks[d.page]) !== null;

export const isLastPage = (d: Draft) => d.page === d.picks.length - 1;

/** What the card sends: one answer per question, null for each one Ben skipped. */
export const answersOf = (d: Draft): Answer[] => d.picks.map((p, i) => (d.skipped[i] ? null : answerOf(p)));
