// /api/threads/:id/changes: the thread's branch changes since its base commit, before any PR (apps/server/changes.ts).
// /api/threads/:id/turns: its saved turns and what one of them changed (apps/server/turns.ts).
// /api/threads/:id/collisions/:event/dismiss: Ben takes a collision flag down (runner/collisions.ts).
import { Hono } from 'hono';
import { callerOf } from './automation-guard.ts';
import { threads } from './db.ts';
import { branchChanges } from './changes.ts';
import { turnChanges } from './turns.ts';
import { userName } from './profile.ts';
import { collisionsOf, dismissCollision } from './runner/collisions.ts';

export const changesApi = new Hono();

// 200 with `available: false` and why when the thread has no checkout here to read: Hermes, no repo, another Mac.
changesApi.get('/:id/changes', async (c) => {
  const t = threads.get(c.req.param('id'));
  if (!t) return c.json({ error: 'not found' }, 404);
  // One combined diff, with the files two agents both edited flagged (ADR 0019): no change is credited to an agent.
  return c.json({ ...(await branchChanges(t)), collisions: collisionsOf(t.id) });
});

// Only Ben: an agent thread, known by its token or caller header, gets a 403.
changesApi.post('/:id/collisions/:event/dismiss', (c) => {
  if (callerOf(c)) return c.json({ error: `Only ${userName()} dismisses a collision.` }, 403);
  const t = threads.get(c.req.param('id'));
  if (!t) return c.json({ error: 'not found' }, 404);
  const id = Number(c.req.param('event'));
  if (!Number.isInteger(id)) return c.json({ error: 'not found' }, 404);
  return c.json({ collisions: dismissCollision(t.id, id) });
});

// The newest turn's diff, or the one `?turn=` names. 404 for a turn that is not this thread's.
changesApi.get('/:id/turns', async (c) => {
  const t = threads.get(c.req.param('id'));
  if (!t) return c.json({ error: 'not found' }, 404);
  const out = await turnChanges(t, c.req.query('turn') || undefined);
  if (!out) return c.json({ error: 'turn not found' }, 404);
  return c.json(out);
});
