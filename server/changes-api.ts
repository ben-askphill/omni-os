// /api/threads/:id/changes: the thread's branch changes since its base commit, before any PR (server/changes.ts).
import { Hono } from 'hono';
import { threads } from './db.ts';
import { branchChanges } from './changes.ts';

export const changesApi = new Hono();

// 200 with `available: false` and why when the thread has no checkout here to read: Hermes, no repo, another Mac.
changesApi.get('/:id/changes', async (c) => {
  const t = threads.get(c.req.param('id'));
  if (!t) return c.json({ error: 'not found' }, 404);
  return c.json(await branchChanges(t));
});
