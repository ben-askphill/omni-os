// /api/threads/:id/changes: the thread's branch changes since its base commit, before any PR (apps/server/changes.ts).
// /api/threads/:id/turns: its saved turns and what one of them changed (apps/server/turns.ts).
import { Hono } from 'hono';
import { threads } from './db.ts';
import { branchChanges } from './changes.ts';
import { turnChanges } from './turns.ts';

export const changesApi = new Hono();

// 200 with `available: false` and why when the thread has no checkout here to read: Hermes, no repo, another Mac.
changesApi.get('/:id/changes', async (c) => {
  const t = threads.get(c.req.param('id'));
  if (!t) return c.json({ error: 'not found' }, 404);
  return c.json(await branchChanges(t));
});

// The newest turn's diff, or the one `?turn=` names. 404 for a turn that is not this thread's.
changesApi.get('/:id/turns', async (c) => {
  const t = threads.get(c.req.param('id'));
  if (!t) return c.json({ error: 'not found' }, 404);
  const out = await turnChanges(t, c.req.query('turn') || undefined);
  if (!out) return c.json({ error: 'turn not found' }, 404);
  return c.json(out);
});
