// /api/threads/:id/secret-requests: what request_secret (apps/mcp/ask.ts) asks and polls, and what the secret card
// sends. apps/server/runner/secret-requests.ts decides. The value is in the submit body and nowhere else here: the
// body is parsed with a catch (a parse error quotes the body), never logged, and never echoed in an answer.
import { Hono, type Context } from 'hono';
import { askSecret, awaitSecret, cancelSecret, submitSecret, WAIT_MAX_SEC } from './runner.ts';

export const secretRequestsApi = new Hono();

const body = (c: Context): Promise<unknown> => c.req.json().catch(() => null);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

/** Ask: `{ name, label, scope?, reason? }` in, `{ id }` out. A 400 says what to fix. */
secretRequestsApi.post('/:id/secret-requests', async (c) => c.json(askSecret(c.req.param('id'), await body(c))));

/** Long poll, `?wait=<seconds>` up to 30: `{ state, text }`, with `text` what the agent reads. */
secretRequestsApi.get('/:id/secret-requests/:rid', async (c) => {
  const wait = Math.min(Math.max(Number(c.req.query('wait')) || 0, 0), WAIT_MAX_SEC);
  return c.json(await awaitSecret(c.req.param('id'), c.req.param('rid'), wait, c.req.raw.signal));
});

/**
 * Submit: `{ value, replace? }` in, `{ state: 'saved', replaced, via }` out. A 409 with `exists: true` when a secret
 * of that name is set in the scope and `replace` is not true (the store is untouched); a 409 with `state` when the
 * request was settled already.
 */
secretRequestsApi.post('/:id/secret-requests/:rid/submit', async (c) => {
  const b = await body(c);
  const value = isObj(b) && typeof b.value === 'string' ? b.value : '';
  const replace = isObj(b) && b.replace === true;
  const r = await submitSecret(c.req.param('id'), c.req.param('rid'), value, replace);
  if ('conflict' in r) return c.json({ error: 'This request was already settled.', state: r.conflict }, 409);
  if ('exists' in r) return c.json({ error: 'A secret of that name is already set for this scope.', exists: true }, 409);
  return c.json(r);
});

/** Cancel: `{ state: 'cancelled', via }` out. A 409 with `state` when the request was settled already. */
secretRequestsApi.post('/:id/secret-requests/:rid/cancel', async (c) => {
  const r = await cancelSecret(c.req.param('id'), c.req.param('rid'));
  return 'conflict' in r ? c.json({ error: 'This request was already settled.', state: r.conflict }, 409) : c.json(r);
});
