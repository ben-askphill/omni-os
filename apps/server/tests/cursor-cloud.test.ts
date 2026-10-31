import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '@omni/test-fixtures';
import { parseContexts } from '@omni/shared/message-context-kinds.ts';
import type { AdapterContext, HarnessAdapter, HarnessSession } from '../harness/adapter.ts';
import { harnessText } from '../message-context/project.ts';
import type { CloudAgentState, Record as StreamRecord } from '../stream.ts';
import {
  CURSOR_CLOUD_FIX,
  CURSOR_CLOUD_NO_REPO,
  CURSOR_CLOUD_REJECTED,
  CURSOR_CLOUD_UNREACHABLE,
  catalogForChannel,
  claudeHarness,
  codexHarness,
  cursorCloudHarness,
  cursorHarness,
  hermesHarness,
  type Catalog,
} from '../harness/catalog.ts';
import { endRecords, stateOf } from '../harness/cursor-cloud/normalize.ts';
import { harnessEnv } from '../harness/env-guard.ts';
import { profileTask, routeTask } from '../harness/auto.ts';
import { resolveRun } from '../harness/resolve.ts';
import { startFakeCursorApi } from '@omni/test-fixtures/fake-cursor-api.mjs';
import { waitFor } from './support.ts';

// The imports above reach db.ts (message-context -> thread-history). Without a data dir of its own that opens, and
// migrates, the shared data/omni.db, and two test workers migrating it at once fail ("trigger ... already exists").
// Hoisted so it is set before the static imports load.
const DATA_DIR = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const dir = mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'omni-cloud-data-'));
  process.env.OMNI_DATA_DIR = dir;
  return dir;
});

// The Cursor Cloud harness against a fake Cloud Agents API on 127.0.0.1. Nothing here calls Cursor.

type Fake = Awaited<ReturnType<typeof startFakeCursorApi>>;
let fake: Fake;
let adapter: HarnessAdapter;
const sessions: HarnessSession[] = [];

beforeAll(async () => {
  fake = await startFakeCursorApi();
  process.env.OMNI_CURSOR_API_URL = fake.url;
  process.env.OMNI_CURSOR_CLOUD_POLL_MS = '5';
  // The static imports above already loaded config.ts (the message-context kinds read the uploads folder from it), before
  // these env vars were set. The adapter gets a fresh config.
  vi.resetModules();
  ({ cursorCloudAdapter: adapter } = await import('../harness/cursor-cloud/adapter.ts'));
});
beforeEach(() => {
  fake.reset();
});
afterEach(() => {
  for (const s of sessions) s.end('kill');
  sessions.length = 0;
});
afterAll(async () => {
  delete process.env.OMNI_CURSOR_API_URL;
  delete process.env.OMNI_CURSOR_CLOUD_POLL_MS;
  await fake.close();
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const THREAD_ID = '6f1c2d3e-4a5b-4c6d-8e7f-901234567890';
const AGENT_ID = `bc-${THREAD_ID}`;

function boot(opts: { key?: string; repo?: string | null; sessionId?: string; model?: string; title?: string } = {}) {
  const records: StreamRecord[] = [];
  const exits: [number | null, NodeJS.Signals | null][] = [];
  let session: string | null = null;
  const ctx = {
    thread: {
      id: THREAD_ID,
      channel_id: 'acme',
      title: opts.title ?? 'Move the toolbar buttons',
      status: 'running',
      role: null,
      model: opts.model ?? 'default',
      harness: 'cursor-cloud',
      effort: '',
      session_id: opts.sessionId ?? THREAD_ID,
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
    channel: {
      id: 'acme',
      name: 'Acme',
      kind: 'client',
      repo_path: null,
      github_repo: opts.repo === undefined ? 'acme/widgets' : opts.repo,
      use_worktree: 0,
      base_dir: null,
      store_domain: null,
      portal_slug: null,
      browser_headless: 1,
      notes: null,
      archived: 0,
      created_at: '',
    },
    systemPrompt: 'SYS PROMPT',
    mcpFile: null,
    secretEnv: opts.key === '' ? {} : { CURSOR_API_KEY: opts.key ?? 'test-cursor-key', OTHER: 'x' },
    browserBusy: false,
    omniUrl: 'http://127.0.0.1:9',
    resume: false,
  } as unknown as AdapterContext;
  const handle = adapter.spawn(ctx, {
    record: (r) => records.push(r),
    usage: () => {
      throw new Error('Cursor Cloud reports no plan usage');
    },
    session: (id) => {
      session = id;
    },
    exit: (code, signal) => exits.push([code, signal]),
  });
  sessions.push(handle);
  const user = (text: string, uuid: string, attachments: { name: string; path: string; size: number; mime: string; image: boolean }[] = []) =>
    handle.send({ uuid, text, attachments, commands: [] });
  const interrupt = (id = 'int-1') => handle.interrupt(id);
  return { records, exits, session: () => session, handle, user, interrupt };
}

const results = (records: StreamRecord[]) => records.filter((r) => r.kind === 'result').map((r) => r.payload as { ok: boolean; subtype: string });
const states = (records: StreamRecord[]) => records.filter((r) => r.kind === 'cloud_agent').map((r) => r.payload as CloudAgentState);
const texts = (records: StreamRecord[], kind: string) => records.filter((r) => r.kind === kind).map((r) => (r.payload as { text: string }).text);
const calls = (method: string, path: string | RegExp) => fake.calls.filter((c) => c.method === method && (typeof path === 'string' ? c.path === path : path.test(c.path)));

describe('Cursor Cloud adapter', () => {
  it('launches an agent on the channel repo with Omni context, follows the run to its PR, and reports it', async () => {
    const s = boot();
    s.user('Move the toolbar buttons to the right', 'm1');
    await waitFor(() => results(s.records).length === 1, 'first result');

    const [create] = calls('POST', '/v1/agents');
    expect(create.auth).toBe('bearer');
    expect(create.body).toMatchObject({
      agentId: AGENT_ID,
      repos: [{ url: 'https://github.com/acme/widgets' }],
      autoCreatePR: true,
      name: 'Move the toolbar buttons',
    });
    // "Cursor default" sends no model, so the agent uses the one set on cursor.com.
    expect((create.body as { model?: unknown }).model).toBeUndefined();
    const text = (create.body as { prompt: { text: string } }).prompt.text;
    expect(text.startsWith('SYS PROMPT\n\n---\n\n')).toBe(true);
    expect(text.endsWith('Move the toolbar buttons to the right')).toBe(true);
    expect(s.session()).toBe(AGENT_ID);

    expect(s.records[0]).toMatchObject({ kind: 'init', payload: { model: 'default' } });
    expect(s.records.find((r) => r.kind === 'replay')?.payload).toEqual({ uuid: 'm1', text: 'Move the toolbar buttons to the right' });
    const seen = states(s.records);
    expect(seen.map((x) => x.status)).toEqual(['CREATING', 'RUNNING', 'RUNNING', 'FINISHED']);
    expect(seen[0]).toMatchObject({ agent_id: AGENT_ID, url: `https://cursor.com/agents/${AGENT_ID}`, repo: 'acme/widgets', ref: 'main' });
    const last = seen.at(-1)!;
    expect(last.branch).toMatch(/^cursor\//);
    expect(last.pr_url).toBe('https://github.com/acme/widgets/pull/101');
    expect(texts(s.records, 'status')).toEqual(['Cursor cloud agent is starting', 'Cursor cloud agent is working']);
    const reply = texts(s.records, 'assistant_text').join('\n');
    expect(reply).toContain('Done: Move the toolbar buttons to the right');
    expect(reply).toContain('PR: https://github.com/acme/widgets/pull/101');
    expect(results(s.records)).toEqual([expect.objectContaining({ ok: true, subtype: 'success', turns: 1 })]);
  });

  it('sends a later message as a follow-up run on the same agent, without Omni context', async () => {
    const s = boot();
    s.user('first', 'm1');
    await waitFor(() => results(s.records).length === 1, 'first result');
    s.user('also add a test', 'm2');
    await waitFor(() => results(s.records).length === 2, 'second result');
    expect(calls('POST', '/v1/agents')).toHaveLength(1);
    const runs = calls('POST', `/v1/agents/${AGENT_ID}/runs`);
    expect(runs).toHaveLength(1);
    expect(runs[0].body).toEqual({ prompt: { text: 'also add a test' } });
    expect(new Set(states(s.records).map((x) => x.run_id)).size).toBe(2);
  });

  it('follows up on an agent a resumed thread already has', async () => {
    const first = boot();
    first.user('first', 'm1');
    await waitFor(() => results(first.records).length === 1, 'first result');
    first.handle.end('terminate');

    const s = boot({ sessionId: AGENT_ID });
    s.user('next', 'm2');
    await waitFor(() => results(s.records).length === 1, 'resumed result');
    expect(calls('POST', '/v1/agents')).toHaveLength(1);
    expect(calls('POST', `/v1/agents/${AGENT_ID}/runs`)).toHaveLength(1);
    expect(s.session()).toBeNull();
  });

  it('waits for a run still going from before (Omni quit mid-run), then sends the message', async () => {
    const first = boot();
    first.user('CLOUD:SLOW long job', 'm1');
    await waitFor(() => states(first.records).some((x) => x.status === 'RUNNING'), 'running');
    // Quitting Omni closes the session: the agent keeps working on Cursor's side.
    first.handle.end('close');
    await waitFor(() => first.exits.length === 1, 'session gone');
    expect(first.exits).toEqual([[0, null]]);
    expect(first.handle.alive).toBe(false);
    expect(calls('POST', /\/cancel$/)).toHaveLength(0);

    const s = boot({ sessionId: AGENT_ID });
    s.user('and then this', 'm2');
    await waitFor(() => results(s.records).length === 1, 'result after the earlier run');
    expect(texts(s.records, 'status')).toContain("Waiting for the agent's earlier run to finish");
    expect(texts(s.records, 'assistant_text').join('\n')).toContain('Done: CLOUD:SLOW long job');
    expect(calls('POST', `/v1/agents/${AGENT_ID}/runs`).map((c) => c.body)).toEqual([
      { prompt: { text: 'and then this' } },
      { prompt: { text: 'and then this' } },
    ]);
    expect(results(s.records)[0]).toMatchObject({ ok: true });
  });

  it('cancels the run on Stop and ends the turn as cancelled', async () => {
    const s = boot();
    s.user('CLOUD:HOLD wait for me', 'm1');
    await waitFor(() => states(s.records).some((x) => x.status === 'RUNNING'), 'running');
    s.interrupt('int-1');
    await waitFor(() => results(s.records).length === 1, 'cancelled result');
    expect(s.records.find((r) => r.kind === 'control')?.payload).toMatchObject({ request_id: 'int-1', subtype: 'success' });
    expect(calls('POST', /\/runs\/run-[^/]+\/cancel$/)).toHaveLength(1);
    expect(states(s.records).at(-1)?.status).toBe('CANCELLED');
    expect(results(s.records)[0]).toMatchObject({ ok: false, subtype: 'cancelled' });
  });

  it('cancels the run when the runner hard-stops the thread', async () => {
    const s = boot();
    s.user('CLOUD:HOLD wait', 'm1');
    await waitFor(() => states(s.records).some((x) => x.status === 'RUNNING'), 'running');
    s.handle.end('stop');
    await waitFor(() => calls('POST', /\/cancel$/).length === 1, 'cancel sent');
    await waitFor(() => s.exits.length === 1, 'session gone');
    expect(s.exits).toEqual([[null, 'SIGINT']]);
    // The runner gets no records from the turn it stopped: it marks the turn stopped itself.
    expect(results(s.records)).toEqual([]);
  });

  it('maps an agent that errors or expires to a failed turn with the reason', async () => {
    const s = boot();
    s.user('CLOUD:ERROR break', 'm1');
    await waitFor(() => results(s.records).length === 1, 'error result');
    expect(results(s.records)[0]).toMatchObject({ ok: false, subtype: 'error' });
    expect(texts(s.records, 'error')[0]).toContain('stopped with an error');
    expect(texts(s.records, 'error')[0]).toContain(`https://cursor.com/agents/${AGENT_ID}`);
  });

  it('says why Cursor refused the repo', async () => {
    const s = boot();
    s.user('CLOUD:NOREPO go', 'm1');
    await waitFor(() => results(s.records).length === 1, 'refused');
    expect(texts(s.records, 'error')[0]).toContain("Cursor can't open acme/widgets on GitHub");
    expect(s.session()).toBeNull();
  });

  it('says the key was rejected, and never puts the key in a record', async () => {
    const s = boot({ key: 'bad-key' });
    s.user('go', 'm1');
    await waitFor(() => results(s.records).length === 1, 'rejected');
    expect(texts(s.records, 'error')).toEqual([CURSOR_CLOUD_REJECTED]);
    expect(JSON.stringify(s.records)).not.toContain('bad-key');
  });

  it('refuses without a key or a GitHub repo, before calling the API', async () => {
    const noKey = boot({ key: '' });
    noKey.user('go', 'm1');
    await waitFor(() => results(noKey.records).length === 1, 'no key');
    expect(texts(noKey.records, 'error')[0]).toContain(CURSOR_CLOUD_FIX);

    const noRepo = boot({ repo: null });
    noRepo.user('go', 'm2');
    await waitFor(() => results(noRepo.records).length === 1, 'no repo');
    expect(texts(noRepo.records, 'error')[0]).toContain(CURSOR_CLOUD_NO_REPO);
    expect(fake.calls).toHaveLength(0);
  });

  it('runs no local process, so the key reaches no process environment', async () => {
    const s = boot();
    expect(s.handle.pid).toBeUndefined();
    s.user('go', 'm1');
    await waitFor(() => results(s.records).length === 1, 'result');
    expect(s.handle.alive).toBe(true);
  });

  it('uploads images that fit and describes the rest without their Mac paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omni-cloud-img-'));
    try {
      const png = join(dir, 'shot.png');
      writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const s = boot();
      s.user('see these', 'm1', [
        { name: 'shot.png', path: png, size: 4, mime: 'image/png', image: true },
        { name: 'notes.pdf', path: join(dir, 'notes.pdf'), size: 2048, mime: 'application/pdf', image: false },
      ]);
      await waitFor(() => calls('POST', '/v1/agents').length === 1, 'create');
      const prompt = (calls('POST', '/v1/agents')[0].body as { prompt: { text: string; images?: { data: string; mimeType: string }[] } }).prompt;
      expect(prompt.images).toEqual([{ data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'), mimeType: 'image/png' }]);
      expect(prompt.text).toContain('notes.pdf');
      expect(prompt.text).toContain('not sent');
      expect(prompt.text).not.toContain(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sends context as an excerpt it says it cannot open, with no path on the Mac', async () => {
    const parsed = parseContexts([JSON.parse(readFileSync(fixture('message-context.json'), 'utf8')).records[0].raw]);
    if (!parsed.ok) throw new Error(parsed.error);
    const s = boot();
    // As runner/state.ts outgoing projects it for this thread.
    s.user(harnessText('tidy this reduce', parsed.value, { harness: 'cursor-cloud', cwd: '/tmp/omni-test' }), 'm1');
    await waitFor(() => calls('POST', '/v1/agents').length === 1, 'create');
    const text = (calls('POST', '/v1/agents')[0].body as { prompt: { text: string } }).prompt.text;
    const sent = text.slice(text.indexOf('tidy this reduce'));
    expect(sent).toContain('tidy this reduce\n\n<omni-context>');
    expect(sent).toContain('You run as a Cursor cloud agent and cannot open it; work from the excerpt.');
    expect(sent).toContain('+  return items.reduce((sum, n) => sum + n, 0);');
    expect(sent).not.toContain('relative to your working directory');
    expect(sent).not.toContain('Check:');
    expect(text).not.toContain('/tmp/omni-test');
    expect(sent).not.toMatch(/(^|[\s(])\/[A-Za-z]/m);
  });

  it('passes a picked model by id', async () => {
    const s = boot({ model: 'composer-2' });
    s.user('go', 'm1');
    await waitFor(() => results(s.records).length === 1, 'result');
    expect((calls('POST', '/v1/agents')[0].body as { model?: unknown }).model).toEqual({ id: 'composer-2' });
  });
});

describe('Cursor Cloud status mapping', () => {
  const base: CloudAgentState = { agent_id: 'bc-1', url: 'https://cursor.com/agents/bc-1', repo: 'acme/widgets', status: 'CREATING' };
  const run = (status: 'FINISHED' | 'ERROR' | 'CANCELLED' | 'EXPIRED' | 'RUNNING', extra: object = {}) => ({ id: 'run-1', agentId: 'bc-1', status, ...extra });

  it('ends each terminal status as its own result', () => {
    const end = (status: 'FINISHED' | 'ERROR' | 'CANCELLED' | 'EXPIRED') =>
      endRecords(base, run(status, { result: 'ok', durationMs: 9 })).find((r) => r.kind === 'result')!.payload;
    expect(end('FINISHED')).toEqual({ ok: true, subtype: 'success', turns: 1, duration_ms: 9 });
    expect(end('ERROR')).toMatchObject({ ok: false, subtype: 'error' });
    expect(end('CANCELLED')).toMatchObject({ ok: false, subtype: 'cancelled' });
    expect(end('EXPIRED')).toMatchObject({ ok: false, subtype: 'expired' });
    expect(endRecords(base, run('EXPIRED')).some((r) => r.kind === 'error')).toBe(true);
    expect(endRecords(base, run('CANCELLED')).some((r) => r.kind === 'error')).toBe(false);
  });

  it('takes the branch and PR pushed to the channel repo, not another one', () => {
    const s = stateOf(
      base,
      run('RUNNING', {
        git: {
          branches: [
            { repoUrl: 'github.com/acme/widgets', branch: 'cursor/fix-1a2b', prUrl: 'https://github.com/acme/widgets/pull/7' },
            { repoUrl: 'github.com/acme/other', branch: 'cursor/elsewhere', prUrl: 'https://github.com/acme/other/pull/1' },
          ],
        },
      }),
    );
    expect(s).toMatchObject({ status: 'RUNNING', run_id: 'run-1', branch: 'cursor/fix-1a2b', pr_url: 'https://github.com/acme/widgets/pull/7' });
    // A run with nothing pushed keeps what the agent pushed before.
    expect(stateOf(s, run('RUNNING'))).toMatchObject({ branch: 'cursor/fix-1a2b', pr_url: 'https://github.com/acme/widgets/pull/7' });
  });
});

describe('Cursor Cloud in the catalog', () => {
  const available = () => cursorCloudHarness({ available: true, models: [{ id: 'composer-2', label: 'Composer 2' }] }, 4);

  it('offers Cursor default first, then the listed models, with no efforts', () => {
    const h = available();
    expect(h.models.map((m) => m.id)).toEqual(['default', 'composer-2']);
    expect(h.models[0].default).toBe(true);
    expect(h.models.every((m) => m.efforts.length === 0)).toBe(true);
    expect(cursorCloudHarness({ available: false }, 4)).toMatchObject({ available: false, fix: CURSOR_CLOUD_FIX, models: [] });
  });

  it('probes the key against the models endpoint', async () => {
    const { probeCursorCloud } = await import('../harness/catalog-service.ts');
    expect(await probeCursorCloud(null, fake.url)).toEqual({ available: false });
    expect(await probeCursorCloud('k', fake.url)).toEqual({ available: true, models: [{ id: 'composer-2', label: 'Composer 2' }, { id: 'claude-4.5-sonnet', label: 'Sonnet 4.5' }] });
    expect(await probeCursorCloud('bad-key', fake.url)).toEqual({ available: false, fix: CURSOR_CLOUD_REJECTED });
    expect(await probeCursorCloud('k', 'http://127.0.0.1:9')).toEqual({ available: false, fix: CURSOR_CLOUD_UNREACHABLE });
    expect(fake.calls.every((c) => c.path === '/v1/models' && c.method === 'GET')).toBe(true);
  });

  it('is unavailable in a channel with no GitHub repo, and a channel key lifts a missing global one', () => {
    const cat: Catalog = { harnesses: [claudeHarness(4), available()] };
    const noRepo = catalogForChannel(cat, { github_repo: null }, false).harnesses.find((h) => h.id === 'cursor-cloud')!;
    expect(noRepo).toMatchObject({ available: false, fix: CURSOR_CLOUD_NO_REPO, models: [] });
    expect(catalogForChannel(cat, { github_repo: 'acme/widgets' }, false)).toBe(cat);

    const noKey: Catalog = { harnesses: [claudeHarness(4), cursorCloudHarness({ available: false }, 4)] };
    expect(catalogForChannel(noKey, { github_repo: 'acme/widgets' }, true).harnesses[1]).toMatchObject({ available: true, models: [{ id: 'default' }] });
    expect(catalogForChannel(noKey, { github_repo: 'acme/widgets' }, false).harnesses[1].available).toBe(false);
    // A rejected global key is not fixed by the channel having one too: that key may be the same bad one.
    const rejected: Catalog = { harnesses: [cursorCloudHarness({ available: false, fix: CURSOR_CLOUD_REJECTED }, 4)] };
    expect(catalogForChannel(rejected, { github_repo: 'acme/widgets' }, true).harnesses[0].available).toBe(false);
  });

  it('resolves only when chosen, and says why when it cannot run', () => {
    const cat: Catalog = { harnesses: [claudeHarness(4), available()] };
    expect(resolveRun({ harness: 'cursor-cloud' }, undefined, cat)).toEqual({ ok: true, harness: 'cursor-cloud', model: '', effort: '' });
    expect(resolveRun({ harness: 'cursor-cloud', model: 'composer-2' }, undefined, cat)).toMatchObject({ ok: true, model: 'composer-2' });
    const off = catalogForChannel(cat, { github_repo: null }, false);
    const r = resolveRun({ harness: 'cursor-cloud' }, undefined, off);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("channel's GitHub repo");
  });
});

describe('Cursor Cloud and the local Cursor harness', () => {
  it('never hands CURSOR_API_KEY to the local cursor-agent, from a secret or the shell', () => {
    const shell = { PATH: '/usr/bin', CURSOR_API_KEY: 'shell-key', CURSOR_AUTH_TOKEN: 't' } as NodeJS.ProcessEnv;
    const local = harnessEnv('cursor', {}, { CURSOR_API_KEY: 'secret-key', OTHER: 'kept' }, shell);
    expect(local.CURSOR_API_KEY).toBeUndefined();
    expect(local.CURSOR_AUTH_TOKEN).toBeUndefined();
    expect(local.OTHER).toBe('kept');
    expect(harnessEnv('cursor-cloud', {}, { CURSOR_API_KEY: 'secret-key' }, shell).CURSOR_API_KEY).toBeUndefined();
  });
});

describe('Auto and Cursor Cloud', () => {
  const PROMPTS = [
    'spin up a cursor cloud agent to fix the flaky test',
    'Rename getUser to fetchUser across every file in the repo',
    'quick: fix the typo in README.md',
    'Review PR 42 and the diff on the branch',
    'Draft an email to the client about the launch',
    'Architect a migration of the sync engine, with race conditions and a security audit, step by step',
    'generate an image of a logo',
  ];
  const everything = (): Catalog => ({
    harnesses: [
      claudeHarness(4),
      codexHarness({ available: true, models: [{ id: 'gpt-5.6', efforts: ['low', 'high'], isDefault: true }] }, 4),
      cursorHarness({ available: true, models: [{ id: 'composer-2', label: 'Composer 2', efforts: [], defaultEffort: '' }] }, 4),
      hermesHarness({ available: true }, 4),
      cursorCloudHarness({ available: true, models: [{ id: 'composer-2', label: 'Composer 2' }] }, 4),
    ],
  });

  it('never picks it, whatever the brief and however busy the plans are', () => {
    for (const claudeBusy of [false, true]) {
      const usage = claudeBusy ? { 'claude-code': { five_hour: { utilization: 0.99, resetsAt: 0 }, updated_at: '' } } : {};
      for (const prompt of PROMPTS) {
        const pick = routeTask(profileTask(prompt), { catalog: everything(), usage });
        expect(pick.harness, prompt).not.toBe('cursor-cloud');
        expect(pick.harness, prompt).not.toBe('hermes');
      }
    }
  });

  it('never picks it even when it is the only harness besides Claude Code', () => {
    const cat: Catalog = { harnesses: [claudeHarness(4), cursorCloudHarness({ available: true }, 4)] };
    for (const prompt of PROMPTS) expect(routeTask(profileTask(prompt), { catalog: cat }).harness).toBe('claude-code');
  });
});
