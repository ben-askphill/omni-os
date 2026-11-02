import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderedFrom, renderedText } from '@omni/shared/html-render.ts';
import { startRunner } from './runner-boot.ts';

// html_render (apps/mcp/render.ts) posts a page here. It is saved under artifacts/renders/ and recorded at once; the
// transcript's frame loads it with `?frame=1`, which adds the script that reports its height and takes Omni's theme.

const r = await startRunner({});
const { rendersApi } = await import('../renders-api.ts');
const { artifactsApi } = await import('../artifacts-api.ts');

const thread = r.db.threads.create({
  id: randomUUID(), channel_id: 'scratch', title: 'T', status: 'done', role: null, model: null, session_id: randomUUID(),
  cwd: r.tmp, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
});
const page = '<!doctype html><html><head><title>Q3</title></head><body><button>go</button></body></html>';
const post = (body: unknown, id = thread.id) =>
  rendersApi.request(`/${id}/renders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const raw = (id: number, q = '') => artifactsApi.request(`/${id}/raw${q}`);

describe('POST /api/threads/:id/renders', () => {
  it('saves the page under artifacts/renders and records it as the thread artifact', async () => {
    const res = await post({ title: 'Commits by package', html: page });
    expect(res.status).toBe(200);
    const { artifact } = (await res.json()) as { artifact: { id: number; path: string; kind: string; thread_id: string } };
    expect(artifact).toMatchObject({ kind: 'html', thread_id: thread.id });
    expect(artifact.path).toMatch(new RegExp(`/${thread.id}/artifacts/renders/commits-by-package-[0-9a-f]{6}\\.html$`));
    expect(readFileSync(artifact.path, 'utf8')).toBe(page);
    expect(r.db.artifacts.byThread(thread.id).map((a) => a.id)).toContain(artifact.id);
    // What the tool answers names the artifact, and the transcript reads it back.
    const text = renderedText({ artifact: artifact.id, title: 'Commits by package' });
    expect(renderedFrom('mcp__omni-render__html_render', { title: 'Commits by package' }, { text, is_error: false })?.artifact).toBe(artifact.id);
  });

  it('gives two pages with one title their own files', async () => {
    const a = (await (await post({ title: 'Same', html: page })).json()) as { artifact: { path: string } };
    const b = (await (await post({ title: 'Same', html: page })).json()) as { artifact: { path: string } };
    expect(a.artifact.path).not.toBe(b.artifact.path);
  });

  it('says what to fix', async () => {
    expect((await post({ title: '', html: page })).status).toBe(400);
    expect((await post({ title: 'T', html: '  ' })).status).toBe(400);
    const big = await post({ title: 'T', html: 'x'.repeat(512_001) });
    expect(big.status).toBe(400);
    expect(((await big.json()) as { error: string }).error).toContain('512000');
    expect((await post({ title: 'T', html: page }, 'no-such-thread')).status).toBe(404);
  });
});

describe('GET /api/artifacts/:id/raw?frame=1', () => {
  it('adds the frame script to a rendered page and keeps it sandboxed', async () => {
    const { artifact } = (await (await post({ title: 'Framed', html: page })).json()) as { artifact: { id: number } };
    const res = await raw(artifact.id, '?frame=1');
    const body = await res.text();
    expect(res.headers.get('content-security-policy')).toBe('sandbox allow-scripts allow-popups');
    expect(body.indexOf('omni:render-height')).toBeGreaterThan(-1);
    expect(body.indexOf('omni:render-height')).toBeLessThan(body.indexOf('<title>'));
    expect(body.replace(/<script>\(function\([\s\S]*?<\/script>/, '')).toBe(page);
    expect(await (await raw(artifact.id)).text()).toBe(page);
    expect(await (await raw(artifact.id, '?frame=1&download=1')).text()).toBe(page);
  });

  it('serves an HTML file the agent wrote as written', async () => {
    const dir = join(r.paths.threads, thread.id, 'artifacts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'report.html'), page);
    const a = r.db.artifacts.upsert({ thread_id: thread.id, path: join(dir, 'report.html'), name: 'report.html', kind: 'html', size: page.length });
    expect(await (await raw(a.id, '?frame=1')).text()).toBe(page);
  });
});
