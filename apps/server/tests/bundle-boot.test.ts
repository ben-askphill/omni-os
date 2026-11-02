import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bundleServer } from '../scripts/bundle.ts';
import { FAKE_CLAUDE, waitFor } from './support.ts';

// The desktop app runs the server as a bundle in a copy of the repo's layout, with no checkout and no tsx.
// This builds that bundle, lays it out the way apps/desktop/scripts/stage.ts does, boots it and asks it questions.

const REPO = resolve(import.meta.dirname, '../../..');
const tmp = mkdtempSync(join(tmpdir(), 'omni-bundle-'));
const app = join(tmp, 'app');
const data = join(tmp, 'data');
const children: ChildProcess[] = [];

afterAll(() => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
  rmSync(tmp, { recursive: true, force: true });
});

beforeAll(async () => {
  await bundleServer(app);
  for (const dir of ['crew', 'automations', 'mods']) cpSync(join(REPO, dir), join(app, dir), { recursive: true });
  cpSync(join(REPO, 'package.json'), join(app, 'package.json'));
  // The packaged app installs the external packages here; the repo's own stand in for them.
  symlinkSync(join(REPO, 'node_modules'), join(app, 'node_modules'));
  mkdirSync(join(tmp, 'brain'));
}, 120_000);

describe('the bundled server', () => {
  it('boots from the bundle and reports the app layout as its root', async () => {
    const child = spawn(process.execPath, [join(app, 'apps', 'server', 'index.mjs')], {
      cwd: tmp,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: tmpdir(),
        OMNI_DATA_DIR: data,
        OMNI_PORT: '0',
        OMNI_HOST: '127.0.0.1',
        OMNI_CLAUDE_BIN: FAKE_CLAUDE,
        OMNI_CODEX_BIN: join(tmp, 'no-codex'),
        OMNI_CURSOR_BIN: join(tmp, 'no-cursor-agent'),
        OMNI_BROWSER: '0',
        OMNI_SECRET_STORE: 'file',
        OMNI_BRAIN_DIR: join(tmp, 'brain'),
        OMNI_UPDATE_CHECK: '0',
        OMNI_WEB_DIST: join(tmp, 'no-web'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let output = '';
    child.stdout!.on('data', (d) => (output += d));
    child.stderr!.on('data', (d) => (output += d));
    const port = await waitFor(() => Number(output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)?.[1]) || null, () => output, 30_000);
    const token = readFileSync(join(data, 'api-token'), 'utf8').trim();
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const status = (await res.json()) as { server: { root: string; dataDir: string; gitHead: string | null } };
    expect(status.server.root).toBe(app);
    expect(status.server.dataDir).toBe(data);
    expect(status.server.gitHead).toBeNull();
  }, 60_000);

  it('runs a bundled MCP script on its own, with no tsx', async () => {
    const child = spawn(process.execPath, [join(app, 'apps', 'mcp', 'ask.mjs')], {
      cwd: tmp,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, OMNI_URL: 'http://127.0.0.1:9', OMNI_THREAD_ID: 'thread-1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.push(child);
    let output = '';
    child.stdout!.on('data', (d) => (output += d));
    child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } })}\n`);
    const reply = await waitFor(() => output.split('\n').find((line) => line.includes('"id":1')) ?? null, () => output, 15_000);
    expect(JSON.parse(reply).result.serverInfo.name).toBeTruthy();
  }, 30_000);
});
