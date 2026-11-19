// Custom harnesses end to end: two registered through the API, each on its own fake Runs API server with its own key,
// a crew role bound to each by id, a thread on each, the keys kept out of every local harness's environment, and a
// thread on a harness that is gone or unknown refused instead of run on Claude Code.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { startFakeHermes, type FakeHermes } from './fake-hermes.ts';

// A stand-in for `security`: a secret reads as the file named after its account (scope/name), else it is not found.
// Writes succeed and store nothing. The values are test doubles, never real keys.
const SECURITY = `#!/bin/sh
if [ "$1" = "find-generic-password" ]; then
  f="$FAKE_SECURITY_DIR/$(printf '%s' "$5" | tr '/:' '__')"
  if [ -f "$f" ]; then cat "$f"; exit 0; fi
  exit 44
fi
exit 0
`;

const WATCHED = ['HERMES_API_KEY', 'AGENT_A_KEY', 'AGENT_B_KEY', 'PLAIN_SECRET'];

let fakeA: FakeHermes;
let fakeB: FakeHermes;
let bin: string;
let store: string;
let H: Awaited<ReturnType<typeof startRunner>>;
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
const savedPath = process.env.PATH;

/** A secret as Settings > Secrets leaves it: a row with its name and a value in the store. */
function secret(scope: string, name: string, value: string) {
  writeFileSync(join(store, `${scope}/${name}`.replace(/[/:]/g, '_')), value);
  H.db.db.prepare(`INSERT INTO secrets (scope, name) VALUES (?, ?) ON CONFLICT(scope, name) DO NOTHING`).run(scope, name);
}

const json = (method: string, body?: unknown) => ({ method, headers: { 'content-type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
const runsOn = (fake: FakeHermes) => fake.calls.filter((c) => c.method === 'POST' && c.path === '/v1/runs');

beforeAll(async () => {
  fakeA = await startFakeHermes('key-a');
  fakeB = await startFakeHermes('key-b');
  bin = mkdtempSync(join(tmpdir(), 'omni-security-'));
  store = mkdtempSync(join(tmpdir(), 'omni-secrets-'));
  writeFileSync(join(bin, 'security'), SECURITY, { mode: 0o755 });
  H = await startRunner({
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    FAKE_SECURITY_DIR: store,
    FAKE_CLAUDE_WATCH_ENV: WATCHED.join(','),
  });
  ({ app } = await import('../app.ts'));
  secret('global', 'AGENT_A_KEY', 'key-a');
  secret('global', 'AGENT_B_KEY', 'key-b');
  secret('global', 'HERMES_API_KEY', 'hermes-key');
  secret('global', 'PLAIN_SECRET', 'plain-value');
  mkdirSync(join(H.tmp, 'agents'));
  H.db.channels.create({ id: 'agents', name: 'Agents', kind: 'internal', use_worktree: 0, base_dir: join(H.tmp, 'agents') });
});

afterAll(() => {
  process.env.PATH = savedPath;
  for (const dir of [bin, store]) if (dir) rmSync(dir, { recursive: true, force: true });
  return Promise.all([fakeA?.close(), fakeB?.close()]);
});

describe('custom harnesses through the API and the runner', () => {
  it('registers two harnesses, each checked against its own server with its own key', async () => {
    const a = await app.request('/api/harnesses/custom/agent-a', json('POST', { name: 'Agent A', url: fakeA.url, secret: 'AGENT_A_KEY', bills: 'Bills server A' }));
    expect(a.status).toBe(201);
    expect(await a.json()).toMatchObject({ id: 'custom:agent-a', catalog: { available: true, remote: { custom: true, secret: 'AGENT_A_KEY' } } });
    const b = await app.request('/api/harnesses/custom/agent-b', json('POST', { name: 'Agent B', url: fakeB.url, secret: 'AGENT_B_KEY', capabilities: { steer: false } }));
    expect(b.status).toBe(201);
    expect(await b.json()).toMatchObject({ id: 'custom:agent-b', capabilities: { steer: false, interrupt: true }, catalog: { available: true } });
    // Each probe carried its own key, to its own server only.
    expect(fakeA.calls.filter((c) => c.path === '/v1/capabilities').map((c) => c.authorization)).toEqual(['Bearer key-a']);
    expect(fakeB.calls.filter((c) => c.path === '/v1/capabilities').map((c) => c.authorization)).toEqual(['Bearer key-b']);

    const listed = (await (await app.request('/api/harnesses')).json()) as { id: string; available: boolean; models: { id: string }[] }[];
    expect(listed.filter((h) => h.id.startsWith('custom:')).map((h) => [h.id, h.available, h.models.map((m) => m.id)])).toEqual([
      ['custom:agent-a', true, ['default']],
      ['custom:agent-b', true, ['default']],
    ]);
    expect(H.runner.slotsByHarness()['custom:agent-a']?.cap).toBe(12);
  });

  it('runs a role bound to each harness on that harness, with its key as a header and no other secret', async () => {
    for (const [id, harness] of [['remote-a', 'custom:agent-a'], ['remote-b', 'custom:agent-b']]) {
      const res = await app.request('/api/crew', json('POST', { id, fields: { name: id, harness, model: 'default' }, charter: `You are ${id}.` }));
      expect(res.status).toBe(201);
    }
    const ta = await H.runner.createThread({ channel: 'agents', prompt: 'hello A', role: 'remote-a' });
    const tb = await H.runner.createThread({ channel: 'agents', prompt: 'hello B', role: 'remote-b' });
    expect([ta.harness, tb.harness]).toEqual(['custom:agent-a', 'custom:agent-b']);
    expect(ta.branch).toBeNull();
    await H.untilResults(ta.id, 1);
    await H.untilResults(tb.id, 1);
    expect(H.thread(ta.id).status).toBe('done');
    expect(H.thread(tb.id).status).toBe('done');

    const [runA] = runsOn(fakeA);
    const [runB] = runsOn(fakeB);
    expect(runsOn(fakeA)).toHaveLength(1);
    expect(runsOn(fakeB)).toHaveLength(1);
    expect(runA).toMatchObject({ authorization: 'Bearer key-a', body: { input: 'hello A', session_id: `omni-${ta.id}` } });
    expect(runB).toMatchObject({ authorization: 'Bearer key-b', body: { input: 'hello B', session_id: `omni-${tb.id}` } });
    // The prompt names the harness, and no secret value or name goes to a server Omni does not control (E9).
    const instructions = (runA.body as { instructions: string }).instructions;
    expect(instructions).toContain('You are Agent A, running on your own server');
    expect(instructions).toContain('You are remote-a.');
    const sent = JSON.stringify([...fakeA.calls, ...fakeB.calls]);
    for (const leak of ['plain-value', 'PLAIN_SECRET', 'hermes-key', 'key-b']) expect(JSON.stringify(fakeA.calls)).not.toContain(leak);
    expect(sent).not.toContain('plain-value');
    // Nothing ran on this machine for either thread.
    expect(H.invocations().filter((i) => i.thread_id === ta.id || i.thread_id === tb.id)).toEqual([]);
  });

  it('keeps every remote harness key out of a local harness, while other secrets still reach it', async () => {
    const t = await H.start('local work', { harness: 'claude-code' });
    await H.untilResults(t.id, 1);
    const local = H.invocations().filter((i) => i.thread_id === t.id);
    expect(local.length).toBeGreaterThan(0);
    for (const i of local) expect(i.watched_env).toEqual(['PLAIN_SECRET']);
    const { namedSecrets, secretsEnv } = await import('../secrets.ts');
    const env = await secretsEnv('agents');
    expect(Object.keys(env).filter((k) => WATCHED.includes(k))).toEqual(['PLAIN_SECRET']);
    expect((await namedSecrets('agents', ['AGENT_A_KEY', 'HERMES_API_KEY', 'PLAIN_SECRET'])).missing).toEqual(['AGENT_A_KEY', 'HERMES_API_KEY']);
  });

  it('refuses the delegate-only conductor on a custom harness before it makes a thread', async () => {
    const before = H.db.threads.list({}).length;
    await expect(H.runner.createThread({ channel: 'agents', prompt: 'route this', role: 'conductor', harness: 'custom:agent-a', model: 'default' })).rejects.toThrow(
      /Conductor only routes work.*on Agent A's own server/,
    );
    expect(H.db.threads.list({}).length).toBe(before);
  });

  it('refuses a thread whose custom harness was removed, and never runs it on Claude Code', async () => {
    const tb = H.db.threads.list({}).find((t) => t.harness === 'custom:agent-b')!;
    const del = await app.request('/api/harnesses/custom/agent-b', { method: 'DELETE' });
    expect(del.status).toBe(200);
    const listed = (await (await app.request('/api/harnesses')).json()) as { id: string }[];
    expect(listed.map((h) => h.id)).not.toContain('custom:agent-b');
    await expect(H.runner.createThread({ channel: 'agents', prompt: 'x', harness: 'custom:agent-b' })).rejects.toThrow(/Unknown harness "custom:agent-b"/);

    const before = runsOn(fakeB).length;
    H.runner.sendMessage(tb.id, 'still there?');
    await H.until('the refusal', () => H.texts(tb.id, 'error').some((t) => /custom:agent-b, which is not set up on this machine/.test(t)));
    expect(runsOn(fakeB).length).toBe(before);
    expect(H.invocations().filter((i) => i.thread_id === tb.id)).toEqual([]);
  });

  it('refuses a thread on a harness id no build knows, and never runs it on Claude Code', async () => {
    const id = 'unknown-harness-thread';
    H.db.threads.create({ id, channel_id: 'agents', title: 'odd', status: 'done', role: null, model: null, harness: 'gemini-cli', cwd: join(H.tmp, 'agents'), branch: null, parent_id: null, task_id: null, source: 'manual', automation: null, session_id: id } as never);
    H.runner.sendMessage(id, 'run anyway');
    await H.until('the refusal', () => H.texts(id, 'error').some((t) => /"gemini-cli", a harness this version of Omni does not have/.test(t)));
    await H.untilStatus(id, 'failed');
    expect(H.invocations().filter((i) => i.thread_id === id)).toEqual([]);
  });
});
