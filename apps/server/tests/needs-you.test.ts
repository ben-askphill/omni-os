import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// Needs you (apps/server/db/repos/needs-you.ts, GET /api/needs-you, POST /api/needs-you/read) through the real runner and
// the fake claude CLI. Every turn that ends leaves a completion, whichever path ended it; the inbox lists a thread's
// newest one until Ben reads it, plus the blockers that wait on him (failed Setup, parked requests). Reading names
// the exact result shown, so a later one stays unread, and it never touches the thread row.

const h = await startRunner({ FAKE_CLAUDE_CRASH_ON: 'CRASH_NOW' });
const { app } = await import('../app.ts');
const T = { timeout: 30_000 };

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const inbox = async (query = '') => (await call('GET', `/needs-you${query}`)).body;
const itemOf = async (id: string) => ((await inbox()).items as any[]).find((i) => i.thread.id === id);
const read = (uid: string) => call('POST', '/needs-you/read', { uid });
const finish = async (prompt: string, extra: Record<string, unknown> = {}) => {
  const t = await h.start(prompt, extra);
  await h.untilResults(t.id, 1);
  return t;
};

describe('Needs you', () => {
  it('lists an unread success and an unread failure with their reason, even past the recent list', T, async () => {
    const ok = await finish('fix the cart');
    const bad = await h.start('CRASH_NOW');
    await h.untilStatus(bad.id, 'failed');
    // Newer threads push both out of a short recent list.
    for (const p of ['one', 'two', 'three']) await finish(p);
    const recent = (await call('GET', '/recent?limit=2')).body as { id: string }[];
    expect(recent.map((t) => t.id)).not.toContain(ok.id);
    expect(recent.map((t) => t.id)).not.toContain(bad.id);

    const okItem = await itemOf(ok.id);
    const badItem = await itemOf(bad.id);
    expect(okItem.result).toMatchObject({ status: 'done', uid: expect.any(String), at: expect.any(String) });
    expect(badItem.result).toMatchObject({ status: 'failed' });
    expect(okItem.blockers).toEqual([]);
    // The result names where it sits in the transcript, by the event's synced uid.
    expect(okItem.result.event_uid).toBe(h.db.events.uidOf(h.db.events.lastId(ok.id)));
    const all = await inbox();
    expect(all.unread).toBe(all.items.filter((i: any) => i.result).length);
    expect(all.unread).toBeGreaterThanOrEqual(5);
  });

  it('reads only the result shown: a turn that ends during the read stays unread', T, async () => {
    const t = await finish('first turn');
    const first = (await itemOf(t.id)).result;

    // A second turn ends after the client fetched the inbox, before its read arrives.
    await call('POST', `/threads/${t.id}/messages`, { prompt: 'second turn', mode: 'queue' });
    await h.untilResults(t.id, 2);
    const before = h.thread(t.id);
    const res = await read(first.uid);
    expect(res.status).toBe(200);
    expect(res.body.thread_id).toBe(t.id);
    expect(res.body.item.result.uid).not.toBe(first.uid);
    expect(res.body.item.result.status).toBe('done');
    const second = res.body.item.result;

    // Reading never touches the thread row: same updated_at, same status.
    expect(h.thread(t.id)).toEqual(before);

    // The newer one read, the thread leaves the inbox. An older read arriving late moves nothing back.
    const unreadBefore = (await inbox()).unread;
    expect((await read(second.uid)).body.item).toBeNull();
    expect((await inbox()).unread).toBe(unreadBefore - 1);
    expect((await read(first.uid)).body.item).toBeNull();
    expect(h.db.resultReads.get(t.id)?.uid).toBe(second.uid);
    expect(await itemOf(t.id)).toBeUndefined();
  });

  it('takes repeated visits to the same result without change, and refuses one it does not know', T, async () => {
    const t = await finish('visit me');
    const { uid } = (await itemOf(t.id)).result;
    const once = await read(uid);
    const twice = await read(uid);
    expect(once.body).toEqual(twice.body);
    expect(h.db.resultReads.get(t.id)).toMatchObject({ uid });
    expect((await read('no-such-result')).status).toBe(404);
    expect((await call('POST', '/needs-you/read', {})).status).toBe(400);
  });

  it('tells the feed a result was read, without a thread change', T, async () => {
    const t = await finish('watch the feed');
    const seen: any[] = [];
    const on = (e: any) => seen.push(e);
    h.bus.on('feed', on);
    await read((await itemOf(t.id)).result.uid);
    h.bus.off('feed', on);
    expect(seen).toEqual([{ type: 'needs_you', thread_id: t.id }]);
  });

  it('brings a thread back with its next result, and leaves it out while it runs again', T, async () => {
    const t = await finish('round one');
    await read((await itemOf(t.id)).result.uid);
    expect(await itemOf(t.id)).toBeUndefined();
    await call('POST', `/threads/${t.id}/messages`, { prompt: 'TOOL:1500 round two', mode: 'queue' });
    await h.untilTool(t.id, 1);
    expect(await itemOf(t.id)).toBeUndefined();
    await h.untilResults(t.id, 2);
    expect((await itemOf(t.id)).result.status).toBe('done');
  });

  it('counts a stopped turn as a result', T, async () => {
    const t = await h.start('TOOL:20000 long job');
    await h.untilTool(t.id);
    await call('POST', `/threads/${t.id}/stop`, {});
    await h.untilStatus(t.id, 'stopped', 15_000);
    expect((await itemOf(t.id)).result.status).toBe('stopped');
  });

  it('keeps archived threads, team members and delegated successes out', T, async () => {
    const archived = await finish('archive me');
    expect(await itemOf(archived.id)).toBeDefined();
    await call('PATCH', `/threads/${archived.id}`, { archived: 1 });
    expect(await itemOf(archived.id)).toBeUndefined();

    const parent = await finish('parent');
    const child = await h.start('delegated', { parent_id: parent.id });
    await h.untilResults(child.id, 1);
    expect(await itemOf(child.id)).toBeUndefined();
  });

  it('keeps execution, read and filing state apart', T, async () => {
    const t = await finish('file me');
    const folder = (await call('POST', '/folders', { channel: 'scratch', name: 'Specs' })).body;
    const { uid } = (await itemOf(t.id)).result;
    // Filing does not read it.
    expect((await call('PATCH', `/threads/${t.id}`, { folder_id: folder.id })).status).toBe(200);
    expect((await itemOf(t.id)).result.uid).toBe(uid);
    // Reading does not file it, or change its status.
    await read(uid);
    expect(h.thread(t.id)).toMatchObject({ folder_id: folder.id, status: 'done' });
    expect(await itemOf(t.id)).toBeUndefined();
  });

  it('scopes to one channel', T, async () => {
    h.db.channels.create({ id: 'other', name: 'Other', kind: 'internal', use_worktree: 0, base_dir: join(h.tmp, 'scratch') });
    const t = await h.runner.createThread({ channel: 'other', prompt: 'elsewhere' });
    await h.untilResults(t.id, 1);
    const other = await inbox('?channel=other');
    expect(other.items.map((i: any) => i.thread.id)).toEqual([t.id]);
    expect(other.unread).toBe(1);
    expect((await inbox('?channel=scratch')).items.some((i: any) => i.thread.id === t.id)).toBe(false);
  });
});

describe('Needs you blockers', () => {
  it('lists a worktree that could not be prepared, with git\'s reason', T, async () => {
    h.db.channels.create({ id: 'broken-repo', name: 'Broken', kind: 'client', use_worktree: 1, repo_path: join(h.tmp, 'no-such-repo') });
    const t = await h.runner.createThread({ channel: 'broken-repo', prompt: 'never runs' });
    await h.until('setup to fail', () => h.thread(t.id).setup === 'failed');
    const item = await itemOf(t.id);
    expect(item.blockers[0]).toMatchObject({ kind: 'setup', detail: expect.any(String) });
    expect(item.blockers[0].detail).toBe(h.thread(t.id).setup_error);
    // Its first prompt waits as a recovered request too.
    expect(item.blockers.map((b: any) => b.kind)).toEqual(['setup', 'recovered']);
    expect((await inbox()).blocked).toBeGreaterThanOrEqual(1);
  });

  it('lists recovered and uncertain requests until Ben acts, read or not', T, async () => {
    const t = await finish('parked work');
    const park = (requestId: string, sent: boolean) => {
      const { row } = h.db.messageRequests.accept({
        thread_id: t.id, request_id: requestId, prompt: requestId, mode: 'queue', source: 'ben', attachments: null, fingerprint: requestId, machine_id: null,
      });
      h.db.messageRequests.mark(row.id, sent ? 'sent' : 'held');
      h.db.messageRequests.park(row.id);
      return row.id;
    };
    park('kept-1', false);
    park('kept-2', false);
    const maybe = park('maybe', true);
    const item = await itemOf(t.id);
    expect(item.blockers).toEqual([
      { kind: 'uncertain', detail: null, count: 1 },
      { kind: 'recovered', detail: null, count: 2 },
    ]);
    // Reading the result leaves the blockers.
    const after = (await read(item.result.uid)).body.item;
    expect(after.result).toBeNull();
    expect(after.blockers.map((b: any) => b.kind)).toEqual(['uncertain', 'recovered']);
    // Discarding the uncertain one clears it.
    h.db.messageRequests.mark(maybe, 'discarded');
    expect((await itemOf(t.id)).blockers.map((b: any) => b.kind)).toEqual(['recovered']);
  });

  it('leaves out a parked request another Mac accepted', T, async () => {
    const t = await finish('copied database');
    const { row } = h.db.messageRequests.accept({
      thread_id: t.id, request_id: 'theirs', prompt: 'x', mode: 'queue', source: 'ben', attachments: null, fingerprint: 'x', machine_id: 'other-mac',
    });
    h.db.db.prepare(`UPDATE message_requests SET state = 'recovered' WHERE id = ?`).run(row.id);
    await read((await itemOf(t.id)).result.uid);
    expect(await itemOf(t.id)).toBeUndefined();
  });
});
