import { describe, it, expect, beforeAll, vi } from 'vitest';
import { startRunner } from './runner-boot.ts';

// The Keychain stays untouched: the one inbound token these tests use comes from this mock.
const TOKEN = 'test-inbound-token-0123456789';
vi.mock('../secrets.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../secrets.ts')>()),
  globalSecret: async (name: string) => (name === 'OMNI_INBOUND_GROK_TOKEN' ? TOKEN : null),
}));

let H: Awaited<ReturnType<typeof startRunner>>;
let mod: typeof import('../inbound-api.ts');

beforeAll(async () => {
  H = await startRunner();
  mod = await import('../inbound-api.ts');
});

const post = (path: string, body: unknown, token: string | null = TOKEN) =>
  mod.inboundApp.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

describe('POST /api/inbound/:name', () => {
  it('refuses a missing token, a wrong one, and a name with no token set alike', async () => {
    for (const [path, token] of [
      ['/api/inbound/grok', null],
      ['/api/inbound/grok', 'nope'],
      ['/api/inbound/other', TOKEN],
      ['/api/inbound/../threads', TOKEN],
    ] as const) {
      const res = await post(path, { text: 'hi' }, token);
      expect([401, 404]).toContain(res.status);
    }
    expect(H.db.threads.list({ channel: 'scratch', limit: 50 })).toHaveLength(0);
  });

  it('starts a thread from the bot, saying who sent it', async () => {
    const res = await post('/api/inbound/grok', { text: 'Check the Volero stock feed', sender: 'Firstmate', channel: 'scratch' });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.created).toBe(true);
    const t = H.db.threads.get(body.thread_id)!;
    expect(t.source).toBe('inbound');
    expect(t.channel_id).toBe('scratch');
    const user = await H.until('first prompt', () => H.events(t.id).find((e) => e.kind === 'user'));
    expect(user.p.source).toBe('inbound');
    expect(user.p.text).toBe('Message from "Firstmate" via the grok integration, not typed by Ben.\n\nCheck the Volero stock feed');
  });

  it('queues a message into an existing thread', async () => {
    const t = await H.start('already here');
    await H.untilStatus(t.id, 'done');
    const res = await post('/api/inbound/grok', { text: 'one more thing', thread_id: t.id, request_id: 'g-1' });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ thread_id: t.id, created: false, request_id: 'g-1' });
    const msg = await H.until('inbound message', () => H.events(t.id).find((e) => e.kind === 'user' && e.p.source === 'inbound'));
    expect(msg.p.text).toContain('one more thing');
  });

  it('rejects an unknown thread or channel and an empty text', async () => {
    expect((await post('/api/inbound/grok', { text: 'x', thread_id: 'nope' })).status).toBe(404);
    expect((await post('/api/inbound/grok', { text: 'x', channel: 'nope' })).status).toBe(404);
    expect((await post('/api/inbound/grok', { text: '   ' })).status).toBe(400);
  });

  it('serves nothing else on the inbound port', async () => {
    expect((await mod.inboundApp.request('/api/threads')).status).toBe(404);
    expect((await mod.inboundApp.request('/api/secrets', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(404);
    expect((await mod.inboundApp.request('/')).status).toBe(404);
  });
});

describe('tokenMatches', () => {
  it('matches only the exact stored token', () => {
    expect(mod.tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(mod.tokenMatches(`${TOKEN}x`, TOKEN)).toBe(false);
    expect(mod.tokenMatches(undefined, TOKEN)).toBe(false);
    expect(mod.tokenMatches(TOKEN, null)).toBe(false);
  });
});
