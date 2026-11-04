import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// A parent thread's message_thread (a send from "conductor") reaches a thread only while its session is warm in the
// prompt cache. A cold one is refused with what to do instead, unless the parent passes wake_cold. Ben's own sends
// are never refused. get_thread (/summary) shows the same warmth.

const h = await startRunner();
const { app } = await import('../app.ts');
const { db } = await import('../db/connection.ts');
const T = { timeout: 30_000 };

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const summary = async (id: string) => (await call('GET', `/threads/${id}/summary`)).body;
/** Move every event of the thread two hours back, as if its model last did anything then. */
const age = (id: string) =>
  db.prepare(`UPDATE events SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours') WHERE thread_id = ?`).run(id);

describe('session warmth', () => {
  it('lets a parent message a warm thread', T, async () => {
    const t = await h.start('first pass');
    await h.untilResults(t.id, 1);
    expect((await summary(t.id)).session).toMatchObject({ warm: true, idle_minutes: 0 });

    const sent = await call('POST', `/threads/${t.id}/messages`, { prompt: 'one more thing', from: 'conductor', mode: 'queue' });
    expect(sent.status).toBe(200);
    await h.untilResults(t.id, 2);
  });

  it('refuses a parent message to a cold thread and says how to carry it on', T, async () => {
    const t = await h.start('first pass');
    await h.untilResults(t.id, 1);
    age(t.id);
    const s = await summary(t.id);
    expect(s.session).toMatchObject({ warm: false, idle_minutes: 120 });

    const refused = await call('POST', `/threads/${t.id}/messages`, { prompt: 'how did it go?', from: 'conductor', mode: 'queue' });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain('continue_thread');
    expect(refused.body.error).toContain('get_thread');
    expect(refused.body.session.warm).toBe(false);
    expect(h.byKind(t.id, 'user')).toHaveLength(1);

    // Asked to resume this very thread, the parent passes wake_cold.
    const woken = await call('POST', `/threads/${t.id}/messages`, { prompt: 'resume as asked', from: 'conductor', mode: 'queue', wake_cold: true });
    expect(woken.status).toBe(200);
    await h.untilResults(t.id, 2);
    expect((await summary(t.id)).session.warm).toBe(true);
  });

  it('never refuses a message from Ben', T, async () => {
    const t = await h.start('first pass');
    await h.untilResults(t.id, 1);
    age(t.id);
    const sent = await call('POST', `/threads/${t.id}/messages`, { prompt: 'picking this back up', mode: 'queue' });
    expect(sent.status).toBe(200);
    await h.untilResults(t.id, 2);
  });
});
