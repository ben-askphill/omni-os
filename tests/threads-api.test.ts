import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// PATCH /api/threads/:id: what `/rename` calls to rename an Omni thread.

const r = await startRunner();
const { threadsApi } = await import('../server/threads-api.ts');

const patch = async (id: string, body: unknown) => {
  const res = await threadsApi.request(`/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

// A title up front, so the generated one can't land after the rename.
const idle = async () => {
  const t = await r.start('hello', { title: 'Old title' });
  await r.untilResults(t.id, 1);
  return r.thread(t.id);
};

describe('PATCH /api/threads/:id', () => {
  it('renames a thread on one line, tells the UI, and keeps its place in the lists', async () => {
    const before = await idle();
    const titles: string[] = [];
    const onFeed = (e: any) => e.type === 'thread' && e.thread.id === before.id && titles.push(e.thread.title);
    r.bus.on('feed', onFeed);
    const { status, body } = await patch(before.id, { title: '  Fix the\nlogin  bug ' });
    r.bus.off('feed', onFeed);

    expect(status).toBe(200);
    expect(body).toMatchObject({ id: before.id, title: 'Fix the login bug' });
    expect(r.thread(before.id)).toMatchObject({ title: 'Fix the login bug', updated_at: before.updated_at, session_id: before.session_id });
    expect(titles.at(-1)).toBe('Fix the login bug');
  });

  it('needs a title', async () => {
    const t = await idle();
    for (const body of [{ title: ' \n ' }, {}, { title: 42 }]) expect((await patch(t.id, body)).status).toBe(400);
    expect(r.thread(t.id).title).toBe('Old title');
  });

  it("keeps Ben's title when the generated one comes back after the rename", async () => {
    const t = await r.start('TITLE:300 fix the login bug');
    expect((await patch(t.id, { title: 'Login bug' })).status).toBe(200);
    const spawn = await r.until('the title call', () => r.invocations().find((i) => i.mode === 'text'));
    await r.until('the title call to end', () => !r.fakeAlive(spawn.pid));
    await new Promise((done) => setTimeout(done, 100));
    expect(r.thread(t.id).title).toBe('Login bug');
  });

  it('is 404 for a thread that does not exist', async () => {
    expect((await patch('nope', { title: 'New title' })).status).toBe(404);
  });
});
