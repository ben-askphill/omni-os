import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startRunner } from './runner-boot.ts';

// The app around the API routes: GET /api/status saying which server this is, a JSON 404 for any
// unknown /api request, and the Web UI served from its build folder with index.html for its own paths.

const ROOT = resolve(import.meta.dirname, '..');
const INDEX = '<!doctype html><title>Omni</title>';

const web = mkdtempSync(join(tmpdir(), 'omni-web-'));
mkdirSync(join(web, 'assets'));
writeFileSync(join(web, 'index.html'), INDEX);
writeFileSync(join(web, 'assets', 'app.js'), 'console.log("omni")');
afterAll(() => rmSync(web, { recursive: true, force: true }));

const r = await startRunner({ OMNI_WEB_DIST: web });
const { app } = await import('../server/app.ts');
const { gitHead } = await import('../server/about.ts');

const call = async (path: string, init?: RequestInit) => {
  const res = await app.request(path, init);
  return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() };
};

describe('GET /api/status', () => {
  it('says which server this is, next to the fields it always had', async () => {
    const res = await call('/api/status');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    expect(body).toMatchObject({ usage: expect.any(Object), slots: expect.any(Object), running: 0, queued: 0, maxConcurrent: 8, maxUploadMb: 25 });
    expect(body.server).toEqual({
      version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
      pid: process.pid,
      root: ROOT,
      dataDir: r.paths.data,
      gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      startedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
      port: r.config.port,
    });
    expect(Date.parse(body.server.startedAt)).toBeLessThanOrEqual(Date.now());
    expect(JSON.parse((await call('/api/status')).text).server).toEqual(body.server);
  });

  it('has no commit when git cannot tell', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omni-nogit-'));
    try {
      expect(gitHead(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('GET /api/threads/:id/pr', () => {
  it('is a JSON 404 for an unknown thread', async () => {
    const res = await call('/api/threads/nope/pr');
    expect(res.status).toBe(404);
    expect(JSON.parse(res.text)).toEqual({ error: 'not found' });
  });
});

describe('an unknown /api request', () => {
  it('is a JSON 404, whatever the method', async () => {
    const json = { headers: { 'content-type': 'application/json' }, body: '{}' };
    const cases: [string, string, RequestInit][] = [
      ['GET', '/api/nope', {}],
      ['POST', '/api/nope', json],
      ['GET', '/api', {}],
      ['GET', '/api/threads/x/nope', {}],
      ['DELETE', '/api/channels', {}],
      ['PUT', '/api/status', json],
    ];
    for (const [method, path, init] of cases) {
      expect({ method, path, ...(await call(path, { method, ...init })) }).toEqual({
        method, path, status: 404, type: expect.stringContaining('application/json'), text: JSON.stringify({ error: 'Not found' }),
      });
    }
  });

  it('leaves the known routes as they were', async () => {
    const channels = await call('/api/channels');
    expect(channels.status).toBe(200);
    expect(JSON.parse(channels.text).map((c: { id: string }) => c.id)).toContain('scratch');
    expect(await call('/api/threads/nope')).toMatchObject({ status: 404, text: JSON.stringify({ error: 'not found' }) });
    const rename = { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'New' }) };
    expect(await call('/api/threads/nope', rename)).toMatchObject({ status: 404, text: JSON.stringify({ error: 'not found' }) });
    const t = await r.start('hello', { title: 'Old title' });
    await r.untilResults(t.id, 1);
    const renamed = await call(`/api/threads/${t.id}`, rename);
    expect(renamed.status).toBe(200);
    expect(JSON.parse(renamed.text)).toMatchObject({ id: t.id, title: 'New' });
  });
});

describe('the Web UI', () => {
  it('is served from its build folder, with index.html for its own paths', async () => {
    expect(await call('/')).toMatchObject({ status: 200, type: expect.stringContaining('text/html'), text: INDEX });
    expect(await call('/assets/app.js')).toMatchObject({ status: 200, type: expect.stringContaining('javascript'), text: 'console.log("omni")' });
    expect(await call('/c/inbox')).toMatchObject({ status: 200, type: expect.stringContaining('text/html'), text: INDEX });
    expect(await call('/apiary')).toMatchObject({ status: 200, text: INDEX });
  });
});
