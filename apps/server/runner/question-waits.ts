// Which questions a tool call still polls for (runner/questions.ts), in memory: after a restart none does. Apart from
// questions.ts so that postMessage (api.ts) can dismiss them while questions.ts delivers an answer through api.ts.
import { ANSWER_EVENT, questionsIn, type AnswerPayload } from '@omni/shared/question.ts';
import { publishFeed } from '../bus.ts';
import { events } from '../db.ts';
import { addEvent } from './state.ts';

/** When a tool call last polled each question, by question id. */
export const polled = new Map<string, number>();

/** Needs you recounts the thread's blockers. */
export const settled = (threadId: string) => publishFeed({ type: 'needs_you', thread_id: threadId });

/** Ben wrote in the thread instead of answering: each waiting question is dismissed, so its call returns and the agent reads the message. */
export function dismissQuestions(threadId: string) {
  const open = questionsIn(events.questions(threadId)).filter((q) => q.state === 'pending');
  for (const q of open) {
    addEvent(threadId, ANSWER_EVENT, { id: q.id, state: 'dismissed', answers: null, via: 'tool' } satisfies AnswerPayload);
    polled.delete(q.id);
  }
  if (open.length) settled(threadId);
}
