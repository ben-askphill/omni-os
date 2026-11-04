// Questions an agent asks the user with ask_user_question (apps/mcp/ask.ts): asked, waited on, answered or dismissed.
// The thread's events hold them (packages/shared/question.ts), so they persist, stream and sync like any event. Which
// calls still wait, and how an answer reaches the agent, is waiters.ts, shared with secret-requests.ts.
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
import { publishFeed } from '../bus.ts';
import { events, threads } from '../db.ts';
import { notifyNeedsInput } from '../push-sender.ts';
import { addEvent, refusal } from './state.ts';
import { polling, settle, unpolled, untilSettled, type Via } from './waiters.ts';

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
  polling(id);
  if (q.state !== 'pending' || waitSec <= 0) return reply(q);
  await untilSettled(threadId, ANSWER_EVENT, id, waitSec, signal);
  return reply(find(threadId, id));
}

export type Answered = { state: QuestionState; via: Via } | { conflict: QuestionState };

/** Ben's answers. The first answer wins: a later one is a conflict, with the state the first left. */
export async function answerQuestion(threadId: string, id: string, raw: unknown): Promise<Answered> {
  const q = find(threadId, id);
  const parsed = parseAnswers(q.questions, raw);
  if (!parsed.ok) throw refusal(parsed.error, 400);
  if (q.state !== 'pending') return { conflict: q.state };
  const answers = parsed.value;
  const state = stateOf(answers) as AnswerPayload['state'];
  const via = await settle(threads.get(threadId)!, id, `question:${id}`, resultText(q.questions, state, answers), (via) =>
    addEvent(threadId, ANSWER_EVENT, { id, state, answers, via } satisfies AnswerPayload),
  );
  settled(threadId);
  return { state, via };
}

/** Ben wrote in the thread instead of answering: each waiting question is dismissed, so its call returns and the agent reads the message. */
export function dismissQuestions(threadId: string) {
  const open = questionsIn(events.questions(threadId)).filter((q) => q.state === 'pending');
  for (const q of open) {
    addEvent(threadId, ANSWER_EVENT, { id: q.id, state: 'dismissed', answers: null, via: 'tool' } satisfies AnswerPayload);
    unpolled(q.id);
  }
  if (open.length) settled(threadId);
}
