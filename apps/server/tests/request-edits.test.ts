import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { startRunner } from './runner-boot.ts';
import { sleep } from './support.ts';

// Editing, removing and reordering unsent messages (apps/server/runner/pending.ts) through the HTTP routes, the real
// runner and the fake claude CLI. Every change is checked against where the message is when it arrives: one the
// runner has started to send is refused with a 409. Reordering a parked queue never resumes it; Resume runs the
// order last saved, once. One slot, so a second thread can wait for it.

let h: Awaited<ReturnType<typeof startRunner>>;
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let uploadsDir: (id: string) => string;
const T = { timeout: 30_000 };

beforeAll(async () => {
  h = await startRunner({ OMNI_MAX_CONCURRENT: '1' });
  ({ app } = await import('../app.ts'));
  ({ uploadsDir } = await import('../config.ts'));
});

const call = async (method: string, path: string, body?: unknown, files: File[] = []) => {
  let init: RequestInit = { method };
  if (files.length) {
    const fd = new FormData();
    fd.append('payload', JSON.stringify(body ?? {}));
    for (const f of files) fd.append('files', f, f.name);
    init.body = fd;
  } else if (body !== undefined) init = { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await app.request(`/api${path}`, init);
  return { status: res.status, body: (await res.json()) as any };
};
const post = (id: string, prompt: string, extra: Record<string, unknown> = {}, files: File[] = []) =>
  call('POST', `/threads/${id}/messages`, { prompt, mode: 'queue', ...extra }, files);
const edit = (id: string, rid: string, body: Record<string, unknown>, files: File[] = []) => call('PATCH', `/threads/${id}/requests/${rid}`, body, files);
const cancel = (id: string, ids: string[]) => call('POST', `/threads/${id}/requests/cancel`, { ids });
const reorder = (id: string, ids: string[]) => call('POST', `/threads/${id}/requests/reorder`, { ids });
const row = (id: string) => h.db.messageRequests.get(id)!;
const userTexts = (id: string) => h.texts(id, 'user').filter((x) => !x.startsWith('TOOL'));

describe('editing an unsent message', () => {
  it('saves the edit on the same request and position, and the agent gets the edited text and files', T, async () => {
    const t = await h.start('TOOL:2500 work');
    await h.untilTool(t.id);
    const a = await post(t.id, 'first draft', { request_id: 'edit-a' }, [new File(['one'], 'one.txt'), new File(['two'], 'two.txt')]);
    const b = await post(t.id, 'after it', { request_id: 'edit-b' });
    const id = a.body.request.id;
    const pos = row(id).pos;

    const res = await edit(t.id, id, { prompt: 'second draft', keep: ['two.txt'] }, [new File(['three'], 'three.txt')]);
    expect(res.status).toBe(200);
    expect(res.body.request).toMatchObject({ id, request_id: 'edit-a', prompt: 'second draft', state: 'held', pos });
    expect(res.body.request.attachments.map((f: any) => f.name)).toEqual(['two.txt', 'three.txt']);
    // Still first in the queue, under the same id.
    expect(res.body.pending.map((m: any) => [m.uuid, m.text])).toEqual([
      [id, 'second draft'],
      [b.body.request.id, 'after it'],
    ]);

    await h.untilResults(t.id, 3);
    expect(userTexts(t.id)).toEqual(['second draft', 'after it']);
    const user = h.byKind(t.id, 'user').find((e) => e.p.text === 'second draft')!;
    expect(user.p.attachments.map((f: any) => f.name)).toEqual(['two.txt', 'three.txt']);
    expect(row(id)).toMatchObject({ state: 'delivered', event_id: user.id });
    // A late retry of the first send is still that send: answered as a duplicate, nothing sent again.
    const retry = await post(t.id, 'first draft', { request_id: 'edit-a' }, [new File(['one'], 'one.txt'), new File(['two'], 'two.txt')]);
    expect(retry.body.request).toMatchObject({ id, duplicate: true });
  });

  it('refuses an edit that arrives after delivery began, saves nothing, and removes its files', T, async () => {
    const t = await h.start('TOOL:1200 work');
    await h.untilTool(t.id);
    const q = await post(t.id, 'original', { request_id: 'race-a' });
    const id = q.body.request.id;
    // The client opened the editor while the message was held; the turn ends and the runner sends it.
    expect(q.body.request.state).toBe('held');
    await h.until('the held message to be sent', () => ['sent', 'delivered'].includes(row(id).state));

    const late = await edit(t.id, id, { prompt: 'too late' }, [new File(['x'], 'late.txt')]);
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/already been sent/);
    expect(row(id).prompt).toBe('original');
    const dir = uploadsDir(t.id);
    expect(existsSync(dir) ? readdirSync(dir) : []).not.toContain('late.txt');
    await h.untilResults(t.id, 2);
    expect(userTexts(t.id)).toEqual(['original']);
  });

  it('refuses edits to a message the thread does not have, and a steer already written to the harness', T, async () => {
    const t = await h.start('TOOL:1500 work');
    await h.untilTool(t.id);
    const steer = await post(t.id, 'steer now', { mode: 'steer', request_id: 'steer-a' });
    expect(row(steer.body.request.id).state).toBe('sent');
    expect((await edit(t.id, steer.body.request.id, { prompt: 'changed' })).status).toBe(409);
    expect((await edit(t.id, 'no-such-request', { prompt: 'changed' })).status).toBe(404);
    expect((await cancel(t.id, [steer.body.request.id])).status).toBe(409);
    await h.untilResults(t.id, 1);
  });
});

describe('removing an unsent message', () => {
  it('leaves a cancelled record and no transcript message', T, async () => {
    const t = await h.start('TOOL:1500 work');
    await h.untilTool(t.id);
    const a = await post(t.id, 'keep me', { request_id: 'cx-a' });
    const b = await post(t.id, 'remove me', { request_id: 'cx-b' });
    const res = await cancel(t.id, [b.body.request.id]);
    expect(res.status).toBe(200);
    expect(res.body.pending.map((m: any) => m.text)).toEqual(['keep me']);
    expect(row(b.body.request.id).state).toBe('cancelled');

    await h.untilResults(t.id, 2);
    expect(userTexts(t.id)).toEqual(['keep me']);
    expect(h.byKind(t.id, 'user').some((e) => e.p.text === 'remove me')).toBe(false);
    // The record: GET /requests lists it, newest first.
    const list = await call('GET', `/threads/${t.id}/requests`);
    expect(list.body.map((r: any) => [r.prompt, r.state])).toEqual([
      ['remove me', 'cancelled'],
      ['keep me', 'delivered'],
    ]);
    // Removing it again, or one already delivered, is refused.
    expect((await cancel(t.id, [b.body.request.id])).status).toBe(409);
    expect((await cancel(t.id, [a.body.request.id])).status).toBe(409);
  });

  it('takes a thread waiting for a slot out of the queue when its only message is removed', T, async () => {
    const t = await h.start('hello');
    await h.untilResults(t.id, 1);
    const blocker = await h.start('TOOL:2000 holds it again');
    await h.untilTool(blocker.id);
    const q = await post(t.id, 'wait for a slot', { request_id: 'wait-a' });
    expect(h.thread(t.id).status).toBe('queued');
    expect(row(q.body.request.id).state).toBe('waiting');
    await cancel(t.id, [q.body.request.id]);
    expect(h.thread(t.id).status).toBe('done');
    await h.untilResults(blocker.id, 1);
    await sleep(200);
    expect(userTexts(t.id)).toEqual(['hello']);
  });
});

describe('reordering', () => {
  it('runs held messages in the new order and refuses an order made from a stale queue', T, async () => {
    const t = await h.start('TOOL:2500 work');
    await h.untilTool(t.id);
    const ids: string[] = [];
    for (const p of ['A', 'B', 'C']) ids.push((await post(t.id, p, { request_id: `ro-${p}` })).body.request.id);
    // Missing one, or naming one twice: the queue the client saw is not this one.
    expect((await reorder(t.id, [ids[2], ids[0]])).status).toBe(409);
    expect((await reorder(t.id, [ids[2], ids[0], ids[0]])).status).toBe(409);
    const res = await reorder(t.id, [ids[2], ids[0], ids[1]]);
    expect(res.status).toBe(200);
    expect(res.body.pending.map((m: any) => m.text)).toEqual(['C', 'A', 'B']);
    // The saved positions follow, so a restart would keep it.
    expect([ids[2], ids[0], ids[1]].map((id) => row(id).pos)).toEqual([...ids.map((id) => row(id).pos)].sort((a, b) => a - b));
    await h.untilResults(t.id, 4);
    expect(userTexts(t.id)).toEqual(['C', 'A', 'B']);
  });
});

describe('a parked queue', () => {
  /** A thread with requests a killed server parked, as boot recovery leaves them. */
  async function parked(prompts: string[]) {
    const t = await h.start('hello');
    await h.untilResults(t.id, 1);
    const ids = prompts.map((prompt, i) => {
      const { row: saved } = h.db.messageRequests.accept({
        thread_id: t.id, request_id: `${t.id}-${i}`, prompt, mode: 'queue', source: 'ben', attachments: null, fingerprint: 'f', machine_id: null,
      });
      h.db.messageRequests.mark(saved.id, 'held');
      return saved.id;
    });
    h.db.messageRequests.recover(null);
    return { t, ids };
  }

  it('edits and reorders without resuming, and Resume then runs the saved order once', T, async () => {
    const { t, ids } = await parked(['one', 'two', 'three']);
    const spawned = h.spawns(t.id).length;
    expect((await edit(t.id, ids[1], { prompt: 'two, edited' })).status).toBe(200);
    expect((await reorder(t.id, [ids[2], ids[0], ids[1]])).status).toBe(200);
    expect((await cancel(t.id, [ids[0]])).status).toBe(200);
    await sleep(300);
    // Nothing ran: still parked, in the new order.
    expect(h.spawns(t.id)).toHaveLength(spawned);
    expect(h.db.messageRequests.parked(t.id).map((r) => [r.prompt, r.state])).toEqual([
      ['three', 'recovered'],
      ['two, edited', 'recovered'],
    ]);

    const [first, second] = await Promise.all([
      call('POST', `/threads/${t.id}/requests/resume`, {}),
      call('POST', `/threads/${t.id}/requests/resume`, {}),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    await h.untilResults(t.id, 3);
    await sleep(200);
    expect(userTexts(t.id)).toEqual(['hello', 'three', 'two, edited']);
    expect(row(ids[0]).state).toBe('cancelled');
  });

  it('refuses an edit or reorder that arrives once Resume has taken the queue', T, async () => {
    const { t, ids } = await parked(['first', 'second']);
    // Resume takes the queue before its first await; the edit and the order Ben made before it land after.
    const resumed = h.runner.resumeRequests(t.id);
    const [late, stale] = await Promise.all([edit(t.id, ids[0], { prompt: 'first, edited too late' }), reorder(t.id, [ids[1], ids[0]])]);
    await resumed;
    expect(late.status).toBe(409);
    expect(stale.status).toBe(409);
    await h.untilResults(t.id, 3);
    expect(userTexts(t.id)).toEqual(['hello', 'first', 'second']);
  });
});
