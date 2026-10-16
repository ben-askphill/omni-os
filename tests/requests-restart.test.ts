import { afterAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FAKE_CLAUDE, fakeAlive, sleep, waitFor } from './support.ts';

// Durable requests across real restarts: server/index.ts as a process of its own on a throwaway data dir, the
// fake claude CLI, and only HTTP, as the clients use it. A message accepted before a restart is still there after
// it: held with Resume when no harness got it, uncertain when one may have, and never sent again on its own.

const ROOT = resolve(import.meta.dirname, '..');
const tmp = mkdtempSync(join(tmpdir(), 'omni-requests-'));
const brain = join(tmp, 'brain');
mkdirSync(brain);
const T = { timeout: 60_000 };

const children: ChildProcess[] = [];
const fakeLogs = new Set<string>();

const lines = (log: string) => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
/** A killed server leaves its CLI running. */
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
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'], {
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
  const port = async () => {
    const p = await waitFor(() => Number(output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)?.[1]) || (exit && -1), () => `the server to listen:\n${output}`, 20_000);
    if (p === -1) throw new Error(`the server exited before it listened:\n${output}`);
    return p;
  };
  return {
    port,
    output: () => output,
    /** Spawns of the thread's stream-json CLI, oldest first. */
    spawns: (id: string) => lines(fakeLog).filter((l) => l.mode === 'stream' && l.thread_id === id),
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

type Pending = { uuid: string; text: string; state: string; delivery?: string; request_id?: string; mode: string; attachments?: { name: string }[] };
type Detail = { thread: { id: string; status: string }; events: { id: number; kind: string; payload: string }[]; pending: Pending[] };

function client(port: number) {
  const call = async (method: string, path: string, body?: unknown) => {
    const form = body instanceof FormData;
    const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: body && !form ? { 'content-type': 'application/json' } : undefined,
      body: form ? body : body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text) };
  };
  const ok = async (method: string, path: string, body?: unknown) => {
    const res = await call(method, path, body);
    if (res.status !== 200) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  const detail = (id: string) => ok('GET', `/threads/${id}`) as Promise<Detail>;
  const users = async (id: string) =>
    (await detail(id)).events.filter((e) => e.kind === 'user').map((e) => JSON.parse(e.payload) as { text: string; dropped?: boolean; attachments?: unknown[] });
  return { call, ok, detail, users };
}

/** A queued message with a file, as the Mac app and the Web UI send one: the JSON in `payload`, then the files. */
function withFile(body: Record<string, unknown>, name: string, text: string) {
  const form = new FormData();
  form.append('payload', JSON.stringify(body));
  form.append('files', new File([text], name, { type: 'text/plain' }));
  return form;
}

/** A server with a thread busy in a long tool call, so what it gets now waits. */
async function busy(name: string) {
  const data = join(tmp, name);
  const server = boot(data);
  const api = client(await server.port());
  const t = await api.ok('POST', '/threads', { channel: 'inbox', prompt: 'TOOL:30000 keep busy', title: 'Busy' });
  for (const end = Date.now() + 15_000; ; ) {
    const d = await api.detail(t.id);
    if (d.thread.status === 'running' && d.events.some((e) => e.kind === 'tool_use')) break;
    if (Date.now() > end) throw new Error(`the thread never ran its tool: ${JSON.stringify(d.thread)}`);
    await sleep(50);
  }
  return { data, server, api, id: t.id as string };
}

describe('requests across a forced restart', () => {
  it('keeps queued messages and their files for Resume, and never sends a maybe-read one again on its own', T, async () => {
    const { data, server, api, id } = await busy('forced');

    // Duplicate HTTP sends: the same request id twice gets one acceptance.
    const body = { prompt: 'queued: then tidy up', mode: 'queue', request_id: 'web-req-1' };
    const first = await api.ok('POST', `/threads/${id}/messages`, withFile(body, 'notes.txt', 'remember the cart'));
    const again = await api.ok('POST', `/threads/${id}/messages`, withFile(body, 'notes.txt', 'remember the cart'));
    expect(first.request).toMatchObject({ request_id: 'web-req-1', state: 'held' });
    expect(again.request).toMatchObject({ id: first.request.id, accepted_at: first.request.accepted_at, duplicate: true });
    // The same id with another file is a different message.
    const clash = await api.call('POST', `/threads/${id}/messages`, withFile(body, 'notes.txt', 'something else'));
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatch(/already used for a different message/);
    // A steer is written to the CLI at once: it may be read before the crash.
    const steer = await api.ok('POST', `/threads/${id}/messages`, { prompt: 'steer: add PINEAPPLE', mode: 'steer', request_id: 'mac-req-2' });
    expect(steer.request.state).toBe('sent');
    const before = await api.detail(id);
    expect(before.pending.map((p) => [p.text, p.state, p.delivery])).toEqual([
      ['steer: add PINEAPPLE', 'sent', 'sent'],
      ['queued: then tidy up', 'held', 'held'],
    ]);
    expect(before.pending[1].attachments?.map((a) => a.name)).toEqual(['notes.txt']);

    const spawned = server.spawns(id).length;
    await server.kill();
    const next = boot(data);
    const api2 = client(await next.port());
    expect(next.output()).toMatch(/kept 2 undelivered message\(s\) for Resume/);
    const after = await api2.detail(id);
    expect(after.thread.status).toBe('failed');
    // In the order they arrived.
    expect(after.pending).toMatchObject([
      { uuid: first.request.id, text: 'queued: then tidy up', state: 'held', delivery: 'recovered', request_id: 'web-req-1', mode: 'queue' },
      { uuid: steer.request.id, text: 'steer: add PINEAPPLE', state: 'held', delivery: 'uncertain', request_id: 'mac-req-2', mode: 'steer' },
    ]);
    expect(after.pending[0].attachments?.map((a) => a.name)).toEqual(['notes.txt']);
    // Neither is in the transcript yet, and nothing runs until Ben decides.
    expect((await api2.users(id)).map((u) => u.text)).toEqual(['TOOL:30000 keep busy']);
    await sleep(500);
    expect(next.spawns(id)).toHaveLength(spawned);

    // A client that never heard back retries after the restart: same acceptance, nothing sent.
    const retried = await api2.ok('POST', `/threads/${id}/messages`, withFile(body, 'notes.txt', 'remember the cart'));
    expect(retried.request).toMatchObject({ id: first.request.id, state: 'recovered', duplicate: true });

    // Resume sends the recovered one, with its file, and leaves the uncertain one for Ben.
    const resumed = await api2.ok('POST', `/threads/${id}/requests/resume`, {});
    expect(resumed.thread.id).toBe(id);
    for (const end = Date.now() + 15_000; ; ) {
      const d = await api2.detail(id);
      if (d.thread.status === 'done' && d.pending.length === 1) break;
      if (Date.now() > end) throw new Error(`the resumed message never ran: ${JSON.stringify(d.thread)} ${JSON.stringify(d.pending)}`);
      await sleep(50);
    }
    const sent = (await api2.users(id)).at(-1)!;
    expect(sent).toMatchObject({ text: 'queued: then tidy up', source: 'ben' });
    expect(sent.attachments).toHaveLength(1);
    expect((await api2.detail(id)).pending).toMatchObject([{ uuid: steer.request.id, delivery: 'uncertain' }]);

    // Discard: the uncertain one goes in the transcript as never sent.
    const discarded = await api2.ok('POST', `/threads/${id}/requests/discard`, { ids: [steer.request.id] });
    expect(discarded.pending).toEqual([]);
    expect((await api2.users(id)).at(-1)).toMatchObject({ text: 'steer: add PINEAPPLE', dropped: true });
    expect((await api2.call('POST', `/threads/${id}/requests/resume`, { ids: [steer.request.id] })).status).toBe(409);
    await next.stop();
  });
});

describe('requests across a clean restart', () => {
  it('parks held messages at shutdown instead of dropping them', T, async () => {
    const { data, server, api, id } = await busy('clean');
    const q = await api.ok('POST', `/threads/${id}/messages`, { prompt: 'queued: after the restart', mode: 'queue', request_id: 'req-clean' });
    await server.stop();
    const next = boot(data);
    const api2 = client(await next.port());
    const d = await api2.detail(id);
    expect(d.pending).toMatchObject([{ uuid: q.request.id, delivery: 'recovered', state: 'held' }]);
    expect((await api2.users(id)).some((u) => u.dropped)).toBe(false);
    await next.stop();
  });
});
