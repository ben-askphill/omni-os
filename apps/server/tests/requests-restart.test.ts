import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixture } from '@omni/test-fixtures';
import { parseContexts } from '@omni/shared/message-context-kinds.ts';
import { FAKE_CLAUDE, fakeAlive, sleep, waitFor } from './support.ts';

// Durable requests across real restarts: apps/server/index.ts as a process of its own on a throwaway data dir, the
// fake claude CLI, and only HTTP, as the clients use it. A message accepted before a restart is still there after
// it: held with Resume when no harness got it, uncertain when one may have, and never sent again on its own.

const ROOT = resolve(import.meta.dirname, '../../..');
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

function boot(data: string, extra: Record<string, string> = {}) {
  const fakeLog = `${data}.fake-claude.jsonl`;
  fakeLogs.add(fakeLog);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'apps/server/index.ts'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: tmpdir(),
      OMNI_DATA_DIR: data,
      OMNI_TOKEN: process.env.OMNI_TOKEN,
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
      ...extra,
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

type Pending = {
  uuid: string; kind: string; text: string; state: string; delivery?: string; request_id?: string; mode: string; thread_id?: string; attachments?: { name: string }[];
  context?: unknown[];
};
type Detail = { thread: { id: string; status: string }; events: { id: number; kind: string; payload: string }[]; pending: Pending[] };

function client(port: number) {
  const call = async (method: string, path: string, body?: unknown) => {
    const form = body instanceof FormData;
    const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${process.env.OMNI_TOKEN}`, ...(body && !form ? { 'content-type': 'application/json' } : {}) },
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
    (await detail(id)).events.filter((e) => e.kind === 'user').map((e) => JSON.parse(e.payload) as { text: string; dropped?: boolean; attachments?: unknown[]; context?: unknown[] });
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

describe('context across a forced restart', () => {
  it('keeps the records of parked messages, sends them on Resume and keeps them when discarded', T, async () => {
    const parsed = parseContexts([JSON.parse(readFileSync(fixture('message-context.json'), 'utf8')).records[0].raw]);
    if (!parsed.ok) throw new Error(parsed.error);
    const context = parsed.value;
    const { data, server, api, id } = await busy('context');
    const kept = await api.ok('POST', `/threads/${id}/messages`, withFile({ prompt: 'resume me', mode: 'queue', request_id: 'ctx-a', context }, 'notes.txt', 'cart'));
    const dropped = await api.ok('POST', `/threads/${id}/messages`, { prompt: '', mode: 'queue', request_id: 'ctx-b', context });
    await server.kill();
    const next = boot(data);
    const api2 = client(await next.port());
    const after = await api2.detail(id);
    expect(after.pending.map((p) => [p.request_id, p.delivery, p.context])).toEqual([
      ['ctx-a', 'recovered', context],
      ['ctx-b', 'recovered', context],
    ]);
    // The retry a client makes after the restart still matches what was saved, context and all.
    expect((await api2.ok('POST', `/threads/${id}/messages`, { prompt: '', mode: 'queue', request_id: 'ctx-b', context })).request).toMatchObject({ id: dropped.request.id, duplicate: true });

    await api2.ok('POST', `/threads/${id}/requests/resume`, { ids: [kept.request.id] });
    for (const end = Date.now() + 15_000; ; ) {
      const d = await api2.detail(id);
      if (d.thread.status === 'done' && d.pending.length === 1) break;
      if (Date.now() > end) throw new Error(`the resumed message never ran: ${JSON.stringify(d.thread)} ${JSON.stringify(d.pending)}`);
      await sleep(50);
    }
    expect((await api2.users(id)).at(-1)).toMatchObject({ text: 'resume me', attachments: [expect.objectContaining({ name: 'notes.txt' })], context });

    await api2.ok('POST', `/threads/${id}/requests/discard`, { ids: [dropped.request.id] });
    expect((await api2.users(id)).at(-1)).toEqual({ text: '', source: 'ben', context, dropped: true });
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

// Crew reports (apps/server/runner/queue.ts) are saved for the parent before it is woken. Two slots, both taken: the
// child finishes, and its report waits for one, the parent not woken yet, when the server goes down.
const TWO_SLOTS = { OMNI_MAX_CONCURRENT: '2' };

async function until<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeout = 15_000): Promise<T> {
  for (const end = Date.now() + timeout; ; ) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await sleep(50);
  }
}

async function reportWaiting(name: string) {
  const data = join(tmp, name);
  const server = boot(data, TWO_SLOTS);
  const api = client(await server.port());
  const count = async (id: string, kind: string) => (await api.detail(id)).events.filter((e) => e.kind === kind).length;
  const parent = await api.ok('POST', '/threads', { channel: 'inbox', prompt: 'be the conductor', title: 'Conductor' });
  await until('the parent to finish', async () => (await api.detail(parent.id)).thread.status === 'done');
  const blocker = await api.ok('POST', '/threads', { channel: 'inbox', prompt: 'TOOL:30000 hold a slot', title: 'Blocker' });
  await until('the blocker to run', async () => (await count(blocker.id, 'tool_use')) === 1);
  const child = await api.ok('POST', '/threads', { channel: 'inbox', prompt: 'TOOL:1500 child task', title: 'Child', parent_id: parent.id });
  await until('the child to run', async () => (await count(child.id, 'tool_use')) === 1);
  // Takes the child's slot first when it frees up, so the parent waits.
  await api.ok('POST', '/threads', { channel: 'inbox', prompt: 'TOOL:30000 take the next slot', title: 'Next' });
  const report = await until('the report to wait for a slot', async () =>
    (await api.detail(parent.id)).pending.find((p) => p.kind === 'crew_report' && p.delivery === 'waiting'),
  );
  expect(report).toMatchObject({ thread_id: child.id, state: 'waiting' });
  return { data, server, api, parent: parent.id as string, child: child.id as string, report };
}

describe('crew reports across a restart', () => {
  it('keeps a report the parent never got for Resume, and Resume delivers it once', T, async () => {
    const { data, server, parent, child, report } = await reportWaiting('report-forced');
    const spawned = server.spawns(parent).length;
    await server.kill();
    const next = boot(data, TWO_SLOTS);
    const api = client(await next.port());
    expect(next.output()).toMatch(/kept 1 undelivered message\(s\) for Resume/);

    // Held for Resume through the same parked list as Ben's messages, and not in the transcript yet.
    const after = await api.detail(parent);
    expect(after.pending).toMatchObject([{ uuid: report.uuid, kind: 'crew_report', state: 'held', delivery: 'recovered', thread_id: child, mode: 'steer' }]);
    expect(after.events.filter((e) => e.kind === 'crew_report')).toHaveLength(0);
    await sleep(500);
    expect(next.spawns(parent)).toHaveLength(spawned);
    const results = after.events.filter((e) => e.kind === 'result').length;

    // Two Resumes at once, as a retry would: one report in the transcript, one turn.
    await Promise.all([api.call('POST', `/threads/${parent}/requests/resume`, {}), api.call('POST', `/threads/${parent}/requests/resume`, {})]);
    const done = await until('the parent to run the report', async () => {
      const d = await api.detail(parent);
      return d.thread.status === 'done' && d.events.filter((e) => e.kind === 'result').length > results && d;
    });
    const reports = done.events.filter((e) => e.kind === 'crew_report').map((e) => JSON.parse(e.payload));
    expect(reports).toMatchObject([{ thread_id: child, status: 'done', text: 'ack: TOOL:1500 child task' }]);
    await sleep(300);
    const settled = await api.detail(parent);
    expect(settled.events.filter((e) => e.kind === 'result')).toHaveLength(results + 1);
    expect(settled.pending).toEqual([]);
    expect(next.spawns(parent)).toHaveLength(spawned + 1);
    expect((await api.call('POST', `/threads/${parent}/requests/resume`, { ids: [report.uuid] })).status).toBe(409);
    const record = (await api.ok('GET', `/threads/${parent}/requests`)) as { kind: string; state: string }[];
    expect(record.filter((r) => r.kind === 'crew_report').map((r) => r.state)).toEqual(['delivered']);
    await next.stop();
  });

  it('parks a report waiting for its parent at a clean shutdown instead of dropping it', T, async () => {
    const { data, server, parent, report } = await reportWaiting('report-clean');
    await server.stop();
    const next = boot(data, TWO_SLOTS);
    const api = client(await next.port());
    const d = await api.detail(parent);
    expect(d.pending).toMatchObject([{ uuid: report.uuid, kind: 'crew_report', delivery: 'recovered' }]);
    expect(d.events.filter((e) => e.kind === 'crew_report')).toHaveLength(0);
    await next.stop();
  });
});

describe('a worktree thread across a restart', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();
  type Setup = { thread: { id: string; status: string; setup: string | null; setup_error: string | null; cwd: string; branch: string } };
  const until = async <D>(fn: () => Promise<D | false>, label: string) => {
    for (const end = Date.now() + 15_000; ; ) {
      const d = await fn();
      if (d) return d;
      if (Date.now() > end) throw new Error(label);
      await sleep(50);
    }
  };

  it('keeps the first prompt and its files while setup failed, and Retry runs it once', T, async () => {
    const data = join(tmp, 'wt-failed');
    const repo = join(tmp, 'wt-failed-repo');
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    const server = boot(data);
    const api = client(await server.port());
    await api.ok('POST', '/channels', { id: 'widgets', name: 'Widgets', repo_path: repo, use_worktree: 1 });
    // No commit yet, so there is nothing to cut a worktree from.
    const t = await api.ok('POST', '/threads', withFile({ channel: 'widgets', prompt: 'read the spec', title: 'Spec' }, 'spec.txt', 'the spec'));
    await until(async () => ((await api.detail(t.id)) as unknown as Setup).thread.setup === 'failed', 'the setup to fail');
    await server.kill();

    const next = boot(data);
    const api2 = client(await next.port());
    const after = (await api2.detail(t.id)) as Detail & Setup;
    expect(after.thread).toMatchObject({ status: 'failed', setup: 'failed', setup_error: expect.stringMatching(/git worktree add failed/) });
    expect(after.pending).toMatchObject([{ text: 'read the spec', delivery: 'recovered', request_id: 'thread-start', attachments: [{ name: 'spec.txt' }] }]);
    await sleep(300);
    expect(next.spawns(t.id)).toEqual([]);

    git(repo, 'commit', '-q', '--allow-empty', '-m', 'first');
    await api2.ok('POST', `/threads/${t.id}/setup/retry`, {});
    await api2.ok('POST', `/threads/${t.id}/setup/retry`, {});
    await until(async () => (await api2.detail(t.id)).thread.status === 'done', 'the retried thread to run');
    const sent = await api2.users(t.id);
    expect(sent).toMatchObject([{ text: 'read the spec', source: 'manual' }]);
    expect(sent[0].attachments).toHaveLength(1);
    expect(next.spawns(t.id)).toHaveLength(1);
    expect(realpathSync(next.spawns(t.id)[0].cwd)).toBe(realpathSync(after.thread.cwd));
    expect(git(after.thread.cwd, 'branch', '--show-current')).toBe(after.thread.branch);
    await next.stop();
  });

  it('fails a setup a killed server left running, and Retry makes or keeps its worktree', T, async () => {
    const data = join(tmp, 'wt-killed');
    const repo = join(tmp, 'wt-killed-repo');
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'first');
    // A slow checkout, so the server is killed while it prepares.
    const hook = join(repo, '.git', 'hooks', 'post-checkout');
    writeFileSync(hook, '#!/bin/sh\nsleep 2\n');
    chmodSync(hook, 0o755);
    const server = boot(data);
    const api = client(await server.port());
    await api.ok('POST', '/channels', { id: 'slow', name: 'Slow', repo_path: repo, use_worktree: 1 });
    const t = await api.ok('POST', '/threads', { channel: 'slow', prompt: 'take your time', title: 'Slow' });
    expect(((await api.detail(t.id)) as unknown as Setup).thread.setup).toBe('preparing');
    expect((await api.detail(t.id)).pending).toMatchObject([{ text: 'take your time', state: 'waiting', delivery: 'accepted' }]);
    await server.kill();

    const next = boot(data);
    const api2 = client(await next.port());
    const after = (await api2.detail(t.id)) as Detail & Setup;
    expect(after.thread).toMatchObject({ status: 'failed', setup: 'failed', setup_error: "Omni stopped before this thread's worktree was ready." });
    expect(after.pending).toMatchObject([{ text: 'take your time', delivery: 'recovered', request_id: 'thread-start' }]);
    // Whatever the git the killed server started left (a checked out worktree, or nothing), Retry ends with one.
    rmSync(hook);
    await api2.ok('POST', `/threads/${t.id}/setup/retry`, {});
    await until(async () => (await api2.detail(t.id)).thread.status === 'done', 'the retried thread to run');
    expect(next.spawns(t.id)).toHaveLength(1);
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(2);
    await next.stop();
  });
});

describe('Needs you across a restart', () => {
  it('keeps what Ben read, lists the turn the crash ended, and the messages it parked', T, async () => {
    const { data, server, api, id: busyId } = await busy('needs-you');
    const t = await api.ok('POST', '/threads', { channel: 'inbox', prompt: 'quick one', title: 'Quick' });
    for (const end = Date.now() + 15_000; (await api.detail(t.id)).thread.status !== 'done'; ) {
      if (Date.now() > end) throw new Error('the quick thread never finished');
      await sleep(50);
    }
    const item = (await api.ok('GET', '/needs-you')).items.find((i: { thread: { id: string } }) => i.thread.id === t.id);
    await api.ok('POST', '/needs-you/read', { uid: item.result.uid });
    const read = (await api.detail(t.id)).thread as unknown as { updated_at: string; status: string };
    await api.ok('POST', `/threads/${busyId}/messages`, { prompt: 'after the crash', mode: 'queue', request_id: 'ny-1' });

    await server.kill();
    const next = boot(data);
    const api2 = client(await next.port());
    const inbox = (await api2.ok('GET', '/needs-you')) as { items: { thread: { id: string }; result: { status: string } | null; blockers: { kind: string }[] }[] };
    // Read before the restart, still read, and the thread row untouched.
    expect(inbox.items.some((i) => i.thread.id === t.id)).toBe(false);
    expect((await api2.detail(t.id)).thread).toMatchObject({ updated_at: read.updated_at, status: read.status });
    // The turn the crash ended is a failure, with the message it parked as a blocker.
    expect(inbox.items.find((i) => i.thread.id === busyId)).toMatchObject({ result: { status: 'failed' }, blockers: [{ kind: 'recovered', count: 1 }] });
    await next.stop();
  });
});
