import { afterAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FAKE_CLAUDE, fakeAlive, hasMcpBuild, sleep, waitFor } from './support.ts';

// ask_user_question across a forced restart: apps/server/index.ts as a process of its own on a throwaway data dir, the
// fake claude CLI asking through the real omni-ask MCP server, and only HTTP. The call dies with the server; the
// question does not. It still waits in Needs you, and answering it starts the thread again on the answers.

const ROOT = resolve(import.meta.dirname, '../../..');
const tmp = mkdtempSync(join(tmpdir(), 'omni-questions-'));
const brain = join(tmp, 'brain');
mkdirSync(brain);
const data = join(tmp, 'data');
const fakeLog = join(tmp, 'fake-claude.jsonl');
const children: ChildProcess[] = [];

const lines = () => (existsSync(fakeLog) ? readFileSync(fakeLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
/** A killed server leaves its CLI running; the CLI's omni-ask server exits once its stdin closes. */
const killFakes = () => {
  for (const pid of new Set(lines().map((l) => l.pid as number))) if (fakeAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
};

afterAll(() => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
  killFakes();
  rmSync(tmp, { recursive: true, force: true });
});

function boot() {
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
      // A fresh data dir would settle a new install's "Ask first" (access-default.ts); these servers run as before levels.
      OMNI_ACCESS_DEFAULT: 'full',
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

type Detail = { thread: { id: string; status: string }; events: { kind: string; payload: string }[] };

function client(port: number) {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${process.env.OMNI_TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
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
  const payloads = async (id: string, kind: string) => (await detail(id)).events.filter((e) => e.kind === kind).map((e) => JSON.parse(e.payload));
  return { ok, detail, payloads };
}

async function until<T>(fn: () => Promise<T | null | undefined | false>, label: string, timeout = 15_000): Promise<T> {
  for (const end = Date.now() + timeout; ; ) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await sleep(50);
  }
}

describe.skipIf(!hasMcpBuild)('a question across a forced restart', () => {
  it('stays in Needs you, and the answer reaches the thread as a message', { timeout: 90_000 }, async () => {
    const first = boot();
    const api = client(await first.port());
    const t = await api.ok('POST', '/threads', { channel: 'inbox', prompt: 'ASK_ONE plan the quarter', title: 'Plan the quarter' });
    const question = await until(async () => (await api.payloads(t.id, 'question'))[0], 'the question card');
    await first.kill();

    const next = boot();
    const api2 = client(await next.port());
    const inbox = await api2.ok('GET', '/needs-you');
    const item = inbox.items.find((i: { thread: { id: string } }) => i.thread.id === t.id);
    expect(item.blockers).toEqual([
      { kind: 'question', detail: 'Which Q4 goal should get the most of your time between now and December?', count: 1, at: expect.any(String) },
    ]);
    expect(item.thread.status).toBe('failed');

    const answered = await api2.ok('POST', `/threads/${t.id}/questions/${question.id}/answer`, { answers: [{ selected: ['Volero hypercare'], other: null }] });
    expect(answered).toEqual({ state: 'answered', via: 'message' });
    const said =
      'User has answered your questions: "Which Q4 goal should get the most of your time between now and December?"="Volero hypercare". ' +
      "You can now continue with the user's answers in mind.";
    await until(async () => (await api2.detail(t.id)).thread.status === 'done', 'the thread to run on the answers');
    expect((await api2.payloads(t.id, 'user')).map((u) => u.text)).toEqual(['ASK_ONE plan the quarter', said]);
    expect((await api2.payloads(t.id, 'assistant_text')).at(-1).text).toBe(`ack: ${said}`);
    expect((await api2.ok('GET', '/needs-you')).items.find((i: { thread: { id: string } }) => i.thread.id === t.id)?.blockers ?? []).toEqual([]);
    await next.stop();
  });
});
