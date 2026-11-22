// Which questions a tool call still polls for (runner/questions.ts), in memory: after a restart none does. Apart from
// questions.ts so that postMessage (api.ts) can dismiss them while questions.ts delivers an answer through api.ts.
import { ANSWER_EVENT, questionsIn, type AnswerPayload } from '@omni/shared/question.ts';
import { events, threads } from '../db.ts';
import { polled, released, settled } from './question-polls.ts';
import { addEvent } from './state.ts';

export { polled, released, settled };

/** A reply dismisses the questions asked by the agents receiving it. Legacy rows with no author belong to the lead. */
export function dismissQuestions(threadId: string, recipients?: readonly string[] | null) {
  const lead = threads.get(threadId)?.role ?? '';
  const to = new Set(recipients ?? [lead]);
  const rows = events.questions(threadId);
  const authored = new Map(rows.map((r) => [r.id, r.agent ?? lead]));
  const open = questionsIn(rows).filter((q) => q.state === 'pending' && to.has(authored.get(q.event_id) ?? lead));
  for (const q of open) {
    addEvent(threadId, ANSWER_EVENT, { id: q.id, state: 'dismissed', answers: null, via: 'tool' } satisfies AnswerPayload);
    polled.delete(q.id);
    released.delete(q.id);
  }
  if (open.length) settled(threadId);
}
