import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FAKE_CLAUDE, fakeAlive, waitFor } from './support.ts';

// Boots the real server, server/index.ts, as a process of its own: throwaway data dirs, the fake claude
// CLI, random ports. The boot order under test: the data dir's lock, then the port, and only then the
// threads a previous server left running. A second server on the same data or the same port exits
// having touched nothing.

const ROOT = resolve(import.meta.dirname, '..');
const HEAD = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const tmp = mkdtempSync(join(tmpdir(), 'omni-server-'));
const brain = join(tmp, 'brain');
mkdirSync(brain);

const children: ChildProcess[] = [];
const fakeLogs = new Set<string>();

const loggedPids = (log: string): number[] =>
  existsSync(log) ? [...new Set(readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).pid as number))] : [];

/** Kill the fake CLIs a data dir's servers started: a killed server leaves its CLI running. */
const killFakes = (log: string) => {
  for (const pid of loggedPids(log)) if (fakeAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
};

afterAll(() => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
  for (const log of fakeLogs) killFakes(log);
  rmSync(tmp, { recursive: true, force: true });
});

const lockOf = (data: string) => join(data, 'server.pid');
const lockPid = (data: string) => Number(readFileSync(lockOf(data), 'utf8').trim());

function boot(data: string, port = 0) {
  const fakeLog = `${data}.fake-claude.jsonl`;
  fakeLogs.add(fakeLog);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
    cwd: ROOT,
    // Only what the server needs, none of this shell's other variables.
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: tmpdir(),
      OMNI_DATA_DIR: data,
      OMNI_PORT: String(port),
      OMNI_HOST: '127.0.0.1',
      OMNI_CLAUDE_BIN: FAKE_CLAUDE,
      OMNI_CODEX_BIN: join(tmp, 'no-codex'),
      OMNI_CURSOR_BIN: join(tmp, 'no-cursor-agent'),
      OMNI_BROWSER: '0',
      OMNI_BRAIN_DIR: brain,
      OMNI_DEFAULT_MODEL: 'sonnet',
      OMNI_KEEPALIVE_SECONDS: '60',
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
  const listening = () => Number(output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)?.[1]) || null;
  return {
    pid: child.pid!,
    output: () => output,
    /** The port it listens on. Throws if it exits first. */
    port: async () => {
      const port = await waitFor(() => listening() ?? (exit && -1), () => `the server to listen:\n${output}`, 20_000);
      if (port === -1) throw new Error(`the server exited (${exit!.code}) before it listened:\n${output}`);
      return port;
    },
    /** Its exit code, once it exits. */
    exited: async (timeout = 20_000) => (await waitFor(() => exit, () => `the server to exit:\n${output}`, timeout)).code,
    stop: () => child.kill('SIGTERM'),
    kill: () => child.kill('SIGKILL'),
  };
}

const api = async (port: number, path: string, init?: RequestInit) => {
  const res = await fetch(`http://127.0.0.1:${port}/api${path}`, init);
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
};

async function eventually<T>(fn: () => Promise<T | null | undefined | false>, label: string, timeout = 10_000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out after ${timeout}ms waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** A thread whose fake CLI is in the middle of a 30 second tool call. */
async function busyThread(port: number): Promise<{ id: string }> {
  const t = await api(port, '/threads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channel: 'inbox', prompt: 'TOOL:30000 keep busy', title: 'Busy' }),
  });
  await eventually(async () => {
    const { thread, events } = await api(port, `/threads/${t.id}`);
    return thread.status === 'running' && events.some((e: { kind: string }) => e.kind === 'tool_use');
  }, 'the thread to run its tool');
  return t;
}

/** A thread's status, read from the data dir's database while no server runs on it. */
const statusInDb = (data: string, id: string) => {
  const db = new DatabaseSync(join(data, 'omni.db'));
  try {
    return (db.prepare('SELECT status FROM threads WHERE id = ?').get(id) as { status: string }).status;
  } finally {
    db.close();
  }
};

/** A data dir holding a thread left running by a server that was killed, and that server's lock. */
async function killedServer(name: string) {
  const data = join(tmp, name);
  const dead = boot(data);
  const t = await busyThread(await dead.port());
  dead.kill();
  expect(await dead.exited()).toBeNull();
  killFakes(`${data}.fake-claude.jsonl`);
  expect(lockPid(data)).toBe(dead.pid);
  expect(statusInDb(data, t.id)).toBe('running');
  return { data, thread: t, deadPid: dead.pid };
}

describe('the server at boot', () => {
  it('says which process it is in GET /api/status, and holds the data dir until it stops', async () => {
    const data = join(tmp, 'status');
    const s = boot(data);
    const port = await s.port();
    const { server } = await api(port, '/status');
    expect(server).toEqual({
      version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
      pid: s.pid,
      root: ROOT,
      dataDir: data,
      gitHead: HEAD,
      startedAt: expect.any(String),
      port,
    });
    expect(lockPid(data)).toBe(s.pid);

    s.stop();
    expect(await s.exited()).toBe(0);
    expect(existsSync(lockOf(data))).toBe(false);
  }, 60_000);

  it('refuses a second server on the same data, naming the first, and the first keeps its running thread', async () => {
    const data = join(tmp, 'shared');
    const first = boot(data);
    const port = await first.port();
    const t = await busyThread(port);

    const second = boot(data);
    expect(await second.exited()).toBe(1);
    expect(second.output()).toContain(`pid ${first.pid}`);
    expect(second.output()).not.toContain('listening on');

    const after = await api(port, `/threads/${t.id}`);
    expect(after.thread.status).toBe('running');
    expect(after.live).toBe(true);
    expect(after.events.map((e: { kind: string }) => e.kind)).not.toContain('error');
    expect(lockPid(data)).toBe(first.pid);

    first.stop();
    expect(await first.exited()).toBe(0);
    expect(existsSync(lockOf(data))).toBe(false);
  }, 60_000);

  it('exits without changing its data when its port is taken', async () => {
    const { data, thread } = await killedServer('port-taken');
    const taken = createServer().listen(0, '127.0.0.1');
    await new Promise((r) => taken.once('listening', r));
    try {
      const s = boot(data, (taken.address() as AddressInfo).port);
      expect(await s.exited()).toBe(1);
      expect(s.output()).toContain('in use');
      expect(s.output()).not.toContain('listening on');
      expect(statusInDb(data, thread.id)).toBe('running');
      expect(existsSync(lockOf(data))).toBe(false);
    } finally {
      taken.close();
    }
  }, 60_000);

  it('takes over the lock of a server that was killed, and fails the thread it left running', async () => {
    const { data, thread, deadPid } = await killedServer('killed');
    const next = boot(data);
    const port = await next.port();
    expect((await api(port, '/status')).server.pid).toBe(next.pid);
    expect(next.pid).not.toBe(deadPid);
    expect(lockPid(data)).toBe(next.pid);
    expect((await api(port, `/threads/${thread.id}`)).thread.status).toBe('failed');

    next.stop();
    expect(await next.exited()).toBe(0);
  }, 60_000);

  it('takes over a lock whose pid now belongs to another program', async () => {
    const data = join(tmp, 'recycled');
    mkdirSync(data, { recursive: true });
    const other = spawn('sleep', ['60'], { stdio: 'ignore' });
    children.push(other);
    writeFileSync(lockOf(data), `${other.pid}\n`);

    const s = boot(data);
    await s.port();
    expect(lockPid(data)).toBe(s.pid);
    s.stop();
    expect(await s.exited()).toBe(0);
    other.kill('SIGKILL');
  }, 60_000);
});
