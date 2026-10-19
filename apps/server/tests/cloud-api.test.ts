import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../secrets.ts', () => ({ globalSecret: vi.fn(async (name: string) => (name === 'OMNI_CLOUD_REPLY_SECRET' ? 's3cret' : null)) }));

const { cloudApi } = await import('../cloud-api.ts');
const { awaitReply, resetReplies } = await import('../harness/claude-cloud/replies.ts');

const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  cloudApi.request(path, { method: 'POST', body, headers: { authorization: 'Bearer s3cret', ...headers } });

beforeEach(() => resetReplies());

describe('/api/cloud/reply', () => {
  it('hands a plain-text reply to the turn waiting on that session', async () => {
    const waiting = awaitReply('session_01X', 2000);
    const res = await post('/reply/cse_01X', 'All green.');
    expect(await res.json()).toEqual({ ok: true, delivered: true });
    expect(await waiting).toBe('All green.');
  });

  it('reads a JSON body', async () => {
    const waiting = awaitReply('session_01J', 2000);
    await post('/reply/session_01J', JSON.stringify({ text: 'From JSON' }), { 'content-type': 'application/json' });
    expect(await waiting).toBe('From JSON');
  });

  it('refuses a wrong bearer and an id that is not a session', async () => {
    expect((await post('/reply/session_01X', 'x', { authorization: 'Bearer nope' })).status).toBe(401);
    expect((await post('/reply/not-a-session', 'x')).status).toBe(400);
  });
});
