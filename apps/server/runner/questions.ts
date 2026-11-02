// Questions an agent asks the user with ask_user_question (apps/mcp/ask.ts): asked, waited on, answered or dismissed.
// The thread's events hold them (packages/shared/question.ts), so they persist, stream and sync like any event. Only
// which questions a tool call still polls for lives here, in memory: after a restart none does, and an answer goes to
// the thread as a message instead.
import { randomUUID } from 'node:crypto';
import {
  ANSWER_EVENT,
  parseAnswers,
  parseQuestions,
  QUESTION_EVENT,
  questionsIn,
  resultText,
  stateOf,
  type AnswerPayload,
  type CrewQuestion,
  type QuestionPayload,
  type QuestionState,
  type ThreadQuestion,
} from '@omni/shared/question.ts';
import { bus, publishFeed } from '../bus.ts';
import { events, threads } from '../db.ts';
import { notifyNeedsInput } from '../push-sender.ts';
import { turnBlocked } from '../sync/guard.ts';
import { saveOwn, wake } from './queue.ts';
import { addEvent, lives, refusal, runsHere } from './state.ts';

/** The longest one poll waits for an answer, in seconds. */
export const WAIT_MAX_SEC = 30;
/** A call that polled this recently still waits. Longer than one poll, so a poll in flight always counts. */
const WAITER_FRESH_MS = 35_000;

/** When a tool call last polled each question, by question id. */
const polled = new Map<string, number>();

function find(threadId: string, id: string): ThreadQuestion {
  if (!threads.get(threadId)) throw refusal('thread not found', 404);
  const q = questionsIn(events.questions(threadId, id))[0];
  if (!q) throw refusal('question not found', 404);
  return q;
}

/** What the waiting call returns to the agent. */
const reply = (q: ThreadQuestion) => ({ state: q.state, text: resultText(q.questions, q.state, q.answers) });

const settled = (threadId: string) => publishFeed({ type: 'needs_you', thread_id: threadId });

/**
 * The agent asks: a card in the thread, and a blocker in Needs you until Ben acts. A delegated thread's card also shows
 * on every thread above it (crewQuestions) and its blocker sits on the top one, the thread Ben delegated from, which
 * comes back out of done for it. Refused with what to fix.
 */
export function askQuestion(threadId: string, raw: unknown): { id: string } {
  if (!threads.get(threadId)) throw refusal('thread not found', 404);
  const parsed = parseQuestions(raw);
  if (!parsed.ok) throw refusal(parsed.error, 400);
  const id = randomUUID();
  addEvent(threadId, QUESTION_EVENT, { id, questions: parsed.value } satisfies QuestionPayload);
  const home = threads.root(threadId);
  if (home !== threadId) threads.setDone(home, false);
  settled(threadId);
  notifyNeedsInput(threadId);
  return { id };
}

/** The questions waiting on Ben in the threads delegated from this one, at any depth, in the order they were asked. */
export function crewQuestions(threadId: string): CrewQuestion[] {
  if (!threads.get(threadId)) throw refusal('thread not found', 404);
  return threads
    .descendants(threadId)
    .filter((t) => !t.archived)
    .flatMap((t) =>
      questionsIn(events.questions(t.id))
        .filter((q) => q.state === 'pending')
        .map((question) => ({ thread_id: t.id, thread_title: t.title, task_id: t.task_id, channel_id: t.channel_id, question })),
    )
    .sort((a, b) => a.question.event_id - b.question.event_id);
}

/**
 * A waiting call's poll: the question's state, at once when Ben already acted, else as soon as he does (here or, by
 * sync, on the other Mac), else still pending after `waitSec`. Each poll marks the call as still waiting.
 */
export async function awaitAnswer(threadId: string, id: string, waitSec: number, signal?: AbortSignal) {
  const q = find(threadId, id);
  polled.set(id, Date.now());
  if (q.state !== 'pending' || waitSec <= 0) return reply(q);
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      bus.off(`thread:${threadId}`, onEvent);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const onEvent = (e: { kind?: string; payload?: unknown }) => {
      if (e?.kind === ANSWER_EVENT && typeof e.payload === 'string' && (JSON.parse(e.payload) as AnswerPayload).id === id) done();
    };
    const timer = setTimeout(done, Math.min(waitSec, WAIT_MAX_SEC) * 1000);
    bus.on(`thread:${threadId}`, onEvent);
    signal?.addEventListener('abort', done, { once: true });
  });
  return reply(find(threadId, id));
}

/** A tool call still waits on the question: its thread's turn runs here and the call polled lately. */
const waitedOn = (threadId: string, id: string) => !!lives.get(threadId)?.turn && Date.now() - (polled.get(id) ?? 0) < WAITER_FRESH_MS;

export type Answered = { state: QuestionState; via: AnswerPayload['via'] } | { conflict: QuestionState };

/**
 * Ben's answers. The first answer wins: a later one is a conflict, with the state the first left. The waiting call
 * returns them; when no call waits any more (a restart, Stop, the harness's own timeout) they reach the thread as a
 * message instead, saved before it is woken, once.
 */
export function answerQuestion(threadId: string, id: string, raw: unknown): Answered {
  const q = find(threadId, id);
  const parsed = parseAnswers(q.questions, raw);
  if (!parsed.ok) throw refusal(parsed.error, 400);
  if (q.state !== 'pending') return { conflict: q.state };
  const via = waitedOn(threadId, id) ? 'tool' : 'message';
  if (via === 'message') {
    const blocked = turnBlocked(threads.get(threadId)!, runsHere(threadId));
    if (blocked) throw refusal(blocked, 409);
  }
  const answers = parsed.value;
  const state = stateOf(answers) as AnswerPayload['state'];
  addEvent(threadId, ANSWER_EVENT, { id, state, answers, via } satisfies AnswerPayload);
  polled.delete(id);
  if (via === 'message') {
    const row = saveOwn(threadId, `question:${id}`, { prompt: resultText(q.questions, state, answers), kind: 'user', source: 'ben', payload: null });
    if (row) wake(row);
  }
  settled(threadId);
  return { state, via };
}

/** Ben wrote in the thread instead of answering: each waiting question is dismissed, so its call returns and the agent reads the message. */
export function dismissQuestions(threadId: string) {
  const open = questionsIn(events.questions(threadId)).filter((q) => q.state === 'pending');
  for (const q of open) {
    addEvent(threadId, ANSWER_EVENT, { id: q.id, state: 'dismissed', answers: null, via: 'tool' } satisfies AnswerPayload);
    polled.delete(q.id);
  }
  if (open.length) settled(threadId);
}
