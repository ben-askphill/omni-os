// /api/threads/:id/pr-watch: start, stop and read a thread's PR watch. /api/pr-watches: every watch on this Mac.
import { Hono } from 'hono';
import { z } from 'zod';
import { channels, outbox, threads } from '../db.ts';
import { branchPRs } from '../github.ts';
import { prWatches, view } from './store.ts';
import { BASE_S, kick } from './worker.ts';

export const prWatchApi = new Hono();

const refused = (message: string, status = 409) => Object.assign(new Error(message), { status });

prWatchApi.get('/pr-watches', (c) => c.json(prWatches.all().map(view)));

prWatchApi.get('/threads/:id/pr-watch', (c) => {
  const id = c.req.param('id');
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  const w = prWatches.get(id);
  return c.json(w ? view(w) : null);
});

// Watch the thread branch's open PR, or the PR `number` names. Starting a stopped watch again resets its wake budget.
prWatchApi.put('/threads/:id/pr-watch', async (c) => {
  const id = c.req.param('id');
  const t = threads.get(id);
  if (!t) return c.json({ error: 'not found' }, 404);
  const { number } = z.object({ number: z.number().int().positive().optional() }).parse(await c.req.json().catch(() => ({})));
  if (t.archived) throw refused('This thread is archived. Unarchive it to watch its PR.');
  const repo = channels.get(t.channel_id)?.github_repo;
  if (!repo) throw refused("This thread's channel has no GitHub repo set.");
  let n = number;
  if (!n) {
    if (!t.branch) throw refused('This thread works without a branch, so it has no PR to watch.');
    const pr = (await branchPRs(repo, t.branch)).pr;
    if (!pr || (pr.state ?? 'OPEN') !== 'OPEN') throw refused('This thread has no open PR to watch.');
    n = pr.number as number;
  }
  const w = prWatches.start(id, repo, n, outbox.machineId(), BASE_S, new Date().toISOString());
  kick();
  return c.json(view(w));
});

prWatchApi.delete('/threads/:id/pr-watch', (c) => {
  const id = c.req.param('id');
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  prWatches.stop(id, 'stopped', new Date().toISOString());
  const w = prWatches.get(id);
  return c.json(w ? view(w) : null);
});
