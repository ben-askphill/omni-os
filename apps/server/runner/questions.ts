// Questions an agent asks the user with ask_user_question (crates/omni-mcp): asked, waited on, answered or dismissed.
// The thread's events hold them (packages/shared/question.ts), so they persist, stream and sync like any event. Only
// which questions a tool call still polls for lives in memory (question-waits.ts): after a restart none does, and an
// answer goes to the thread as a message instead.
import { randomUUID } from 'node:crypto';
import {
  ANSWER_EVENT,
  approvalResultText,
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
import { bus } from '../bus.ts';
import { events, threads } from '../db.ts';
import { notifyNeedsInput } from '../push-sender.ts';
import { remoteHolder } from '../ownership.ts';
import { runningElsewhere, turnBlocked } from '../sync/guard.ts';
import { runnerPorts } from './ports.ts';
import { wakePrepared } from './api.ts';
import { polled, settled } from './question-waits.ts';
import { saveOwn } from './queue.ts';
import { addEvent, lives, refusal, runsHere } from './state.ts';

/** The longest one poll waits for an answer, in seconds. */
export const WAIT_MAX_SEC = 30;
/** A call that polled this recently still waits. Longer than one poll, so a poll in flight always counts. */
const WAITER_FRESH_MS = 35_000;

function find(threadId: string, id: string): ThreadQuestion {
  if (!threads.get(threadId)) throw refusal('thread not found', 404);
  const q = questionsIn(events.questions(threadId, id))[0];
  if (!q) throw refusal('question not found', 404);
  return q;
}

/** What the waiting call returns to the agent. */
const reply = (q: ThreadQuestion) => ({ state: q.state, text: resultText(q.questions, q.state, q.answers) });

/**
 * The agent asks: a card in the thread, and a blocker in Needs you until Ben acts. A delegated thread's card also shows
 * on every thread above it (crewQuestions) and its blocker and push alert go to the top one, the thread Ben delegated
 * from, or the newest thread that continues it (threads.home), which comes back out of done for it. Refused with what to
 * fix.
 */
export function askQuestion(threadId: string, raw: unknown): { id: string } {
  if (!threads.get(threadId)) throw refusal('thread not found', 404);
  const parsed = parseQuestions(raw);
  if (!parsed.ok) throw refusal(parsed.error, 400);
  const id = randomUUID();
  addEvent(threadId, QUESTION_EVENT, { id, questions: parsed.value } satisfies QuestionPayload);
  const home = threads.home(threadId);
  if (home !== threadId) threads.setDone(home, false);
  settled(threadId);
  notifyNeedsInput(threadId, parsed.value[0]?.question ?? null);
  return { id };
}

/** This thread and the ones it continues (continue.ts), newest first. Each id once, so a broken link cannot loop. */
function continuedLine(threadId: string): string[] {
  const line: string[] = [];
  for (let t = threads.get(threadId); t && !line.includes(t.id); t = t.continued_from ? threads.get(t.continued_from) : undefined) line.push(t.id);
  return line;
}

/**
 * The questions waiting on Ben in the threads delegated from this one, at any depth, in the order they were asked. A
 * continued thread also shows those of the crew its earlier threads delegated, since Ben works on in the newest.
 */
export function crewQuestions(threadId: string): CrewQuestion[] {
  if (!threads.get(threadId)) throw refusal('thread not found', 404);
  return continuedLine(threadId)
    .flatMap((id) => threads.descendants(id))
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
 * message instead, saved before it is woken, once. A thread whose turn runs on another machine has its call there,
 * however it got there (sent there, delegated, a reply or Take over there): the answer event syncs to it and that call
 * returns. Between turns, the answer goes as a forwarded message to a machine that keeps the thread (remoteHolder), and
 * otherwise runs the thread here, as Ben's reply would.
 */
export async function answerQuestion(threadId: string, id: string, raw: unknown): Promise<Answered> {
  const q = find(threadId, id);
  const parsed = parseAnswers(q.questions, raw);
  if (!parsed.ok) throw refusal(parsed.error, 400);
  if (q.state !== 'pending') return { conflict: q.state };
  const thread = threads.get(threadId)!;
  const holder = remoteHolder(thread);
  const via = waitedOn(threadId, id) || runningElsewhere(thread) ? 'tool' : 'message';
  const answers = parsed.value;
  const state = stateOf(answers) as AnswerPayload['state'];
  // An approval whose call ended before the answer (a restart): the call was refused then, so the message says what
  // the user decided and that the call may be made again.
  const asMessage = q.approval ? approvalResultText(q.approval, answers) : resultText(q.questions, state, answers);
  if (via === 'message' && holder) {
    await runnerPorts().routing.forwardMessage(thread, asMessage, { mode: 'steer', from: 'ben' });
  } else if (via === 'message') {
    const blocked = turnBlocked(thread, runsHere(threadId));
    if (blocked) throw refusal(blocked, 409);
  }
  addEvent(threadId, ANSWER_EVENT, { id, state, answers, via } satisfies AnswerPayload);
  polled.delete(id);
  if (via === 'message' && !holder) {
    // Ben's reply, delivered as one (run-on.ts does the same with a forwarded one): it runs the thread here even when
    // another machine ran it last, which a wake of Omni's own never does.
    const row = saveOwn(threadId, `question:${id}`, { prompt: asMessage, kind: 'user', source: 'ben', payload: null });
    if (row) void wakePrepared(row).catch((err) => console.error(`[questions] ${id}:`, (err as Error).message));
  }
  settled(threadId);
  return { state, via };
}
