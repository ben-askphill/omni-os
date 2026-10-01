// /api/channels/:id/prs and /api/threads/:id/pr: pull requests for a channel or a thread's branch.
import { Hono } from 'hono';
import { z } from 'zod';
import { channels, threads } from './db.ts';
import { branchPRs, getPR, listPRs, mergePR } from './github.ts';

export const githubApi = new Hono();

const repoOf = (channelId: string) => {
  const ch = channels.get(channelId);
  if (!ch?.github_repo) throw new Error('channel has no GitHub repo set');
  return ch.github_repo;
};

githubApi.get('/channels/:id/prs', async (c) => c.json(await listPRs(repoOf(c.req.param('id')), c.req.query('state') ?? 'open')));
githubApi.get('/channels/:id/prs/:n', async (c) => c.json(await getPR(repoOf(c.req.param('id')), Number(c.req.param('n')))));
// The PRs opened from a thread's branch, newest first, and `pr`, the one to show: the open one,
// else the newest. null and [] when there is none or no repo to ask.
githubApi.get('/threads/:id/pr', async (c) => {
  const t = threads.get(c.req.param('id'));
  if (!t) return c.json({ error: 'not found' }, 404);
  const repo = channels.get(t.channel_id)?.github_repo;
  if (!t.branch || !repo) return c.json({ pr: null, prs: [] });
  return c.json(await branchPRs(repo, t.branch));
});
githubApi.post('/channels/:id/prs/:n/merge', async (c) => {
  const { method, delete_branch, confirm } = z
    .object({ method: z.enum(['squash', 'merge', 'rebase']).default('squash'), delete_branch: z.boolean().default(true), confirm: z.literal(true) })
    .parse(await c.req.json());
  void confirm;
  const out = await mergePR(repoOf(c.req.param('id')), Number(c.req.param('n')), method, delete_branch);
  return c.json({ ok: true, output: out });
});
