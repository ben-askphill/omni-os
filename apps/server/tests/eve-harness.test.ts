// eve agents as custom harnesses (harness/eve/client.ts, ADR 0018): eve's stream translated into Runs API events, the
// client against a fake eve agent (new session, follow-up, expired session, stop), a `kind: eve` file, and the adapter
// running a thread on one, keeping eve's session id as the thread's.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdapterContext, HarnessSession } from '../harness/adapter.ts';
import type { Record as StreamRecord } from '../stream.ts';
import { startRunner } from './runner-boot.ts';
import { startFakeEve, type FakeEve } from './fake-eve.ts';
import { waitFor } from './support.ts';

await startRunner({ HOME: mkdtempSync(join(tmpdir(), 'omni-eve-home-')) });
const { paths } = await import('../config.ts');
const { EveClient, EVE_SESSION_PREFIX, translateEveEvent } = await import('../harness/eve/client.ts');
const { customHarness, parseHarnessFile } = await import('../harness/custom.ts');
const { hermesAdapter } = await import('../harness/hermes/adapter.ts');

let fake: FakeEve;
const sessions: HarnessSession[] = [];

beforeAll(async () => {
  fake = await startFakeEve();
  mkdirSync(paths.harnesses, { recursive: true });
  writeFileSync(join(paths.harnesses, 'nomos.yaml'), `name: Nomos\nkind: eve\nurl: ${fake.url}\nauth:\n  scheme: bearer\n  secret: AGENT_NOMOS_KEY\n`);
});
beforeEach(() => fake.reset());
afterEach(() => {
  for (const s of sessions) s.end('kill');
  sessions.length = 0;
});
afterAll(async () => {
  await fake.close();
});

const ev = (type: string, data: Record<string, unknown> = {}) => ({ type, data });
const fresh = () => ({ started: false, calls: new Map(), output: '', model: '', usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }, ended: null });

async function drain(it: AsyncGenerator<unknown>) {
  const out: Record<string, unknown>[] = [];
  for await (const e of it) out.push(e as Record<string, unknown>);
  return out;
}

describe("translating eve's stream", () => {
  it('skips what came before its own turn started: a stop that settled late belongs to the turn before', () => {
    const t = fresh();
    expect(translateEveEvent(t, ev('turn.cancelled', { turnId: 'old' }))).toEqual([]);
    expect(translateEveEvent(t, ev('session.waiting'))).toEqual([]);
    expect(translateEveEvent(t, ev('turn.started', { turnId: 'new' }))).toEqual([{ event: 'run.started' }]);
    expect(t.ended).toBeNull();
  });

  it('turns tool calls, subagents, text and usage into Runs API events, with the last finished text as the output', () => {
    const t = fresh();
    translateEveEvent(t, ev('turn.started'));
    translateEveEvent(t, ev('step.started', { modelId: 'anthropic/claude-opus-5-5' }));
    expect(translateEveEvent(t, ev('message.completed', { message: 'Checking.', finishReason: 'tool-calls' }))).toEqual([{ event: 'message.interim', text: 'Checking.' }]);
    expect(
      translateEveEvent(
        t,
        ev('actions.requested', {
          actions: [
            { kind: 'tool-call', callId: 'a', toolName: 'shopify_admin_graphql', input: { query: '{ shop { name } }' } },
            { kind: 'subagent-call', callId: 'b', subagentName: 'researcher', name: 'researcher', description: 'Look it up', nodeId: 'n', input: {} },
          ],
        }),
      ),
    ).toEqual([
      { event: 'tool.started', tool: 'shopify_admin_graphql', preview: '{"query":"{ shop { name } }"}' },
      { event: 'subagent.start', name: 'researcher', task: 'Look it up' },
    ]);
    expect(translateEveEvent(t, ev('action.result', { status: 'failed', error: { message: 'denied' }, result: { kind: 'tool-result', callId: 'a', output: null } }))).toEqual([{ event: 'tool.failed', tool: 'shopify_admin_graphql', error: 'denied' }]);
    expect(translateEveEvent(t, ev('action.result', { status: 'completed', result: { kind: 'subagent-result', callId: 'b', output: 'found it' } }))).toEqual([{ event: 'subagent.complete', summary: 'found it', status: 'completed' }]);
    translateEveEvent(t, ev('message.appended', { messageDelta: 'Done.' }));
    translateEveEvent(t, ev('message.completed', { message: 'Done.', finishReason: 'stop' }));
    translateEveEvent(t, ev('step.completed', { usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 2 } }));
    translateEveEvent(t, ev('step.completed', { usage: { inputTokens: 5, outputTokens: 1 } }));
    expect(translateEveEvent(t, ev('turn.completed'))).toEqual([
      { event: 'run.completed', output: 'Done.', usage: { input_tokens: 15, output_tokens: 4, cache_read_tokens: 2, cache_write_tokens: 0 }, runtime: { model: 'anthropic/claude-opus-5-5' } },
    ]);
    // Nothing after the end counts.
    expect(translateEveEvent(t, ev('turn.failed', { message: 'late' }))).toEqual([]);
  });

  it("says where to answer an approval Omni cannot answer, and ends a turn that parked for it at session.waiting", () => {
    const t = fresh();
    translateEveEvent(t, ev('turn.started'));
    const [req] = translateEveEvent(t, ev('input.requested', { requests: [{ kind: 'approval', prompt: 'Post to #general?', action: { toolName: 'slack_post_message' } }] }));
    expect(req).toMatchObject({ event: 'approval.request', tool: 'slack_post_message' });
    expect(String(req.preview)).toMatch(/Post to #general\?.*agent's own chat/);
    expect(translateEveEvent(t, ev('session.waiting'))[0]).toMatchObject({ event: 'run.completed' });
  });

  it('fails and cancels on the turn events', () => {
    const failed = fresh();
    translateEveEvent(failed, ev('turn.started'));
    expect(translateEveEvent(failed, ev('turn.failed', { message: 'Model error' }))).toEqual([{ event: 'run.failed', error: 'Model error' }]);
    const cancelled = fresh();
    translateEveEvent(cancelled, ev('turn.started'));
    expect(translateEveEvent(cancelled, ev('turn.cancelled'))).toEqual([{ event: 'run.cancelled' }]);
  });
});

describe('the eve client', () => {
  it("starts a session with Omni's prompt as client context, then follows up on it, reading only the new turn", async () => {
    const api = new EveClient(fake.url, fake.key);
    const first = await api.createRun({ input: 'hello', session_id: 'omni-tid', instructions: 'SYS' }, 'm1');
    expect(first.session_id).toMatch(new RegExp(`^${EVE_SESSION_PREFIX}wrun_`));
    const create = fake.calls.find((c) => c.method === 'POST' && c.path === '/eve/v1/session');
    expect(create?.body).toEqual({ message: 'hello', operationId: 'm1', clientContext: 'SYS' });
    expect(create?.authorization).toBe(`Bearer ${fake.key}`);
    const one = await drain(api.events(first.run_id, AbortSignal.timeout(5000)));
    expect(one.map((e) => e.event)).toEqual(['run.started', 'tool.started', 'tool.completed', 'message.delta', 'message.delta', 'message.interim', 'run.completed']);
    expect(one.at(-1)).toMatchObject({ output: 'You have two reminders.', usage: { input_tokens: 40, output_tokens: 9 }, runtime: { model: 'deepseek/deepseek-v4-pro' } });
    // seq only grows, so a reconnect's replay is skipped by the adapter.
    const seqs = one.map((e) => e.seq as number);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);

    const second = await api.createRun({ input: 'again', session_id: first.session_id! }, 'm2');
    expect(second.session_id).toBe(first.session_id);
    const follow = fake.calls.filter((c) => c.method === 'POST' && c.path.startsWith('/eve/v1/session/') && !c.path.endsWith('/cancel'));
    expect(follow.at(-1)?.body).toEqual({ message: 'again', turnPolicy: 'queue' });
    const two = await drain(api.events(second.run_id, AbortSignal.timeout(5000)));
    expect(two.filter((e) => e.event === 'run.started')).toHaveLength(1);
    expect(two.at(-1)).toMatchObject({ event: 'run.completed', output: 'You have two reminders.' });
    expect(await api.getRun(second.run_id)).toMatchObject({ status: 'completed', output: 'You have two reminders.' });
  });

  it('starts a new session when the old one is gone, as eve never revives one', async () => {
    const api = new EveClient(fake.url, fake.key);
    const r = await api.createRun({ input: 'hi', session_id: `${EVE_SESSION_PREFIX}wrun_gone` }, 'm3');
    expect(r.session_id).not.toBe(`${EVE_SESSION_PREFIX}wrun_gone`);
    expect(fake.calls.some((c) => c.method === 'POST' && c.path === '/eve/v1/session')).toBe(true);
  });

  it('stops a turn with cancel, and the run ends cancelled', async () => {
    const api = new EveClient(fake.url, fake.key);
    fake.hangNext = true;
    const r = await api.createRun({ input: 'long', session_id: 'omni-x' }, 'm4');
    const events = drain(api.events(r.run_id, AbortSignal.timeout(5000)));
    await waitFor(() => [...fake.sessions.values()].some((s) => s.hanging), 'turn hanging');
    await api.stop(r.run_id);
    expect((await events).at(-1)).toMatchObject({ event: 'run.cancelled' });
  });
});

describe('a kind: eve harness file', () => {
  it('runs as eve, with steering off: a message sent mid-turn waits for the next one', () => {
    const h = customHarness('custom:nomos');
    expect(h).toMatchObject({ kind: 'eve' });
    expect(h!.error).toBeUndefined();
    expect(h!.capabilities).toMatchObject({ steer: false, interrupt: true, remote: true });
    expect(parseHarnessFile('x', 'name: X\nkind: eve\nurl: https://x.example.com\nauth:\n  secret: X_KEY\ncapabilities:\n  steer: true\n').capabilities.steer).toBe(false);
    expect(parseHarnessFile('x', 'name: X\nkind: a2a\nurl: https://x.example.com\nauth:\n  secret: X_KEY\n').error).toMatch(/runs-api, eve/);
  });
});

describe('the adapter on an eve harness', () => {
  function boot(sessionId = 'tid') {
    const records: StreamRecord[] = [];
    let session: string | null = null;
    const ctx = {
      thread: { id: 'tid', channel_id: 'scratch', title: 't', status: 'running', role: null, model: 'default', harness: 'custom:nomos', effort: '', session_id: sessionId, has_run: 0, cwd: '/tmp', branch: null, parent_id: null, task_id: null, source: 'manual', automation: null, last_text: null, created_at: '', updated_at: '' },
      channel: { id: 'scratch', name: 'Scratch', kind: 'internal', repo_path: null, github_repo: null, use_worktree: 0, base_dir: null, store_domain: null, portal_slug: null, browser_headless: 1, notes: null, archived: 0, created_at: '' },
      systemPrompt: 'SYS PROMPT',
      mcpFile: null,
      secretEnv: {},
      harnessKey: fake.key,
      browserBusy: false,
      omniUrl: 'http://127.0.0.1:9',
      resume: false,
    } as unknown as AdapterContext;
    const handle = hermesAdapter.spawn(ctx, {
      record: (r) => records.push(r),
      usage: () => {},
      session: (id) => {
        session = id;
      },
      exit: () => {},
    });
    sessions.push(handle);
    return { records, session: () => session, send: (text: string, uuid: string) => handle.send({ uuid, text, attachments: [], commands: [] }) };
  }
  const results = (r: StreamRecord[]) => r.filter((x) => x.kind === 'result');

  it("keeps eve's session id as the thread's and continues it on the next turn", async () => {
    const s = boot();
    s.send('hello', 'u1');
    await waitFor(() => results(s.records).length === 1, 'first result');
    expect(s.session()).toMatch(new RegExp(`^${EVE_SESSION_PREFIX}wrun_`));
    expect(s.records.find((r) => r.kind === 'tool_use')?.payload).toMatchObject({ name: 'list_reminders' });
    expect(s.records.filter((r) => r.kind === 'assistant_text').map((r) => r.payload)).toEqual([{ text: 'You have two reminders.' }]);
    expect(results(s.records)[0].payload).toMatchObject({ ok: true, model: 'deepseek/deepseek-v4-pro', input_tokens: 40, output_tokens: 9 });
    expect(fake.calls.find((c) => c.path === '/eve/v1/session')?.body).toMatchObject({ clientContext: 'SYS PROMPT' });

    s.send('again', 'u2');
    await waitFor(() => results(s.records).length === 2, 'second result');
    expect(fake.calls.filter((c) => c.method === 'POST' && c.path === '/eve/v1/session')).toHaveLength(1);
    expect(fake.sessions.size).toBe(1);
  });
});
