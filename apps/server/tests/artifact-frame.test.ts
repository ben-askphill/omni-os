import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// The transcript's inline frame loads an HTML artifact with `?frame=1`: the same sandboxed page, plus the script that
// reports its height.

const r = await startRunner({});
const { artifactsApi } = await import('../artifacts-api.ts');

const thread = r.db.threads.create({
  id: randomUUID(), channel_id: 'scratch', title: 'T', status: 'done', role: null, model: null, session_id: randomUUID(),
  cwd: r.tmp, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
});
const dir = join(r.paths.threads, thread.id, 'artifacts');
mkdirSync(dir, { recursive: true });
const page = '<!doctype html><html><head><title>Q3</title></head><body><button>go</button></body></html>';
writeFileSync(join(dir, 'chart.html'), page);
writeFileSync(join(dir, 'notes.md'), '# hi');
const html = r.db.artifacts.upsert({ thread_id: thread.id, path: join(dir, 'chart.html'), name: 'chart.html', kind: 'html', size: page.length });
const md = r.db.artifacts.upsert({ thread_id: thread.id, path: join(dir, 'notes.md'), name: 'notes.md', kind: 'markdown', size: 4 });

const get = (id: number, q = '') => artifactsApi.request(`/${id}/raw${q}`);

describe('GET /api/artifacts/:id/raw?frame=1', () => {
  it('adds the height script to an HTML page and keeps it sandboxed', async () => {
    const res = await get(html.id, '?frame=1');
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe('sandbox allow-scripts allow-popups');
    expect(body).toContain('omni:artifact-height');
    expect(body.indexOf('omni:artifact-height')).toBeLessThan(body.indexOf('<title>'));
    expect(body.replace(/<script>\(function\([\s\S]*?<\/script>/, '')).toBe(page);
  });

  it('serves the file as written without the flag', async () => {
    expect(await (await get(html.id)).text()).toBe(page);
  });

  it('leaves other kinds alone', async () => {
    expect(await (await get(md.id, '?frame=1')).text()).toBe('# hi');
  });

  it('a download is the file as written', async () => {
    const res = await get(html.id, '?frame=1&download=1');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(await res.text()).toBe(page);
  });
});
