import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterContext } from '../server/harness/adapter.ts';
import type { Record as StreamRecord } from '../server/stream.ts';
import { config } from '../server/config.ts';
import { makeCloudAdapter, type CloudDeps } from '../server/harness/claude-cloud/adapter.ts';
import { createArgs, fireRoutine, lastJson, normalizeSessionId, parseDispatch, ROUTINE_BETA, type Exec } from '../server/harness/claude-cloud/dispatch.ts';
import { awaitReply, deliverReply, isWaiting, resetReplies } from '../server/harness/claude-cloud/replies.ts';
import { cloudHarness, CLOUD_FIX, resolveModel } from '../server/harness/catalog.ts';
import { harnessEnv } from '../server/harness/env-guard.ts';
import { bearerMatches } from '../server/cloud-api.ts';
import { waitFor } from './support.ts';

const kids: ChildProcess[] = [];
const saved = { env: config.cloudEnvironment, routine: config.cloudRoutineUrl, wait: config.cloudReplyWaitMinutes };

beforeEach(() => {
  config.cloudEnvironment = 'env_test';
  config.cloudRoutineUrl = '';
  config.cloudReplyWaitMinutes = 0;
  resetReplies();
});
afterEach(() => {
  for (const c of kids) if (c.exitCode == null && c.signalCode == null) c.kill('SIGKILL');
  kids.length = 0;
  config.cloudEnvironment = saved.env;
  config.cloudRoutineUrl = saved.routine;
  config.cloudReplyWaitMinutes = saved.wait;
});

interface Call {
  bin: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
}

/** A fake `claude` and `git`: creates answer with a new session, sends with the same one. */
function fakeDeps(opts: { createOut?: Exec; sendOut?: Exec; hold?: boolean } = {}) {
  const calls: Call[] = [];
  let release: (() => void) | null = null;
  const run: CloudDeps['run'] = async (bin, args, o) => {
    calls.push({ bin, args, cwd: o.cwd, env: o.env });
    if (bin === 'git') return { code: 0, stdout: 'origin/main\n', stderr: '' };
    if (opts.hold) {
      await new Promise<void>((resolve, reject) => {
        release = resolve;
        o.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
    if (args.includes('--environment'))
      return opts.createOut ?? { code: 0, stdout: 'Starting…\n{"ok":true,"session_id":"session_01ABC","url":"https://claude.ai/code/session_01ABC"}\n', stderr: '' };
    const id = args[args.indexOf('--cloud') + 1];
    return opts.sendOut ?? { code: 0, stdout: JSON.stringify({ ok: true, session_id: id, url: `https://claude.ai/code/${id}` }), stderr: '' };
  };
  const fetches: { url: string; init: RequestInit }[] = [];
  const deps: CloudDeps = {
    run,
    fetch: (async (url: string, init: RequestInit) => {
      fetches.push({ url, init });
      return new Response(JSON.stringify({ type: 'routine_fire', claude_code_session_id: 'session_01R', claude_code_session_url: 'https://claude.ai/code/session_01R' }), { status: 200 });
    }) as unknown as typeof fetch,
    secret: async () => 'routine-token',
  };
  return { deps, calls, fetches, release: () => release?.() };
}

function boot(deps: CloudDeps, opts: { sessionId?: string; repo?: string | null; secretEnv?: Record<string, string> } = {}) {
  const records: StreamRecord[] = [];
  let session: string | null = null;
  const ctx = {
    thread: {
      id: 'tid',
      channel_id: 'omni-os',
      title: 't',
      status: 'running',
      role: null,
      model: null,
      harness: 'claude-cloud',
      effort: '',
      session_id: opts.sessionId ?? 'tid',
      has_run: 0,
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
    channel: { id: 'omni-os', name: 'Omni OS', kind: 'personal', repo_path: opts.repo === undefined ? '/tmp/repo' : opts.repo, github_repo: 'ben/omni-os' },
    systemPrompt: 'SYS PROMPT',
    mcpFile: null,
    secretEnv: opts.secretEnv ?? { SOME_SECRET: 'x' },
    browserBusy: false,
    omniUrl: 'http://127.0.0.1:9',
    resume: false,
  } as unknown as AdapterContext;
  const h = makeCloudAdapter(deps).spawn(ctx, {
    record: (r) => records.push(r),
    usage: () => {
      throw new Error('cloud sessions do not report plan usage');
    },
    session: (id) => {
      session = id;
    },
  });
  kids.push(h.child);
  const user = (text: string, uuid: string) => h.write({ type: 'user', uuid, _omni: { text, attachments: [] } });
  return { records, session: () => session, write: h.write, user, child: h.child };
}

const results = (r: StreamRecord[]) => r.filter((x) => x.kind === 'result');
const texts = (r: StreamRecord[]) => r.filter((x) => x.kind === 'assistant_text').map((x) => (x.payload as { text: string }).text);

describe('cloud dispatch', () => {
  it('builds the create command and reads the session from the last JSON line', () => {
    expect(createArgs({ brief: 'do it', environment: 'env_x', ref: 'main', model: 'claude-opus-5-5' })).toEqual([
      '-p', 'do it', '--environment', 'env_x', '--output-format', 'json', '--ref', 'main', '--model', 'claude-opus-5-5',
    ]);
    expect(lastJson('noise\n{"ok":true}\n')).toEqual({ ok: true });
    expect(parseDispatch({ code: 0, stdout: '{"ok":true,"session_id":"cse_9"}', stderr: '' }, 'x')).toEqual({ id: 'session_9', url: 'https://claude.ai/code/session_9' });
    expect(() => parseDispatch({ code: 1, stdout: '{"ok":false,"error":"no env"}', stderr: '' }, 'Starting')).toThrow('Starting failed: no env');
    expect(() => parseDispatch({ code: 1, stdout: '', stderr: 'Cloud sessions are disabled by your organization' }, 'Starting')).toThrow('disabled by your organization');
    expect(normalizeSessionId('cse_abc')).toBe('session_abc');
  });

  it('fires a routine with its token and beta header', async () => {
    const { deps, fetches } = fakeDeps();
    const s = await fireRoutine({ url: 'https://api.anthropic.com/v1/claude_code/routines/trig_1/fire', token: 'tok', text: 'brief' }, deps.fetch);
    expect(s).toEqual({ id: 'session_01R', url: 'https://claude.ai/code/session_01R' });
    const h = fetches[0].init.headers as Record<string, string>;
    expect(h.authorization).toBe('Bearer tok');
    expect(h['anthropic-beta']).toBe(ROUTINE_BETA);
    expect(JSON.parse(String(fetches[0].init.body))).toEqual({ text: 'brief' });
  });

  it('strips API keys so the claude.ai login is used', () => {
    const env = harnessEnv('claude-cloud', {}, {}, { ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', PATH: '/bin' });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.PATH).toBe('/bin');
  });
});

describe('cloud catalog', () => {
  it('offers the cloud default and Claude models, and says how to turn it on', () => {
    const on = cloudHarness({ available: true }, 3);
    expect(on.models[0]).toMatchObject({ id: 'default', default: true });
    expect(on.models.some((m) => m.id === 'claude-opus-5-5')).toBe(true);
    expect(resolveModel({ harnesses: [on] }, 'claude-cloud', 'opus')?.id).toBe('claude-opus-5-5');
    expect(cloudHarness({ available: false }, 3)).toMatchObject({ available: false, fix: CLOUD_FIX, models: [] });
  });
});

describe('cloud adapter', () => {
  it('starts a session with Omni context on the first message, then queues later ones into it', async () => {
    const f = fakeDeps();
    const s = boot(f.deps);
    s.user('fix the bug', 'm1');
    await waitFor(() => results(s.records).length === 1, 'first result');
    const create = f.calls.find((c) => c.args.includes('--environment'))!;
    expect(create.args.slice(0, 2)).toEqual(['-p', 'SYS PROMPT\n\n---\n\nfix the bug']);
    expect(create.args).toEqual(expect.arrayContaining(['--environment', 'env_test', '--ref', 'main', '--output-format', 'json']));
    expect(create.cwd).toBe('/tmp/repo');
    expect(create.env.SOME_SECRET).toBeUndefined();
    expect(s.session()).toBe('session_01ABC');
    expect(s.records.find((r) => r.kind === 'replay')?.payload).toEqual({ uuid: 'm1', text: 'fix the bug' });
    expect(texts(s.records)[0]).toContain('https://claude.ai/code/session_01ABC');
    expect(results(s.records)[0].payload).toMatchObject({ ok: true, subtype: 'success', turns: 1 });

    s.user('also add a test', 'm2');
    await waitFor(() => results(s.records).length === 2, 'second result');
    const send = f.calls.filter((c) => c.args.includes('--cloud'));
    expect(send).toHaveLength(1);
    expect(send[0].args).toEqual(['-p', 'also add a test', '--cloud', 'session_01ABC', '--output-format', 'json']);
    expect(f.calls.filter((c) => c.args.includes('--environment'))).toHaveLength(1);
  });

  it('picks up the thread session after a restart instead of starting a new one', async () => {
    const f = fakeDeps();
    const s = boot(f.deps, { sessionId: 'session_OLD' });
    s.user('next step', 'm1');
    await waitFor(() => results(s.records).length === 1, 'result');
    expect(f.calls.some((c) => c.args.includes('--environment'))).toBe(false);
    expect(f.calls[0].args).toContain('session_OLD');
    expect(s.session()).toBeNull();
  });

  it('fails the turn with the CLI reason', async () => {
    const f = fakeDeps({ createOut: { code: 1, stdout: '', stderr: 'Cloud sessions are disabled by your organization\'s policy.' } });
    const s = boot(f.deps);
    s.user('go', 'm1');
    await waitFor(() => results(s.records).length === 1, 'result');
    expect(results(s.records)[0].payload).toMatchObject({ ok: false, subtype: 'error' });
    expect(s.records.find((r) => r.kind === 'error')?.payload).toMatchObject({ text: expect.stringContaining("disabled by your organization's policy") });
  });

  it('fires the routine when no environment is set', async () => {
    config.cloudEnvironment = '';
    config.cloudRoutineUrl = 'https://api.anthropic.com/v1/claude_code/routines/trig_1/fire';
    const f = fakeDeps();
    const s = boot(f.deps, { repo: null });
    s.user('triage', 'm1');
    await waitFor(() => results(s.records).length === 1, 'result');
    expect(f.fetches).toHaveLength(1);
    expect(s.session()).toBe('session_01R');
  });

  it('says how to set it up when nothing is configured', async () => {
    config.cloudEnvironment = '';
    const f = fakeDeps();
    const s = boot(f.deps);
    s.user('go', 'm1');
    await waitFor(() => results(s.records).length === 1, 'result');
    expect(s.records.find((r) => r.kind === 'error')?.payload).toEqual({ text: CLOUD_FIX });
  });

  it('waits for the reply the session posts back, and reports it as the turn text', async () => {
    config.cloudReplyWaitMinutes = 1;
    const f = fakeDeps();
    const s = boot(f.deps);
    s.user('research it', 'm1');
    await waitFor(() => isWaiting('session_01ABC'), 'waiting');
    expect(results(s.records)).toHaveLength(0);
    expect(deliverReply('cse_01ABC', 'Found 3 issues.')).toBe(true);
    await waitFor(() => results(s.records).length === 1, 'result');
    expect(texts(s.records)[0]).toContain('Found 3 issues.');
    expect(texts(s.records)[0]).toContain('https://claude.ai/code/session_01ABC');
  });

  it('queues a steer into the running session while it waits', async () => {
    config.cloudReplyWaitMinutes = 1;
    const f = fakeDeps();
    const s = boot(f.deps);
    s.user('research it', 'm1');
    await waitFor(() => isWaiting('session_01ABC'), 'waiting');
    s.user('focus on pricing', 'm2');
    await waitFor(() => s.records.filter((r) => r.kind === 'replay').length === 2, 'steer replayed');
    expect(f.calls.find((c) => c.args.includes('--cloud'))?.args[1]).toBe('focus on pricing');
    deliverReply('session_01ABC', 'done');
    await waitFor(() => results(s.records).length === 1, 'result');
  });

  it('stops waiting on interrupt; the session itself keeps running', async () => {
    config.cloudReplyWaitMinutes = 1;
    const f = fakeDeps();
    const s = boot(f.deps);
    s.user('long job', 'm1');
    await waitFor(() => isWaiting('session_01ABC'), 'waiting');
    s.write({ type: 'control_request', request_id: 'int-1', request: { subtype: 'interrupt' } });
    await waitFor(() => results(s.records).length === 1, 'stopped');
    expect(s.records.find((r) => r.kind === 'control')?.payload).toMatchObject({ request_id: 'int-1', subtype: 'success' });
    expect(results(s.records)[0].payload).toMatchObject({ ok: false, subtype: 'interrupted' });
    expect(isWaiting('session_01ABC')).toBe(false);
  });

  it('interrupts a dispatch still in flight', async () => {
    const f = fakeDeps({ hold: true });
    const s = boot(f.deps);
    s.user('go', 'm1');
    await waitFor(() => f.calls.some((c) => c.args.includes('--environment')), 'dispatching');
    s.write({ type: 'control_request', request_id: 'int-2', request: { subtype: 'interrupt' } });
    await waitFor(() => results(s.records).length === 1, 'stopped');
    expect(results(s.records)[0].payload).toMatchObject({ ok: false, subtype: 'interrupted' });
  });
});

describe('cloud replies', () => {
  it('keeps a reply that lands just before the wait, but never hands an old one to a later turn', async () => {
    deliverReply('session_A', 'early', 1000);
    expect(await awaitReply('session_A', 50, undefined, 500)).toBe('early');
    deliverReply('session_B', 'stale', 1000);
    expect(await awaitReply('session_B', 30, undefined, 2000)).toBeNull();
  });

  it('checks the bearer in constant time and refuses without a secret', () => {
    expect(bearerMatches('Bearer s3cret', 's3cret')).toBe(true);
    expect(bearerMatches('Bearer nope', 's3cret')).toBe(false);
    expect(bearerMatches(undefined, 's3cret')).toBe(false);
    expect(bearerMatches('Bearer ', null)).toBe(false);
  });
});

vi.setConfig({ testTimeout: 15_000 });
