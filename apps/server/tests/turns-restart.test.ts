import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FAKE_CLAUDE, fakeAlive, sleep, waitFor } from './support.ts';

// A turn's saved diff across real restarts: apps/server/index.ts as a process of its own on a throwaway data dir, the fake
// claude CLI and only HTTP. A saved turn reads the same after the checkout changes and the server restarts, and a
// turn a killed server never finished saving says so at boot instead of waiting forever.

const ROOT = resolve(import.meta.dirname, '../../..');
const tmp = mkdtempSync(join(tmpdir(), 'omni-turns-'));
const brain = join(tmp, 'brain');
mkdirSync(brain);
const T = { timeout: 60_000 };

const children: ChildProcess[] = [];
const fakeLog = join(tmp, 'fake-claude.jsonl');
const killFakes = () => {
  const lines = existsSync(fakeLog) ? readFileSync(fakeLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  for (const pid of new Set(lines.map((l) => l.pid as number))) if (fakeAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
};

afterAll(() => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
  killFakes();
  rmSync(tmp, { recursive: true, force: true });
});

function boot(data: string) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'apps/server/index.ts'], {
    cwd: ROOT,
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
      OMNI_BRAIN_DIR: brain,
      OMNI_DEFAULT_MODEL: 'sonnet',
      OMNI_KEEPALIVE_SECONDS: '60',
      OMNI_SUGGESTIONS: '0',
      OMNI_WEB_DIST: join(tmp, 'no-web'),
      FAKE_CLAUDE_LOG: fakeLog,
      FAKE_CLAUDE_LATENCY_MS: '10',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let output = '';
  let exit: { code: number | null } | null = null;
  child.stdout!.on('data', (d) => (output += d));
  child.stderr!.on('data', (d) => (output += d));
  child.on('exit', (code) => (exit = { code }));
  return {
    output: () => output,
    port: async () => {
      const p = await waitFor(() => Number(output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)?.[1]) || (exit && -1), () => `the server to listen:\n${output}`, 20_000);
      if (p === -1) throw new Error(`the server exited before it listened:\n${output}`);
      return p;
    },
    kill: async () => {
      child.kill('SIGKILL');
      await waitFor(() => exit, 'the killed server to exit');
      killFakes();
    },
    stop: async () => {
      child.kill('SIGTERM');
      await waitFor(() => exit, 'the server to stop', 15_000);
    },
  };
}

function client(port: number) {
  const ok = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (res.status !== 200) throw new Error(`${method} ${path}: ${res.status} ${text}`);
    return JSON.parse(text);
  };
  return { ok, turns: (id: string) => ok('GET', `/threads/${id}/turns`) };
}

/** Poll an async check until it answers something truthy. */
async function eventually<V>(fn: () => Promise<V | false | null | undefined>, label: string, timeout = 15_000): Promise<V> {
  for (const end = Date.now() + timeout; ; ) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await sleep(50);
  }
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

describe('saved turns across restarts', () => {
  it('reads the same after later edits and a restart, and a turn a killed server never saved says so', T, async () => {
    const dir = join(tmp, 'repo');
    mkdirSync(dir);
    git(dir, 'init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'README.md'), 'one\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'start');
    const run = join(tmp, 'edit.sh');
    writeFileSync(run, 'printf "two\\n" >> README.md\n');

    const data = join(tmp, 'data');
    const first = boot(data);
    const api = client(await first.port());
    await api.ok('POST', '/channels', { id: 'turns', name: 'Turns', repo_path: dir, use_worktree: 1 });
    const t = await api.ok('POST', '/threads', { channel: 'turns', prompt: `RUN:${run}` });
    const saved = await eventually(async () => {
      const b = await api.turns(t.id);
      return b.turn?.state === 'ready' && b;
    }, 'the first turn to be saved');
    expect(saved.groups[0].files.map((f: any) => [f.status, f.path, f.additions])).toEqual([['modified', 'README.md', 1]]);
    const wt = (await api.ok('GET', `/threads/${t.id}`)).thread.cwd as string;
    await first.stop();

    writeFileSync(join(wt, 'README.md'), 'changed while Omni was down\n');
    const second = boot(data);
    const api2 = client(await second.port());
    expect(await api2.turns(t.id)).toEqual(saved);

    // Killed mid-turn: its before snapshot is saved, its after one never will be.
    await api2.ok('POST', `/threads/${t.id}/messages`, { prompt: 'THINK:20000 take your time' });
    await eventually(async () => {
      const b = await api2.turns(t.id);
      return b.turn?.n === 2 && b.turn.before && b;
    }, 'the second turn to start');
    await second.kill();

    const third = boot(data);
    const api3 = client(await third.port());
    const after = await api3.turns(t.id);
    expect(after.turn).toMatchObject({ n: 2, state: 'failed', error: "Omni stopped before this turn's snapshots were saved.", after: null });
    expect(after.turns[1]).toEqual(saved.turn);
    expect(third.output()).toContain('1 turn snapshot(s) were not saved');
    await third.stop();
  });
});
