import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// PATCH /api/threads/:id: what `/rename` calls to rename an Omni thread.

const r = await startRunner();
const { threadsApi } = await import('../threads-api.ts');

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
    for (const body of [{ title: ' \n ' }, {}, { title: 42 }]) expect(await patch(t.id, body)).toEqual({ status: 400, body: { error: 'a title is required' } });
    expect(r.thread(t.id).title).toBe('Old title');
  });

  it('takes a title of up to 200 characters, and says so for a longer one', async () => {
    const t = await idle();
    expect(await patch(t.id, { title: 'a'.repeat(201) })).toEqual({ status: 400, body: { error: 'a title can be up to 200 characters' } });
    expect(r.thread(t.id).title).toBe('Old title');
    expect((await patch(t.id, { title: ` ${'a'.repeat(200)} ` })).status).toBe(200);
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

  it('archives a thread out of the lists and brings it back, keeping its place', async () => {
    const t = await idle();
    const { threads } = await import('../db.ts');
    expect(await patch(t.id, { archived: true })).toMatchObject({ status: 200, body: { id: t.id, archived: 1, title: 'Old title' } });
    expect(r.thread(t.id).updated_at).toBe(t.updated_at);
    expect(threads.byChannel(t.channel_id).some((x) => x.id === t.id)).toBe(false);
    expect(threads.recent(500).some((x) => x.id === t.id)).toBe(false);
    expect(threads.byChannel(t.channel_id, 200, true).some((x) => x.id === t.id)).toBe(true);
    expect((await patch(t.id, { archived: false })).body.archived).toBe(0);
    expect(threads.byChannel(t.channel_id).some((x) => x.id === t.id)).toBe(true);
  });
});

describe('pinned threads', () => {
  const pinnedIds = async () => {
    const { feedApi } = await import('../feed-api.ts');
    return ((await (await feedApi.request('/pinned')).json()) as { id: string }[]).map((t) => t.id);
  };

  it('pins and unpins a thread, latest pin first, keeping its place in the lists and telling the UI', async () => {
    const a = await idle();
    const b = await idle();
    const seen: (string | null)[] = [];
    const onFeed = (e: any) => e.type === 'thread' && e.thread.id === a.id && seen.push(e.thread.pinned_at);
    r.bus.on('feed', onFeed);
    const pinned = await patch(a.id, { pinned: true });
    r.bus.off('feed', onFeed);
    expect(pinned.status).toBe(200);
    expect(pinned.body.pinned_at).toEqual(expect.any(String));
    expect(seen.at(-1)).toBe(pinned.body.pinned_at);
    expect(r.thread(a.id).updated_at).toBe(a.updated_at);
    await new Promise((done) => setTimeout(done, 5));
    await patch(b.id, { pinned: true });
    expect((await pinnedIds()).slice(0, 2)).toEqual([b.id, a.id]);

    // Pinning again keeps when it was pinned, so the order holds.
    await patch(a.id, { pinned: true });
    expect(r.thread(a.id).pinned_at).toBe(pinned.body.pinned_at);

    expect((await patch(b.id, { pinned: false })).body.pinned_at).toBeNull();
    expect(await pinnedIds()).not.toContain(b.id);
    expect(await pinnedIds()).toContain(a.id);
  });

  it('drops a thread from Pinned when it is archived, and will not pin an archived one', async () => {
    const t = await idle();
    await patch(t.id, { pinned: true });
    expect(await pinnedIds()).toContain(t.id);
    expect((await patch(t.id, { archived: true })).body).toMatchObject({ archived: 1, pinned_at: null });
    expect(await pinnedIds()).not.toContain(t.id);
    expect(await patch(t.id, { pinned: true })).toEqual({ status: 409, body: { error: 'an archived thread cannot be pinned' } });
    // Restored, it goes back to its channel, not to Pinned.
    await patch(t.id, { archived: false });
    expect(await pinnedIds()).not.toContain(t.id);
  });

  it("leaves out the pinned threads of an archived channel", async () => {
    const t = await idle();
    const { channels } = await import('../db.ts');
    await patch(t.id, { pinned: true });
    channels.update(t.channel_id, { archived: 1 });
    try {
      expect(await pinnedIds()).not.toContain(t.id);
    } finally {
      channels.update(t.channel_id, { archived: 0 });
    }
    expect(await pinnedIds()).toContain(t.id);
  });
});
