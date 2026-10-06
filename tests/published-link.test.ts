import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// A page a thread publishes with the Artifact tool gets linked to the thread's artifacts: its URL on the row,
// a copy when the file lived outside the artifacts folder, the channel's pages in the next system prompt, and
// a route that asks the thread to act on the page's comments.

const r = await startRunner();
const { app } = await import('../server/app.ts');
const { artifactsDir } = await import('../server/config.ts');
const { buildSystemPrompt } = await import('../server/runner/prompts.ts');
const { backfillPublished, linkPublished } = await import('../server/published.ts');

const URL_RE = /^https:\/\/claude\.ai\/code\/artifact\/00000000-0000-4000-8000-\d{12}$/;

describe('a publish from a stream', () => {
  it('copies a page from outside the artifacts folder and links it', async () => {
    const src = join(r.tmp, 'scratch', 'report.html');
    writeFileSync(src, '<!doctype html><title>Report</title>');
    const t = await r.start(`PUBLISH:${src}`);
    await r.untilResults(t.id, 1);
    const rows = await r.until('linked artifact', () => r.db.artifacts.byThread(t.id).filter((a) => a.url).length && r.db.artifacts.byThread(t.id));
    const [a] = rows as Awaited<ReturnType<typeof r.db.artifacts.byThread>>;
    expect(a.path).toBe(join(artifactsDir(t.id), 'report.html'));
    expect(a.url).toMatch(URL_RE);
    expect(a.description).toBe('A fake page');
    expect(readFileSync(a.path, 'utf8')).toContain('<title>Report</title>');
  });

  it('links a page already in the artifacts folder without copying it', async () => {
    const t = await r.start('THINK:1');
    await r.untilResults(t.id, 1);
    const dir = artifactsDir(t.id);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'chart.html');
    writeFileSync(file, '<p>chart</p>');
    await r.runner.postMessage(t.id, `PUBLISH:${file}`);
    await r.untilResults(t.id, 2);
    const a = await r.until('linked', () => r.db.artifacts.byThread(t.id).find((x) => x.url));
    expect(a.path).toBe(file);
    expect(r.db.artifacts.byThread(t.id)).toHaveLength(1);
  });
});

describe('linkPublished', () => {
  it('overwrites its earlier copy on a republish and keeps one row per page', async () => {
    const t = await r.start('THINK:1');
    await r.untilResults(t.id, 1);
    const src = join(r.tmp, 'scratch', 'deck.html');
    const url = 'https://claude.ai/code/artifact/11111111-2222-4333-8444-555555555555';
    writeFileSync(src, 'v1');
    linkPublished(t.id, { url, file_path: src, title: 'deck.html', update: false });
    writeFileSync(src, 'v2');
    linkPublished(t.id, { url, file_path: src, title: 'deck.html', update: true });
    const rows = r.db.artifacts.byThread(t.id);
    expect(rows).toHaveLength(1);
    expect(readFileSync(rows[0].path, 'utf8')).toBe('v2');
  });

  it('picks a free name when the copy would overwrite another file', async () => {
    const t = await r.start('THINK:1');
    await r.untilResults(t.id, 1);
    mkdirSync(artifactsDir(t.id), { recursive: true });
    writeFileSync(join(artifactsDir(t.id), 'page.html'), 'mine');
    const src = join(r.tmp, 'scratch', 'page.html');
    writeFileSync(src, 'published');
    const a = linkPublished(t.id, { url: 'https://claude.ai/artifact/abc', file_path: src, title: 'page.html', update: false });
    expect(a?.name).toBe('page-2.html');
    expect(readFileSync(join(artifactsDir(t.id), 'page.html'), 'utf8')).toBe('mine');
  });

  it('records nothing for a page with no file, or a file that is gone', async () => {
    const t = await r.start('THINK:1');
    await r.untilResults(t.id, 1);
    expect(linkPublished(t.id, { url: 'https://claude.ai/artifact/x', title: 'Deck', update: false })).toBeNull();
    expect(linkPublished(t.id, { url: 'https://claude.ai/artifact/x', file_path: join(r.tmp, 'gone.html'), title: 'gone.html', update: false })).toBeNull();
    expect(existsSync(join(artifactsDir(t.id), 'gone.html'))).toBe(false);
  });
});

describe('backfillPublished', () => {
  it('links publishes recorded before Omni tracked them, once', async () => {
    const t = await r.start('THINK:1');
    await r.untilResults(t.id, 1);
    const src = join(r.tmp, 'scratch', 'old.html');
    writeFileSync(src, 'old');
    r.db.events.add(t.id, 'tool_use', { id: 'toolu_old', name: 'Artifact', input: { file_path: src } });
    r.db.events.add(t.id, 'tool_result', { tool_use_id: 'toolu_old', text: `Published ${src} at https://claude.ai/code/artifact/0ld`, is_error: false, truncated: false });
    r.db.kv.set('published.backfilled', false);
    backfillPublished();
    expect(r.db.artifacts.byThread(t.id).map((a) => a.url)).toEqual(['https://claude.ai/code/artifact/0ld']);
    expect(r.db.kv.get('published.backfilled')).toBe(true);
  });
});

describe('published pages in the system prompt', () => {
  it("lists the channel's pages for Claude Code threads only", async () => {
    const t = await r.start('THINK:1');
    await r.untilResults(t.id, 1);
    const channel = r.db.channels.get('scratch')!;
    const prompt = buildSystemPrompt(r.thread(t.id), channel);
    expect(prompt).toContain('## Published artifacts');
    expect(prompt).toContain('https://claude.ai/code/artifact/');
    expect(buildSystemPrompt({ ...r.thread(t.id), harness: 'codex' }, channel)).not.toContain('## Published artifacts');
  });
});

describe('GET /api/artifacts/published', () => {
  it('returns one row per page, newest first', async () => {
    const res = await app.request('/api/artifacts/published?channel=scratch');
    const list = (await res.json()) as { url: string }[];
    expect(res.status).toBe(200);
    expect(list.length).toBeGreaterThan(0);
    expect(new Set(list.map((a) => a.url)).size).toBe(list.length);
  });
});

describe('POST /api/threads/:id/published/comments', () => {
  it('queues a message that names the page', async () => {
    const t = await r.start('THINK:1');
    await r.untilResults(t.id, 1);
    const url = 'https://claude.ai/code/artifact/11111111-2222-4333-8444-555555555555';
    const res = await app.request(`/api/threads/${t.id}/published/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    expect(res.status).toBe(200);
    await r.untilResults(t.id, 2);
    expect(r.texts(t.id, 'user').at(-1)).toContain(`Check the comments on ${url}`);
  });

  it('refuses a url that is not a claude.ai artifact', async () => {
    const t = await r.start('THINK:1');
    await r.untilResults(t.id, 1);
    const res = await app.request(`/api/threads/${t.id}/published/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/x' }),
    });
    expect(res.status).toBe(400);
  });
});
