import { afterAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FAKE_CLAUDE, fakeAlive, sleep, waitFor } from './support.ts';

// A continuation scheduled for a usage limit's reset across real restarts: apps/server/index.ts as a process of its own on
// a throwaway data dir, the fake claude CLI, and only HTTP. A scheduled one survives a restart, one that came due
// while the server was down runs once at boot, and no later restart sends it again.

const ROOT = resolve(import.meta.dirname, '../../..');
const tmp = mkdtempSync(join(tmpdir(), 'omni-limits-'));
const brain = join(tmp, 'brain');
mkdirSync(brain);
const T = { timeout: 60_000 };

const children: ChildProcess[] = [];
const fakeLogs = new Set<string>();
const lines = (log: string) => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const killFakes = (log: string) => {
  for (const pid of new Set(lines(log).map((l) => l.pid as number))) if (fakeAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
};

afterAll(() => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
  for (const log of fakeLogs) killFakes(log);
  rmSync(tmp, { recursive: true, force: true });
});

function boot(data: string) {
  const fakeLog = `${data}.fake-claude.jsonl`;
  fakeLogs.add(fakeLog);
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
      OMNI_LIMIT_GRACE_MS: '0',
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
  const port = async () => {
    const p = await waitFor(() => Number(output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)?.[1]) || (exit && -1), () => `the server to listen:\n${output}`, 20_000);
    if (p === -1) throw new Error(`the server exited before it listened:\n${output}`);
    return p;
  };
  return {
    port,
    kill: async () => {
      child.kill('SIGKILL');
      await waitFor(() => exit, 'the killed server to exit');
      killFakes(fakeLog);
    },
    stop: async () => {
      child.kill('SIGTERM');
      await waitFor(() => exit, 'the server to stop', 15_000);
    },
  };
}

type Detail = { thread: { id: string; status: string; limit_state: string | null; limit_resets_at: string | null }; events: { kind: string; payload: string }[] };

function client(port: number) {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: JSON.parse(await res.text()) };
  };
  const ok = async (method: string, path: string, body?: unknown) => {
    const res = await call(method, path, body);
    if (res.status !== 200) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  const detail = (id: string) => ok('GET', `/threads/${id}`) as Promise<Detail>;
  const users = async (id: string) => (await detail(id)).events.filter((e) => e.kind === 'user').map((e) => JSON.parse(e.payload) as { text: string; source?: string });
  return { call, ok, detail, users };
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

async function limitedThread(api: ReturnType<typeof client>, resetsAt: number) {
  const t = await api.ok('POST', '/threads', { channel: 'inbox', prompt: `LIMIT:${resetsAt} write it up`, title: 'Limited' });
  for (const end = Date.now() + 15_000; ; ) {
    const d = await api.detail(t.id);
    if (d.thread.limit_state === 'limited') return t.id as string;
    if (Date.now() > end) throw new Error(`the thread never hit its limit: ${JSON.stringify(d.thread)}`);
    await sleep(50);
  }
}

describe('a continuation across restarts', () => {
  it('stays scheduled across a restart, runs once when it came due while the server was down, and never again', T, async () => {
    const data = join(tmp, 'due');
    const first = boot(data);
    const api = client(await first.port());
    const resetsAt = Math.floor(Date.now() / 1000) + 4;
    const id = await limitedThread(api, resetsAt);
    const scheduled = await api.ok('POST', `/threads/${id}/limit/schedule`);
    expect(scheduled.thread).toMatchObject({ limit_state: 'scheduled', limit_resets_at: new Date(resetsAt * 1000).toISOString() });
    // Scheduling again is the same one.
    await api.ok('POST', `/threads/${id}/limit/schedule`);

    await first.kill();
    // Down past the reset.
    await waitFor(() => Date.now() > resetsAt * 1000 + 500, 'the reset to pass', 10_000);
    const second = boot(data);
    const api2 = client(await second.port());
    const done = await eventually(async () => {
      const d = await api2.detail(id);
      return d.thread.status === 'done' && d;
    }, 'the continuation to run at boot');
    expect(done.thread.limit_state).toBeNull();
    const sent = (await api2.users(id)).filter((u) => u.source === 'limit');
    expect(sent.map((u) => u.text)).toEqual(['Continue where you left off.']);
    const record = (await api2.ok('GET', `/threads/${id}/requests`)) as { source: string; state: string }[];
    expect(record.filter((r) => r.source === 'limit').map((r) => r.state)).toEqual(['delivered']);

    // Another restart sends nothing more.
    await second.stop();
    const third = boot(data);
    const api3 = client(await third.port());
    await sleep(1500);
    expect((await api3.users(id)).filter((u) => u.source === 'limit')).toHaveLength(1);
    expect((await api3.detail(id)).thread.limit_state).toBeNull();
    await third.stop();
  });

  it('keeps a stop that is not due yet scheduled, and a cancelled one limited, across a restart', T, async () => {
    const data = join(tmp, 'later');
    const first = boot(data);
    const api = client(await first.port());
    const later = Math.floor(Date.now() / 1000) + 3600;
    const a = await limitedThread(api, later);
    const b = await limitedThread(api, later);
    await api.ok('POST', `/threads/${a}/limit/schedule`);
    await api.ok('POST', `/threads/${b}/limit/schedule`);
    const cancelled = await api.ok('POST', `/threads/${b}/limit/cancel`);
    expect(cancelled.thread.limit_state).toBe('limited');
    await first.kill();

    const next = boot(data);
    const api2 = client(await next.port());
    expect((await api2.detail(a)).thread).toMatchObject({ status: 'failed', limit_state: 'scheduled' });
    expect((await api2.detail(b)).thread).toMatchObject({ status: 'failed', limit_state: 'limited' });
    const inbox = (await api2.ok('GET', '/needs-you')) as { items: { thread: { id: string }; blockers: { kind: string; scheduled?: boolean }[] }[] };
    const blockerOf = (id: string) => inbox.items.find((i) => i.thread.id === id)?.blockers;
    expect(blockerOf(a)).toMatchObject([{ kind: 'limited', scheduled: true }]);
    expect(blockerOf(b)).toMatchObject([{ kind: 'limited', scheduled: false }]);
    // Resume now, then a second click: the continuation goes once, and the second is refused.
    await api2.ok('POST', `/threads/${b}/limit/resume`);
    const again = await api2.call('POST', `/threads/${b}/limit/resume`);
    expect(again.status).toBe(409);
    await eventually(async () => (await api2.detail(b)).thread.status === 'done', 'the resumed thread to finish');
    expect((await api2.users(b)).filter((u) => u.source === 'limit')).toHaveLength(1);
    await next.stop();
  });
});
