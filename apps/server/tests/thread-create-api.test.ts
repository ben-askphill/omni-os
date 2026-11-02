import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// POST /api/threads: what the iOS new-thread sheet and the Web UI send to start a thread.

const r = await startRunner();
const { app } = await import('../app.ts');

const post = async (body: unknown) => {
  const res = await app.request('/api/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

describe('POST /api/threads', () => {
  it('starts a thread in a known channel and sends its first message', async () => {
    const { status, body } = await post({ channel: 'scratch', prompt: 'hello from the phone', title: 'Phone thread' });
    expect(status).toBe(200);
    expect(body).toMatchObject({ channel_id: 'scratch', title: 'Phone thread' });
    await r.untilResults(body.id, 1);
    expect(r.texts(body.id, 'user')).toEqual(['hello from the phone']);
  });

  it('answers 404, not 500, for a channel that does not exist, and makes nothing', async () => {
    const before = r.db.threads.list({ limit: 1000 }).length;
    expect(await post({ channel: 'gone', prompt: 'hello' })).toEqual({ status: 404, body: { error: 'unknown channel "gone"' } });
    expect(r.db.threads.list({ limit: 1000 })).toHaveLength(before);
  });

  it('answers 400 for an empty first message', async () => {
    expect((await post({ channel: 'scratch', prompt: '' })).status).toBe(400);
  });

  describe('with an id the client chose', () => {
    it('uses it as the thread id', async () => {
      const id = randomUUID();
      const { status, body } = await post({ id, channel: 'scratch', prompt: 'with my own id', title: 'Own id' });
      expect(status).toBe(200);
      expect(body.id).toBe(id);
      await r.untilResults(id, 1);
    });

    it('answers a retry with the thread the first call made, and sends the message once', async () => {
      const id = randomUUID();
      const first = await post({ id, channel: 'scratch', prompt: 'only once', title: 'Retry' });
      await r.untilResults(id, 1);
      const again = await post({ id, channel: 'scratch', prompt: 'only once', title: 'Retry' });
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(first.body.id);
      expect(r.texts(id, 'user')).toEqual(['only once']);
      expect(r.db.threads.list({ limit: 1000 }).filter((t) => t.id === id)).toHaveLength(1);
    });

    it('shares one creation between two calls that overlap', async () => {
      const id = randomUUID();
      const body = { id, channel: 'scratch', prompt: 'at the same time', title: 'Overlap' };
      const [a, b] = await Promise.all([post(body), post(body)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(a.body.id).toBe(id);
      expect(b.body.id).toBe(id);
      await r.untilResults(id, 1);
      expect(r.texts(id, 'user')).toEqual(['at the same time']);
    });

    it('refuses an id the thread already has in another channel', async () => {
      const id = randomUUID();
      await post({ id, channel: 'scratch', prompt: 'first', title: 'Mine' });
      const other = await post({ id, channel: 'inbox', prompt: 'first' });
      expect(other.status).toBe(409);
      expect(r.thread(id).channel_id).toBe('scratch');
    });

    it('takes only a uuid, because the id names a folder on disk', async () => {
      for (const id of ['../etc', 'abc', '']) expect((await post({ id, channel: 'scratch', prompt: 'x' })).status).toBe(400);
    });

    it('keeps the id free after the channel is refused', async () => {
      const id = randomUUID();
      expect((await post({ id, channel: 'gone', prompt: 'x' })).status).toBe(404);
      const ok = await post({ id, channel: 'scratch', prompt: 'x', title: 'Now it exists' });
      expect(ok.body.id).toBe(id);
    });
  });
});
