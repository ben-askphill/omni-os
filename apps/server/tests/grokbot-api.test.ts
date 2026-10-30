import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// The route in front of sendToGrokBot: a thread's text goes out, and a missing webhook answers before any fetch.
const h = await startRunner();
const { app } = await import('../app.ts');
const { GROKBOT_WEBHOOK_AUTH, GROKBOT_WEBHOOK_URL } = await import('../harness/env-guard.ts');

const URL = 'https://example.test/hook';
const AUTH = 'route-secret-token-value';
const realFetch = globalThis.fetch;
const saved = { url: process.env[GROKBOT_WEBHOOK_URL], auth: process.env[GROKBOT_WEBHOOK_AUTH] };

let seen: { url: string; init: RequestInit } | undefined;
let fetchResult: () => Response | Promise<Response>;

beforeEach(() => {
  delete process.env[GROKBOT_WEBHOOK_URL];
  delete process.env[GROKBOT_WEBHOOK_AUTH];
  seen = undefined;
  fetchResult = () => new Response('accepted', { status: 200 });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen = { url: String(input), init: init ?? {} };
    return fetchResult();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(() => {
  if (saved.url === undefined) delete process.env[GROKBOT_WEBHOOK_URL];
  else process.env[GROKBOT_WEBHOOK_URL] = saved.url;
  if (saved.auth === undefined) delete process.env[GROKBOT_WEBHOOK_AUTH];
  else process.env[GROKBOT_WEBHOOK_AUTH] = saved.auth;
});

function configure() {
  process.env[GROKBOT_WEBHOOK_URL] = URL;
  process.env[GROKBOT_WEBHOOK_AUTH] = AUTH;
}

async function post(body: unknown, headers?: Record<string, string>) {
  const res = await app.request('/api/grokbot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as { ok?: boolean; error?: string }) : {} };
}

function seedThread() {
  if (h.db.threads.get('t-grok')) return;
  h.db.threads.create({
    id: 't-grok',
    channel_id: 'scratch',
    title: 'Cart drawer',
    status: 'done',
    role: null,
    model: null,
    session_id: 't-grok',
    cwd: h.tmp,
    branch: null,
    parent_id: null,
    task_id: null,
    source: 'manual',
    automation: null,
  });
  h.db.events.add('t-grok', 'user', { text: 'Look at the cart' });
  h.db.events.add('t-grok', 'tool_use', { name: 'Read' });
  h.db.events.add('t-grok', 'assistant_text', { text: 'The drawer sticks.' });
  h.db.events.add('t-grok', 'user', { text: 'dropped', dropped: 1 });
}

describe('POST /api/grokbot', () => {
  it('sends a thread\'s text with its channel and thread ids', async () => {
    configure();
    seedThread();
    const res = await post({ thread_id: 't-grok', context: { note: 'from the menu' } });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(seen?.url).toBe(URL);
    expect(new Headers(seen?.init.headers).get('authorization')).toBe(`Bearer ${AUTH}`);
    expect(JSON.parse(String(seen?.init.body))).toEqual({
      request: ['Cart drawer', 'User: Look at the cart', 'Assistant: The drawer sticks.'].join('\n\n'),
      source: 'omni-os',
      context: { note: 'from the menu', channel_id: 'scratch', thread_id: 't-grok' },
    });
  });

  it('sends a request on its own, and lets the thread ids win when both are set', async () => {
    configure();
    seedThread();
    const alone = await post({ request: 'Ask about shipping', context: { topic: 'rates' } });
    expect(alone.status).toBe(200);
    expect(JSON.parse(String(seen?.init.body))).toEqual({
      request: 'Ask about shipping',
      source: 'omni-os',
      context: { topic: 'rates' },
    });
    const both = await post({ request: 'Use this text', thread_id: 't-grok', context: { thread_id: 'other', channel_id: 'other' } });
    expect(both.status).toBe(200);
    expect(JSON.parse(String(seen?.init.body)).request).toBe('Use this text');
    expect(JSON.parse(String(seen?.init.body)).context).toEqual({ thread_id: 't-grok', channel_id: 'scratch' });
  });

  it('answers unconfigured before calling the webhook', async () => {
    const res = await post({ request: 'hello' });
    expect(res.status).toBe(503);
    expect(res.json.error).toContain(GROKBOT_WEBHOOK_URL);
    expect(res.json.error).toContain(GROKBOT_WEBHOOK_AUTH);
    expect(seen).toBeUndefined();
  });

  it('turns a 401 into a check of the Authorization value, without the key', async () => {
    configure();
    fetchResult = () =>
      new Response(JSON.stringify({ code: 'error', message: `Malformed Authorization header. Use Authorization: Bearer ${AUTH}.` }), { status: 401 });
    const res = await post({ request: 'hello' });
    expect(res.status).toBe(502);
    expect(res.json.error).toBe('Grok Bot returned HTTP 401. Check that the Authorization value is the key from the Omni OS requests routine.');
    expect(res.json.error).not.toContain(AUTH);
    expect(new Headers(seen?.init.headers).get('authorization')).toBe(`Bearer ${AUTH}`);
  });

  it('turns a non-2xx webhook answer into an error, without the auth value', async () => {
    configure();
    fetchResult = () => new Response(`nope ${AUTH}`, { status: 500 });
    const res = await post({ request: 'hello' });
    expect(res.status).toBe(502);
    expect(res.json.error).toContain('HTTP 500');
    expect(res.json.error).not.toContain(AUTH);
  });

  it('turns a network failure into an error', async () => {
    configure();
    fetchResult = () => Promise.reject(new Error(`down ${AUTH}`));
    const res = await post({ request: 'hello' });
    expect(res.status).toBe(502);
    expect(res.json.error).toBe('Could not reach Grok Bot.');
    expect(res.json.error).not.toContain(AUTH);
  });

  it('404s an unknown thread and 400s one with no text', async () => {
    configure();
    expect((await post({ thread_id: 'missing' })).status).toBe(404);
    h.db.threads.create({
      id: 't-empty',
      channel_id: 'scratch',
      title: '   ',
      status: 'done',
      role: null,
      model: null,
      session_id: 't-empty',
      cwd: h.tmp,
      branch: null,
      parent_id: null,
      task_id: null,
      source: 'manual',
      automation: null,
    });
    const empty = await post({ thread_id: 't-empty' });
    expect(empty.status).toBe(400);
    expect(empty.json.error).toBe('This thread has no text to send.');
    expect(seen).toBeUndefined();
  });

  it('refuses a body that is not JSON and one with nothing to send', async () => {
    const bare = await app.request('/api/grokbot', { method: 'POST', body: '{}' });
    expect(bare.status).toBe(415);
    expect((await post({})).status).toBe(400);
    expect((await post({ context: ['nope'] })).status).toBe(400);
  });
});

describe('GET /api/status grokBot', () => {
  const grokBot = async () => ((await (await app.request('/api/status')).json()) as { grokBot?: boolean }).grokBot;

  it('is false without a webhook URL, and true once the environment or a global secret has one', async () => {
    expect(await grokBot()).toBe(false);
    process.env[GROKBOT_WEBHOOK_URL] = '  ';
    expect(await grokBot()).toBe(false);
    process.env[GROKBOT_WEBHOOK_URL] = URL;
    expect(await grokBot()).toBe(true);
    delete process.env[GROKBOT_WEBHOOK_URL];
    h.db.db.prepare('INSERT INTO secrets (scope, name) VALUES (?, ?)').run('global', GROKBOT_WEBHOOK_URL);
    try {
      expect(await grokBot()).toBe(true);
    } finally {
      h.db.db.prepare('DELETE FROM secrets WHERE scope = ? AND name = ?').run('global', GROKBOT_WEBHOOK_URL);
    }
  });
});
