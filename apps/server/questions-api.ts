// /api/threads/:id/questions: what ask_user_question (crates/omni-mcp) asks and polls, and what the question card
// sends. apps/server/runner/questions.ts decides; the shared parsers' messages come back as 400s.
import { Hono, type Context } from 'hono';
import { callerOf, threadCredential } from './automation-guard.ts';
import { userName } from './profile.ts';
import { answerQuestion, askQuestion, awaitAnswer, crewQuestions, WAIT_MAX_SEC } from './runner.ts';

export const questionsApi = new Hono();

/** One field of a JSON body, or undefined when the body is not an object. The shared parser says what is wrong with it. */
async function field(c: Context, name: string): Promise<unknown> {
  const body = await c.req.json().catch(() => null);
  return body && typeof body === 'object' ? (body as Record<string, unknown>)[name] : undefined;
}

/** Ask: `{ questions }` in, `{ id }` out. */
questionsApi.post('/:id/questions', async (c) => {
  // A thread asks on its own card only: Ben's answer on another thread's card would count as his say there.
  const caller = threadCredential(c);
  if (caller && caller !== c.req.param('id')) return c.json({ error: 'A thread asks its questions on its own card.' }, 403);
  return c.json(askQuestion(c.req.param('id'), await field(c, 'questions')));
});

/** What the threads delegated from this one, at any depth, wait on Ben to answer: `{ items: CrewQuestion[] }`. */
questionsApi.get('/:id/crew-questions', (c) => c.json({ items: crewQuestions(c.req.param('id')) }));

/** Long poll, `?wait=<seconds>` up to 30: `{ state, text }`, with `text` what the agent reads. */
questionsApi.get('/:id/questions/:qid', async (c) => {
  const wait = Math.min(Math.max(Number(c.req.query('wait')) || 0, 0), WAIT_MAX_SEC);
  return c.json(await awaitAnswer(c.req.param('id'), c.req.param('qid'), wait, c.req.raw.signal));
});

/** Answer: `{ answers }` in, one per question (null skips it), `{ state, via }` out. A 409 when it was answered already, a 403 from an agent thread. */
questionsApi.post('/:id/questions/:qid/answer', async (c) => {
  // Only Ben answers, on the card: an answer is what the automation and crew guards read as his say in a thread.
  if (callerOf(c)) return c.json({ error: `Only ${userName()} answers a question, on its card.` }, 403);
  const r = await answerQuestion(c.req.param('id'), c.req.param('qid'), await field(c, 'answers'));
  return 'conflict' in r ? c.json({ error: 'These questions were already answered.', state: r.conflict }, 409) : c.json(r);
});
