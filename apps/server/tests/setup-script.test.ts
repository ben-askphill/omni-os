import { afterAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// `npm run setup` in a terminal: the harness lines (#757's reasons read as text, Install only for a missing CLI), and
// a server on the port that refuses this checkout's token, which is the desktop app's: setup stops instead of writing
// a config that app never reads.

const SERVER = resolve(import.meta.dirname, '..');
const tmp = mkdtempSync(join(tmpdir(), 'omni-setup-script-'));
const servers: Server[] = [];
afterAll(() => {
  for (const s of servers) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** A stand-in for whatever answers on Omni's port. */
async function fakeServer(answer: (path: string, method: string) => { status: number; body: unknown }): Promise<string> {
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const { status, body } = answer(req.url ?? '', req.method ?? 'GET');
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

let n = 0;
/** Runs the script with every default taken, in a fresh data dir, with only `bins` (and the system's) on PATH. */
async function setup(url: string, bins: string[] = []) {
  const dir = join(tmp, `run-${n++}`);
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  for (const b of bins) writeFileSync(join(bin, b), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env: Record<string, string> = { HOME: dir, PATH: `${bin}:/usr/bin:/bin`, OMNI_DATA_DIR: join(dir, 'data'), OMNI_URL: url, TMPDIR: tmpdir() };
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'scripts/setup.ts', '--yes', '--name', 'Ada'], { cwd: SERVER, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const code = await new Promise<number | null>((done) => child.on('close', done));
  return { code, out, config: join(dir, 'data', 'omni.config.json') };
}

describe('npm run setup', () => {
  it('stops at a server that refuses its token, the desktop app, and writes nothing', async () => {
    const url = await fakeServer(() => ({ status: 401, body: { error: 'unauthorized' } }));
    const r = await setup(url);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`${url} answers but refuses this checkout's token, so it is another Omni: most likely the desktop app.`);
    expect(r.out).toContain('Settings > General > Run setup again.');
    expect(existsSync(r.config)).toBe(false);
  }, 60_000);

  it("with this checkout's server: a signed-out CLI gets only its sign-in, a missing one Install, a reason reads as text", async () => {
    const reason = 'codex app-server exited (code 1) before it answered. Run codex app-server in a terminal to see why';
    const rows = [
      { id: 'claude-code', name: 'Claude Code', available: true },
      { id: 'codex', name: 'Codex', available: false, fix: reason },
      { id: 'cursor', name: 'Cursor Agent', available: false, missing: true, fix: 'cursor-agent login', install: 'curl https://cursor.com/install -fsS | bash' },
      { id: 'hermes', name: 'Hermes', available: false, fix: 'Set the Hermes URL in Settings' },
    ];
    const url = await fakeServer((path) =>
      path === '/api/harnesses' ? { status: 200, body: rows } : path === '/api/setup/complete' ? { status: 200, body: { threadId: 't1' } } : { status: 200, body: {} },
    );
    const r = await setup(url);
    expect(r.code).toBe(0);
    const lines = r.out.split('\n').map((l) => l.trim());
    expect(lines).toContain('ready          Claude Code');
    expect(lines).toContain('not ready      Codex');
    expect(lines).toContain(`${reason}.`);
    expect(lines).toContain('Reviews the pull requests Claude writes. Without it, the Conductor asks you each time.');
    expect(lines).toContain('not installed  Cursor Agent');
    expect(lines).toContain('install: curl https://cursor.com/install -fsS | bash');
    expect(lines).toContain('sign in: cursor-agent login');
    expect(r.out).not.toContain(`sign in: ${reason}`);
    expect(r.out).not.toContain('Hermes');
    expect(lines).toContain(`Open ${url}.`);
    expect(r.out).not.toContain('or the desktop app');
  }, 60_000);

  it('without a server: checks PATH, offers Install only for what is not there, and points the desktop app at its own screens', async () => {
    const r = await setup('http://127.0.0.1:9', ['claude', 'cursor-agent']);
    expect(r.code).toBe(0);
    const lines = r.out.split('\n').map((l) => l.trim());
    expect(lines).toContain('ready          Claude Code');
    expect(lines).toContain('ready          Cursor Agent');
    expect(lines).toContain('not installed  Codex');
    expect(lines).toContain('install: npm install -g @openai/codex');
    expect(lines).toContain('sign in: codex login');
    expect(r.out).not.toContain('install: npm install -g @anthropic-ai/claude-code');
    expect(lines).toContain('Start Omni with `npm run dev` (web on http://localhost:4748).');
    expect(lines).toContain("The desktop app keeps its own settings and asks these questions itself; it does not read this checkout's data/.");
    expect(existsSync(r.config)).toBe(true);
  }, 60_000);
});
