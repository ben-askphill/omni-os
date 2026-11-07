import { afterAll, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, join } from 'node:path';
import { secretResultText, secretSavedMessage, type SecretAsk } from '@omni/shared/secret-request.ts';
import { startRunner } from './runner-boot.ts';
import { sleep } from './support.ts';

// request_secret (apps/mcp/ask.ts, apps/server/runner/secret-requests.ts) through the real runner, the fake claude CLI
// and the file secret store. The server listens on a real port, so the fake's SECRET directive starts the omni-ask MCP
// server from the thread's mcp.json and that server polls the API exactly as it does under Claude Code. After each
// flow, the one fact that matters most: the value Ben typed is in the secret store and nowhere else Omni writes.

const h = await startRunner({ OMNI_SECRET_STORE: 'file' });
const { app } = await import('../app.ts');
const { serve } = await import('@hono/node-server');
const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
await once(server, 'listening');
const { about } = await import('../about.ts');
about.port = (server.address() as AddressInfo).port;
// A waiting call's long poll holds a connection open, which close() alone would wait for.
afterAll(() => {
  server.close();
  server.closeAllConnections();
});
const T = { timeout: 30_000 };
// The card waits on the omni-ask server starting (tsx compiles it), which a loaded machine can take a while over.
const E2E = { timeout: 60_000 };

const VALUE = 'dummy-secret-value-0123456789';
const ASK: SecretAsk = { name: 'STRIPE_TEST_KEY', label: 'Stripe test secret key', scope: 'channel', reason: 'To run the checkout tests' };
const named = (name: string): SecretAsk => ({ ...ASK, name });
const Q = {
  question: 'Which market goes first?',
  options: [
    { label: 'NL', description: 'Home market.' },
    { label: 'DE', description: 'Bigger.' },
  ],
  multiSelect: false,
};

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const ok = async (method: string, path: string, body?: unknown) => {
  const res = await call(method, path, body);
  if (res.status !== 200) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};

const ask = (id: string, body: unknown = ASK) => ok('POST', `/threads/${id}/secret-requests`, body).then((r) => r.id as string);
const poll = (id: string, rid: string, wait = 0) => ok('GET', `/threads/${id}/secret-requests/${rid}?wait=${wait}`);
const submit = (id: string, rid: string, body: unknown) => call('POST', `/threads/${id}/secret-requests/${rid}/submit`, body);
const cancel = (id: string, rid: string) => call('POST', `/threads/${id}/secret-requests/${rid}/cancel`);
const blockers = async (id: string) =>
  (((await ok('GET', '/needs-you')).items as any[]).find((i) => i.thread.id === id)?.blockers ?? []).filter((b: any) => b.kind === 'question');
const answerEvents = (id: string) => h.byKind(id, 'secret_request_answer').map((e) => e.p);
const requested = (id: string) => h.until('the secret card', () => h.byKind(id, 'secret_request')[0], 25_000);
const tool = (id: string) => h.byKind(id, 'tool_use').find((e) => e.p.name === 'mcp__omni-ask__request_secret');
const resultOf = (id: string, use: { id: number; p: { id: string } }) => h.byKind(id, 'tool_result').find((e) => e.p.tool_use_id === use.p.id && e.id > use.id);
/** What the fake's Bash calls answered, in order: its HASENV and PRINTENV directives. */
const bashResults = (id: string) => h.byKind(id, 'tool_use').filter((e) => e.p.name === 'Bash').map((u) => resultOf(id, u)?.p.text as string);
const store = () => JSON.parse(readFileSync(join(h.paths.data, 'secrets.json'), 'utf8')) as Record<string, string>;
const listed = async () => ((await ok('GET', '/secrets')) as { scope: string; name: string }[]).map((s) => `${s.scope}/${s.name}`);
const idle = async (prompt = 'plan the quarter') => {
  const t = await h.start(prompt);
  await h.untilResults(t.id, 1);
  return t.id;
};
const busy = async (prompt = 'TOOL:5000 audit the checkout') => {
  const t = await h.start(prompt);
  await h.untilTool(t.id);
  return t.id;
};

/**
 * Where the value shows up in what Omni persisted: every row of every table (the FTS index and its shadow tables
 * included), and every file under the data dir other than the secret store itself. Empty when it is only in the store.
 */
function leaks(value = VALUE): string[] {
  const out: string[] = [];
  const conn = h.db.db;
  const blobs = (_k: string, v: unknown) => (v instanceof Uint8Array ? Buffer.from(v).toString('latin1') : v);
  for (const { name } of conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]) {
    if (JSON.stringify(conn.prepare(`SELECT * FROM "${name}"`).all(), blobs).includes(value)) out.push(`table ${name}`);
  }
  for (const entry of readdirSync(h.paths.data, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || basename(entry.name) === 'secrets.json') continue;
    const file = join(entry.parentPath, entry.name);
    if (readFileSync(file, 'latin1').includes(value)) out.push(file);
  }
  return out;
}

describe('asking', () => {
  it('refuses a request it cannot fulfil, with what the agent should fix', T, async () => {
    const id = await idle();
    const refused = async (body: unknown) => {
      const res = await call('POST', `/threads/${id}/secret-requests`, body);
      expect(res.status).toBe(400);
      return res.body.error as string;
    };
    expect(await refused({})).toBe('name must be an UPPER_SNAKE_CASE env var name, like STRIPE_TEST_KEY');
    expect(await refused(named('PATH'))).toBe('PATH is reserved for Omni or the shell: pick a name for the service, like STRIPE_TEST_KEY');
    const own = (name: string) => `${name} is one of Omni's own secrets, which no thread gets: pick a name for the service, like STRIPE_TEST_KEY`;
    expect(await refused(named('GROKBOT_WEBHOOK_URL'))).toBe(own('GROKBOT_WEBHOOK_URL'));
    expect(await refused({ ...named('SUPABASE_URL'), scope: 'global' })).toBe(own('SUPABASE_URL'));
    expect(await refused(named('ANTHROPIC_API_KEY'))).toBe(
      'ANTHROPIC_API_KEY would put claude on API billing, so Omni keeps it out of every claude thread: pick another name',
    );
    expect(h.byKind(id, 'secret_request')).toEqual([]);
    expect((await call('POST', '/threads/nope/secret-requests', ASK)).status).toBe(404);
  });

  it('puts the card in the thread and in Needs you, next to its questions, even while the thread runs', T, async () => {
    const id = await busy();
    await ok('POST', `/threads/${id}/questions`, { questions: [Q] });
    const rid = await ask(id);
    expect(h.byKind(id, 'secret_request').map((e) => e.p)).toEqual([{ id: rid, ask: ASK, exists: false }]);
    expect(h.thread(id).status).toBe('running');
    expect(await blockers(id)).toEqual([{ kind: 'question', detail: 'Stripe test secret key', count: 2 }]);
    expect(await poll(id, rid)).toEqual({ state: 'pending', text: 'The user has not entered STRIPE_TEST_KEY yet.' });
    expect((await call('GET', `/threads/${id}/secret-requests/nope`)).status).toBe(404);
  });
});

describe('entering it', () => {
  it('refuses a value the store cannot take, and never echoes what was sent', T, async () => {
    const id = await busy();
    const rid = await ask(id, named('MAILCHIMP_KEY'));
    expect(await submit(id, rid, {})).toEqual({ status: 400, body: { error: 'Enter the value.' } });
    expect(await submit(id, rid, { value: 'two\nlines' })).toEqual({ status: 400, body: { error: 'The value must be one line.' } });
    const broken = await app.request(`/api/threads/${id}/secret-requests/${rid}/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json {{' });
    expect([broken.status, await broken.json()]).toEqual([400, { error: 'Enter the value.' }]);
    expect(await poll(id, rid)).toMatchObject({ state: 'pending' });
    expect(answerEvents(id)).toEqual([]);
  });

  it('keeps a secret that is already set unless the card says to replace it', T, async () => {
    const name = 'SENDGRID_API_KEY';
    const OLD = 'old-dummy-value-9876543210';
    const NEW = 'new-dummy-value-5555555555';
    await ok('POST', '/secrets', { scope: 'channel:scratch', name, value: OLD });
    const id = await idle();
    const rid = await ask(id, named(name));
    expect(h.byKind(id, 'secret_request')[0].p.exists).toBe(true);
    expect(await submit(id, rid, { value: NEW })).toEqual({ status: 409, body: { error: 'A secret of that name is already set for this scope.', exists: true } });
    expect(store()[`channel:scratch/${name}`]).toBe(OLD);
    expect(await poll(id, rid)).toMatchObject({ state: 'pending' });

    expect(await submit(id, rid, { value: NEW, replace: true })).toEqual({ status: 200, body: { state: 'saved', replaced: true, via: 'message' } });
    expect(store()[`channel:scratch/${name}`]).toBe(NEW);
    expect(answerEvents(id)).toEqual([{ id: rid, state: 'saved', replaced: true, via: 'message' }]);
    await h.untilResults(id, 2);
    expect(h.texts(id, 'user')).toEqual(['plan the quarter', secretSavedMessage(named(name))]);
    expect(h.spawns(id)).toHaveLength(2);
    expect((await submit(id, rid, { value: NEW, replace: true })).status).toBe(409);
    expect(leaks(NEW)).toEqual([]);
  });

  it('lets one of two submits at once write the value, and refuses the other', T, async () => {
    const id = await busy();
    const rid = await ask(id, named('POSTMARK_TOKEN'));
    const values = ['first-dummy-value-1111', 'second-dummy-value-2222'];
    const [a, b] = await Promise.all(values.map((value) => submit(id, rid, { value })));
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(store()['channel:scratch/POSTMARK_TOKEN']).toBe(values[a.status === 200 ? 0 : 1]);
    expect(answerEvents(id)).toHaveLength(1);
  });

  it('cancels: the waiting call hears it at once, nothing is stored, and the request is closed', T, async () => {
    const id = await busy();
    const rid = await ask(id, named('NOTION_TOKEN'));
    await poll(id, rid);
    const waiting = poll(id, rid, 20);
    expect(await cancel(id, rid)).toEqual({ status: 200, body: { state: 'cancelled', via: 'tool' } });
    expect(await waiting).toEqual({ state: 'cancelled', text: 'The user cancelled the request for NOTION_TOKEN. Go on without it and say what you could not do.' });
    expect(await listed()).not.toContain('channel:scratch/NOTION_TOKEN');
    expect(store()['channel:scratch/NOTION_TOKEN']).toBeUndefined();
    expect(await blockers(id)).toEqual([]);
    expect(await submit(id, rid, { value: VALUE })).toEqual({ status: 409, body: { error: 'This request was already settled.', state: 'cancelled' } });
    expect((await cancel(id, rid)).status).toBe(409);
    await h.untilResults(id, 1);
    expect(h.texts(id, 'user')).toEqual(['TOOL:5000 audit the checkout']);
  });
});

describe('request_secret from the agent', () => {
  it('saves the value to the store, tells the waiting call, and runs the next turn in a process that has it', E2E, async () => {
    const t = await h.start('SECRET HASENV:STRIPE_TEST_KEY run the checkout tests');
    const req = await requested(t.id);
    expect(tool(t.id)?.p.input).toEqual(ASK);
    expect(req.p).toEqual({ id: req.p.id, ask: ASK, exists: false });
    expect(bashResults(t.id)).toEqual(['STRIPE_TEST_KEY is not set']);
    expect(await blockers(t.id)).toEqual([{ kind: 'question', detail: 'Stripe test secret key', count: 1 }]);
    expect(h.thread(t.id).status).toBe('running');

    await sleep(1000);
    expect(await submit(t.id, req.p.id, { value: VALUE })).toEqual({ status: 200, body: { state: 'saved', replaced: false, via: 'tool' } });
    expect(store()['channel:scratch/STRIPE_TEST_KEY']).toBe(VALUE);
    expect(await listed()).toContain('channel:scratch/STRIPE_TEST_KEY');

    await h.untilResults(t.id, 2);
    expect(resultOf(t.id, tool(t.id)!)?.p).toMatchObject({ text: secretResultText(ASK, 'saved'), is_error: false });
    expect(answerEvents(t.id)).toEqual([{ id: req.p.id, state: 'saved', replaced: false, via: 'tool' }]);
    expect(h.texts(t.id, 'user')).toEqual(['SECRET HASENV:STRIPE_TEST_KEY run the checkout tests', secretSavedMessage(ASK)]);
    expect(h.spawns(t.id)).toHaveLength(2);
    expect(h.statuses(t.id)).toContain('queued');
    expect(await blockers(t.id)).toEqual([]);
    expect(h.thread(t.id).status).toBe('done');

    await ok('POST', `/threads/${t.id}/messages`, { prompt: 'HASENV:STRIPE_TEST_KEY PRINTENV:STRIPE_TEST_KEY check it', mode: 'steer' });
    await h.untilResults(t.id, 3);
    expect(h.spawns(t.id)).toHaveLength(2);
    expect(bashResults(t.id)).toEqual(['STRIPE_TEST_KEY is not set', 'STRIPE_TEST_KEY is set', '[secret STRIPE_TEST_KEY]']);

    expect(leaks()).toEqual([]);
    const shown = [await poll(t.id, req.p.id), await ok('GET', `/threads/${t.id}`), await ok('GET', `/threads/${t.id}/history`), await ok('GET', '/needs-you')];
    expect(JSON.stringify(shown)).not.toContain(VALUE);
    expect(await ok('GET', `/search?q=${encodeURIComponent(VALUE)}`)).toEqual([]);
  });

  it('hands a refused request back to the agent as a tool error, and the turn goes on', E2E, async () => {
    const t = await h.start('SECRET:PATH set the path');
    await h.untilResults(t.id, 1);
    expect(resultOf(t.id, tool(t.id)!)?.p).toMatchObject({
      is_error: true,
      text: 'PATH is reserved for Omni or the shell: pick a name for the service, like STRIPE_TEST_KEY',
    });
    expect(h.byKind(t.id, 'secret_request')).toEqual([]);
    expect(h.thread(t.id).status).toBe('done');
  });

  it('closes the card when Ben writes instead: the call returns, and the agent reads his message', E2E, async () => {
    const t = await h.start('SECRET:SLACK_TOKEN post the summary');
    const req = await requested(t.id);
    await ok('POST', `/threads/${t.id}/messages`, { prompt: 'never mind, skip slack', mode: 'steer' });
    await h.untilResults(t.id, 1);
    const dismissed = 'The user did not enter SLACK_TOKEN. Read their latest message in the thread and go on from there.';
    expect(resultOf(t.id, tool(t.id)!)?.p.text).toBe(dismissed);
    expect(h.texts(t.id, 'assistant_text').at(-1)).toBe(`ack: SECRET:SLACK_TOKEN post the summary | never mind, skip slack | ${dismissed}`);
    expect(answerEvents(t.id)).toEqual([{ id: req.p.id, state: 'dismissed', replaced: false, via: 'tool' }]);
    expect(h.spawns(t.id)).toHaveLength(1);
    expect((await submit(t.id, req.p.id, { value: VALUE })).body).toMatchObject({ state: 'dismissed' });
    expect(await listed()).not.toContain('channel:scratch/SLACK_TOKEN');
  });

  it('keeps the request after Stop, and the saved secret then wakes the thread as a message, in a process that has it', E2E, async () => {
    const t = await h.start('SECRET:TWILIO_AUTH_TOKEN send the sms');
    const req = await requested(t.id);
    await ok('POST', `/threads/${t.id}/stop`);
    await h.untilStatus(t.id, 'stopped');
    expect(await blockers(t.id)).toEqual([{ kind: 'question', detail: 'Stripe test secret key', count: 1 }]);
    expect((await submit(t.id, req.p.id, { value: VALUE })).body).toEqual({ state: 'saved', replaced: false, via: 'message' });
    await h.untilResults(t.id, 2);
    expect(h.texts(t.id, 'user')).toEqual(['SECRET:TWILIO_AUTH_TOKEN send the sms', secretSavedMessage(named('TWILIO_AUTH_TOKEN'))]);
    await ok('POST', `/threads/${t.id}/messages`, { prompt: 'HASENV:TWILIO_AUTH_TOKEN', mode: 'steer' });
    await h.untilResults(t.id, 3);
    expect(bashResults(t.id).at(-1)).toBe('TWILIO_AUTH_TOKEN is set');
    expect(h.thread(t.id).status).toBe('done');
    expect(leaks()).toEqual([]);
  });

  it("shows a delegated thread's request on the thread above it, and reports to it only once the secret is in use", E2E, async () => {
    const parent = await idle('be the conductor');
    const child = await h.start('SECRET:MAILGUN_KEY send the mail', { parent_id: parent, title: 'Send the mail' });
    const req = await requested(child.id);
    expect(await ok('GET', `/threads/${parent}/crew-questions`)).toEqual({
      items: [],
      secrets: [
        {
          thread_id: child.id,
          thread_title: 'Send the mail',
          task_id: h.thread(child.id).task_id,
          channel_id: 'scratch',
          request: { id: req.p.id, event_id: req.id, ask: named('MAILGUN_KEY'), exists: false, state: 'pending', replaced: false },
        },
      ],
    });
    expect(await blockers(parent)).toEqual([{ kind: 'question', detail: 'Stripe test secret key', count: 1 }]);
    expect(await blockers(child.id)).toEqual([]);

    await sleep(1000);
    expect((await submit(child.id, req.p.id, { value: VALUE })).body).toEqual({ state: 'saved', replaced: false, via: 'tool' });
    await h.untilResults(child.id, 2);
    expect((await ok('GET', `/threads/${parent}/crew-questions`)).secrets).toEqual([]);
    expect(await blockers(parent)).toEqual([]);
    await h.untilResults(parent, 2);
    expect(h.byKind(parent, 'crew_report')).toHaveLength(1);
    expect(h.byKind(child.id, 'result')).toHaveLength(2);
  });
});
