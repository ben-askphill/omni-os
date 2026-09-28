import { readFileSync } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdapterContext, HarnessAdapter } from '../server/harness/adapter.ts';
import type { Record as StreamRecord } from '../server/stream.ts';
import { HERMES_FIX } from '../server/harness/catalog.ts';
import { startFakeHermes, type FakeHermes } from './fake-hermes.ts';
import { waitFor } from './support.ts';

let fake: FakeHermes;
let hermesAdapter: HarnessAdapter;
const kids: ChildProcess[] = [];

beforeAll(async () => {
  fake = await startFakeHermes();
  process.env.OMNI_HERMES_URL = fake.url;
  ({ hermesAdapter } = await import('../server/harness/hermes/adapter.ts'));
});
beforeEach(() => fake.reset());
afterEach(() => {
  for (const c of kids) if (c.exitCode == null && c.signalCode == null) c.kill('SIGKILL');
  kids.length = 0;
  delete process.env.HERMES_API_KEY;
});
afterAll(async () => {
  delete process.env.OMNI_HERMES_URL;
  await fake.close();
});

const posts = () => fake.calls.filter((c) => c.method === 'POST' && c.path === '/v1/runs');

function boot(opts: { key?: string; resume?: boolean; sessionId?: string; prompt?: string } = {}) {
  const records: StreamRecord[] = [];
  let session: string | null = null;
  const threadId = 'tid';
  const ctx = {
    thread: {
      id: threadId,
      channel_id: 'scratch',
      title: 't',
      status: 'running',
      role: null,
      model: 'hermes',
      harness: 'hermes',
      effort: '',
      session_id: opts.sessionId ?? threadId,
      has_run: opts.resume ? 1 : 0,
      cwd: '/tmp/omni-test',
      branch: null,
      parent_id: null,
      task_id: null,
      source: 'manual',
      automation: null,
      last_text: null,
      created_at: '',
      updated_at: '',
    },
    channel: {
      id: 'scratch',
      name: 'Scratch',
      kind: 'internal',
      repo_path: null,
      github_repo: 'acme/widgets',
      use_worktree: 0,
      base_dir: null,
      store_domain: null,
      portal_slug: null,
      browser_headless: 1,
      notes: null,
      archived: 0,
      created_at: '',
    },
    systemPrompt: opts.prompt ?? 'SYS PROMPT',
    mcpFile: null,
    secretEnv: opts.key === '' ? {} : { HERMES_API_KEY: opts.key ?? 'test-key' },
    browserBusy: false,
    omniUrl: 'http://127.0.0.1:9',
    resume: !!opts.resume,
  } as AdapterContext;
  const sessionHandle = hermesAdapter.spawn(ctx, {
    record: (r) => records.push(r),
    usage: () => {
      throw new Error('Hermes must not report plan usage');
    },
    session: (id) => {
      session = id;
    },
  });
  kids.push(sessionHandle.child);
  const user = (text: string, uuid: string, attachments: { name: string; path: string; size: number; mime: string; image: boolean }[] = []) =>
    sessionHandle.write({ type: 'user', uuid, _omni: { text, attachments } });
  return { records, session: () => session, child: sessionHandle.child, write: sessionHandle.write, user };
}

const resultOf = (records: StreamRecord[]) => records.filter((r) => r.kind === 'result');

describe('Hermes adapter', () => {
  it('sends instructions once, replays only what Ben typed, and stores omni-<thread id>', async () => {
    const s = boot();
    s.user('hello', 'm1');
    await waitFor(() => resultOf(s.records).length === 1, 'first result');
    expect(s.session()).toBe('omni-tid');
    const first = posts();
    expect(first).toHaveLength(1);
    expect(first[0].body).toMatchObject({ input: 'hello', session_id: 'omni-tid', instructions: 'SYS PROMPT' });
    expect(first[0].idempotencyKey).toBe('m1');
    expect(first[0].authorization).toBe('Bearer test-key');
    expect(s.records.find((r) => r.kind === 'replay')?.payload).toEqual({ uuid: 'm1', text: 'hello' });
    expect(s.records.filter((r) => r.kind === 'assistant_text').map((r) => r.payload)).toEqual([{ text: 'The command printed "hi".' }]);
    expect(s.records.find((r) => r.kind === 'tool_use')?.payload).toMatchObject({ name: 'Bash', input: { command: 'echo hi' } });
    expect(s.records.some((r) => JSON.stringify(r.payload).includes('ignored'))).toBe(false);
    expect(resultOf(s.records)[0].payload).toMatchObject({ ok: true, turns: 1, model: 'claude-opus-5-5', input_tokens: 11, output_tokens: 7 });

    s.user('again', 'm2');
    await waitFor(() => resultOf(s.records).length === 2, 'second result');
    const second = posts();
    expect(second).toHaveLength(2);
    expect((second[1].body as { instructions?: string }).instructions).toBeUndefined();
    expect(second[1].body).toMatchObject({ input: 'again', session_id: 'omni-tid' });
    expect(second[1].idempotencyKey).toBe('m2');
  });

  it('omits instructions when the session is already running', async () => {
    const s = boot({ resume: true, sessionId: 'omni-tid' });
    s.user('later', 'm9');
    await waitFor(() => resultOf(s.records).length === 1, 'resumed result');
    expect(s.session()).toBeNull();
    expect((posts()[0].body as { instructions?: string }).instructions).toBeUndefined();
  });

  it('describes attachments and does not send the Mac path', async () => {
    const s = boot();
    s.user('see this', 'm-file', [{ name: 'shot.png', path: '/Users/ben/Desktop/shot.png', size: 2048, mime: 'image/png', image: true }]);
    await waitFor(() => posts().length === 1, 'create');
    const input = (posts()[0].body as { input: string }).input;
    expect(input).toContain('shot.png');
    expect(input).toContain('not transferred');
    expect(input).not.toContain('/Users/ben');
    expect(s.records.find((r) => r.kind === 'replay')?.payload).toMatchObject({ text: 'see this' });
  });

  it('steers the active run, and queues the text when Hermes answers 409', async () => {
    fake.hold = true;
    const s = boot();
    s.user('first', 'a');
    await waitFor(() => fake.calls.some((c) => c.path.endsWith('/events')), 'stream open');
    s.user('while it runs', 'b');
    await waitFor(() => fake.calls.some((c) => c.path.endsWith('/steer')), 'steer');
    const steer = fake.calls.find((c) => c.path.endsWith('/steer'));
    expect(steer?.body).toEqual({ input: 'while it runs' });
    expect(s.records.filter((r) => r.kind === 'replay').map((r) => (r.payload as { text: string }).text)).toEqual(['first', 'while it runs']);
    fake.complete('finished');
    await waitFor(() => resultOf(s.records).length === 1, 'steered result');
    expect(posts()).toHaveLength(1);
  });

  it('queues a steer that Hermes rejects and runs it next', async () => {
    fake.hold = true;
    fake.steerConflict = true;
    const s = boot();
    s.user('first', 'a');
    await waitFor(() => fake.calls.some((c) => c.path.endsWith('/events')), 'stream open');
    s.user('after', 'b');
    await waitFor(() => fake.calls.some((c) => c.path.endsWith('/steer')), 'steer 409');
    expect(s.records.filter((r) => r.kind === 'replay')).toHaveLength(1);
    fake.steerConflict = false;
    fake.hold = false;
    fake.complete('done first');
    await waitFor(() => posts().length === 2, 'second run');
    expect(posts()[1].body).toMatchObject({ input: 'after' });
    expect(posts()[1].idempotencyKey).toBe('b');
    await waitFor(() => resultOf(s.records).length === 2, 'both results');
    expect(s.records.filter((r) => r.kind === 'replay').map((r) => (r.payload as { text: string }).text)).toEqual(['first', 'after']);
  });

  it('interrupts by stopping the run', async () => {
    fake.hold = true;
    const s = boot();
    s.user('go', 'a');
    await waitFor(() => fake.calls.some((c) => c.path.endsWith('/events')), 'stream open');
    s.write({ type: 'control_request', request_id: 'int-1', request: { subtype: 'interrupt' } });
    await waitFor(() => resultOf(s.records).length === 1, 'cancelled');
    expect(fake.calls.some((c) => c.method === 'POST' && c.path.endsWith('/stop'))).toBe(true);
    expect(s.records.find((r) => r.kind === 'control')?.payload).toMatchObject({ request_id: 'int-1', subtype: 'success' });
    expect(resultOf(s.records)[0].payload).toMatchObject({ ok: false, subtype: 'cancelled', turns: 1 });
  });

  it('stops the active run when the holder dies', async () => {
    fake.hold = true;
    const s = boot();
    s.user('go', 'a');
    await waitFor(() => fake.calls.some((c) => c.path.endsWith('/events')), 'stream open');
    s.child.kill('SIGTERM');
    await waitFor(() => fake.calls.some((c) => c.method === 'POST' && c.path.endsWith('/stop')), 'stop after kill');
    expect(resultOf(s.records).length).toBeLessThanOrEqual(1);
  });

  it('retries a 429 and prefixes the prompt when instructions are rejected', async () => {
    fake.failPosts = 1;
    const s = boot();
    s.user('hello', 'm1');
    await waitFor(() => resultOf(s.records).some((r) => (r.payload as { ok?: boolean }).ok), 'retried');
    const okPosts = posts();
    expect(okPosts.length).toBeGreaterThanOrEqual(2);
    expect(okPosts[0].idempotencyKey).toBe('m1');
    expect(okPosts[1].idempotencyKey).toBe('m1');

    fake.reset();
    fake.rejectInstructions = true;
    const s2 = boot();
    s2.user('hello', 'm2');
    await waitFor(() => resultOf(s2.records).length === 1, 'prefixed');
    const created = posts();
    expect(created[0].body).toMatchObject({ instructions: 'SYS PROMPT' });
    expect((created[1].body as { instructions?: string }).instructions).toBeUndefined();
    expect((created[1].body as { input: string }).input.startsWith('SYS PROMPT\n\n---\n\nhello')).toBe(true);
    expect(created[1].idempotencyKey).toBe('m2:text');
    expect(s2.records.find((r) => r.kind === 'replay')?.payload).toMatchObject({ text: 'hello' });
  });

  it('reconciles a dropped event stream with GET', async () => {
    fake.dropStream = true;
    const s = boot();
    s.user('hello', 'm1');
    await waitFor(() => resultOf(s.records).length === 1, 'reconciled');
    expect(s.records.find((r) => r.kind === 'assistant_text')?.payload).toEqual({ text: 'reconciled answer' });
    expect(resultOf(s.records)[0].payload).toMatchObject({ ok: true, model: 'claude-opus-5-5', input_tokens: 11 });
    expect(fake.calls.some((c) => c.method === 'GET' && /\/v1\/runs\/run_/.test(c.path) && !c.path.endsWith('/events'))).toBe(true);
  });

  it('records an approval request as status', async () => {
    fake.script = [
      { event: 'approval.request', tool: 'terminal', preview: 'rm -rf /', seq: 0 },
      { event: 'run.completed', output: 'waiting', seq: 1 },
    ];
    const s = boot();
    s.user('careful', 'm1');
    await waitFor(() => resultOf(s.records).length === 1, 'approval result');
    expect(s.records.find((r) => r.kind === 'status')?.payload).toMatchObject({ text: 'Approval requested: terminal — rm -rf /' });
  });

  it('fails the turn when the key is missing, and the holder never sees a key', async () => {
    const before = fake.calls.length;
    const s = boot({ key: '' });
    s.user('hello', 'm1');
    await waitFor(() => resultOf(s.records).length === 1, 'missing key');
    expect(s.records.find((r) => r.kind === 'error')?.payload).toEqual({ text: HERMES_FIX });
    expect(resultOf(s.records)[0].payload).toMatchObject({ ok: false });
    expect(fake.calls.length).toBe(before);
    await waitFor(() => s.child.exitCode != null || s.child.signalCode != null, 'holder exit');

    process.env.HERMES_API_KEY = 'from-shell';
    const live = boot({ key: 'from-keychain' });
    const env = readFileSync(`/proc/${live.child.pid}/environ`).toString();
    expect(env).not.toContain('from-shell');
    expect(env).not.toContain('from-keychain');
    expect(env).not.toContain('HERMES_API_KEY');
  });
});
