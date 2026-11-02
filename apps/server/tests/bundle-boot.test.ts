import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { bundleServer, EXTERNAL } from '../scripts/bundle.ts';
import { FAKE_CLAUDE, waitFor } from './support.ts';

// The desktop app runs the server as a bundle in a copy of the repo's layout, with no checkout and no tsx.
// This builds that bundle, lays it out the way apps/desktop/scripts/stage.ts does, boots it and asks it questions.

const REPO = resolve(import.meta.dirname, '../../..');
// Real path: on a Mac $TMPDIR is under /var, a link to /private/var, and the server reports its root resolved.
const tmp = mkdtempSync(join(realpathSync(tmpdir()), 'omni-bundle-'));
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
  // The packaged app ships only the external packages in node_modules; the repo's own stand in for them. Nothing
  // else may resolve from the bundle, or a module esbuild left out would pass here and fail in the app.
  for (const name of EXTERNAL) {
    mkdirSync(dirname(join(app, 'node_modules', name)), { recursive: true });
    symlinkSync(join(REPO, 'node_modules', name), join(app, 'node_modules', name));
  }
  expect(() => createRequire(join(app, 'apps', 'server', 'index.mjs')).resolve('@xterm/headless')).toThrow();
  mkdirSync(join(tmp, 'brain'));
  // The packaged app's root is read-only and its environment fixed, so server options come from the data dir's .env.
  mkdirSync(data);
  writeFileSync(join(data, '.env'), 'OMNI_SUGGESTIONS=0\n');
  writeFileSync(join(app, '.env'), 'OMNI_TURN_SNAPSHOTS=0\n');
}, 120_000);

/** Starts the bundle as the desktop app does, with `dataDir` as its data dir. */
async function boot(dataDir: string): Promise<{ port: number; token: string }> {
  const child = spawn(process.execPath, [join(app, 'apps', 'server', 'index.mjs')], {
    cwd: tmp,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      SHELL: '/bin/sh',
      TMPDIR: tmpdir(),
      OMNI_DATA_DIR: dataDir,
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
      // As the desktop app sets it (apps/desktop/src/backend/launch.ts).
      OMNI_SUPERVISOR: 'desktop',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let output = '';
  child.stdout!.on('data', (d) => (output += d));
  child.stderr!.on('data', (d) => (output += d));
  const port = await waitFor(() => Number(output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)?.[1]) || null, () => output, 30_000);
  return { port, token: readFileSync(join(dataDir, 'api-token'), 'utf8').trim() };
}

describe('the bundled server', () => {
  it('boots from the bundle and reports the app layout as its root', async () => {
    const { port, token } = await boot(data);
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const status = (await res.json()) as { server: { root: string; dataDir: string; gitHead: string | null } };
    expect(status.server.root).toBe(app);
    expect(status.server.dataDir).toBe(data);
    expect(status.server.gitHead).toBeNull();

    const options = await fetch(`http://127.0.0.1:${port}/api/setup/server`, { headers: { authorization: `Bearer ${token}` } });
    const { options: rows } = (await options.json()) as { options: { env: string; value: string; source: string }[] };
    expect(rows.find((r) => r.env === 'OMNI_SUGGESTIONS')).toMatchObject({ value: 'Off', source: 'env' });
    expect(rows.find((r) => r.env === 'OMNI_TURN_SNAPSHOTS')).toMatchObject({ value: 'On', source: 'default' });

    // The Terminal tab: node-pty from node_modules, the headless xterm from the bundle.
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const made = await fetch(`http://127.0.0.1:${port}/api/threads`, { method: 'POST', headers: auth, body: JSON.stringify({ prompt: 'hi' }) });
    const { id } = (await made.json()) as { id: string };
    const opened = await fetch(`http://127.0.0.1:${port}/api/threads/${id}/terminal`, { method: 'POST', headers: auth, body: '{}' });
    expect(await opened.json()).toMatchObject({ open: true, running: true });
    await fetch(`http://127.0.0.1:${port}/api/threads/${id}/terminal`, { method: 'DELETE', headers: auth });

    // The app updates itself, so the server's Update, which rebuilds a checkout, is neither offered nor run.
    const update = await fetch(`http://127.0.0.1:${port}/api/update`, { headers: auth });
    expect(await update.json()).toMatchObject({ canApply: false });
    const applied = await fetch(`http://127.0.0.1:${port}/api/update`, { method: 'POST', headers: auth });
    expect(applied.status).toBe(409);

    // Automations about Omni itself work in an Omni checkout, and this data dir is in none.
    const automations = (await (await fetch(`http://127.0.0.1:${port}/api/automations`, { headers: auth })).json()) as { id: string; error?: string }[];
    expect(automations.find((a) => a.id === 'docs-daily')?.error).toMatch(/needs an Omni checkout/);
    expect(automations.find((a) => a.id === 'morning-coffee')?.error).toBeUndefined();
  }, 60_000);

  it("reads an adopted checkout's .env below its data dir's", async () => {
    const checkout = join(tmp, 'checkout');
    const adopted = join(checkout, 'data');
    mkdirSync(join(checkout, 'apps', 'server'), { recursive: true });
    writeFileSync(join(checkout, 'apps', 'server', 'index.ts'), '');
    writeFileSync(join(checkout, '.env'), 'OMNI_KEEPALIVE_SECONDS=5\nOMNI_MAX_CONCURRENT=3\n');
    mkdirSync(adopted);
    writeFileSync(join(adopted, '.env'), 'OMNI_KEEPALIVE_SECONDS=7\n');
    const { port, token } = await boot(adopted);
    const res = await fetch(`http://127.0.0.1:${port}/api/setup/server`, { headers: { authorization: `Bearer ${token}` } });
    const { options: rows } = (await res.json()) as { options: { env: string; value: string; source: string }[] };
    expect(rows.find((r) => r.env === 'OMNI_KEEPALIVE_SECONDS')).toMatchObject({ value: '7 s', source: 'env' });
    expect(rows.find((r) => r.env === 'OMNI_MAX_CONCURRENT')).toMatchObject({ value: '3', source: 'env' });

    // The adopted checkout is where automations about Omni itself work.
    const list = await fetch(`http://127.0.0.1:${port}/api/automations`, { headers: { authorization: `Bearer ${token}` } });
    const docs = ((await list.json()) as { id: string; error?: string; prompt: string }[]).find((a) => a.id === 'docs-daily');
    expect(docs?.error).toBeUndefined();
    expect(docs?.prompt).toContain(`${checkout}/scripts/docs-daily.sh`);
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
