// /api/channels/:id/prs and /api/threads/:id/pr: pull requests for a channel or a thread's branch.
import { Hono } from 'hono';
import { z } from 'zod';
import { channels, threads } from './db.ts';
import { branchPRs, getPR, listPRs, mergePR, threadPRMarks } from './github.ts';
import { fetchPRImage, githubImage, proxyPRImages } from './github-images.ts';

export const githubApi = new Hono();

const repoOf = (channelId: string) => {
  const ch = channels.get(channelId);
  if (!ch?.github_repo) throw new Error('channel has no GitHub repo set');
  return ch.github_repo;
};

githubApi.get('/channels/:id/prs', async (c) => c.json(await listPRs(repoOf(c.req.param('id')), c.req.query('state') ?? 'open')));
// Branch name to the open or merged PR from it, for marking threads in a list. {} with no repo or when gh fails.
githubApi.get('/channels/:id/thread-prs', async (c) => {
  const repo = channels.get(c.req.param('id'))?.github_repo;
  if (!repo) return c.json({});
  return c.json(await threadPRMarks(repo).catch(() => ({})));
});
// Bodies come back with GitHub-hosted images pointed at the image route below, so private ones load too.
githubApi.get('/channels/:id/prs/:n', async (c) => {
  const id = c.req.param('id');
  const n = Number(c.req.param('n'));
  const pr = await getPR(repoOf(id), n);
  const fix = (body: string | null | undefined) => (body ? proxyPRImages(body, `/api/channels/${encodeURIComponent(id)}/prs/${n}/image?src=`) : body);
  return c.json({
    ...pr,
    body: fix(pr.body),
    reviews: pr.reviews?.map((r: { body?: string }) => ({ ...r, body: fix(r.body) })),
    comments: pr.comments?.map((m: { body?: string }) => ({ ...m, body: fix(m.body) })),
  });
});
// One image from a PR's conversation, fetched with gh's GitHub login. Only GitHub image URLs are served.
githubApi.get('/channels/:id/prs/:n/image', async (c) => {
  const src = c.req.query('src') ?? '';
  if (!githubImage(src)) return c.json({ error: 'not a GitHub image URL' }, 400);
  const img = await fetchPRImage(repoOf(c.req.param('id')), Number(c.req.param('n')), src);
  if (!img) return c.json({ error: 'image not found' }, 404);
  return c.body(new Uint8Array(img.bytes), 200, {
    'Content-Type': img.type,
    'Cache-Control': 'private, max-age=3600',
    // An SVG opened on its own must not run scripts on Omni's origin.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'X-Content-Type-Options': 'nosniff',
  });
});
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
