import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectRows, type DiffSelection } from '@omni/shared/message-context-diff.ts';
import { SEND_NOTES_MAX, type ReviewNote } from '@omni/shared/review-notes.ts';
import { startRunner } from './runner-boot.ts';
import { diffFile } from './support.ts';

// Review notes on a thread's Changes diff: added, edited, resolved and deleted through /api/threads/:id/review-notes,
// kept across a reload of the list, and Send open notes posting every open one as one message the harness reads.

let H: Awaited<ReturnType<typeof startRunner>>;
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let anchor: DiffSelection;
let threadId: string;
const feed: any[] = [];
const T = { timeout: 30_000 };

beforeAll(async () => {
  H = await startRunner();
  ({ app } = await import('../app.ts'));
  H.bus.on('feed', (e: any) => feed.push(e));
  const repo = mkdtempSync(join(tmpdir(), 'omni-review-notes-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args]);
  git('init', '-q');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'cart.ts'), 'export function total(items: number[]) {\n  return items.reduce((a, b) => a + b, 0);\n}\n');
  git('add', '.');
  git('commit', '-q', '-m', 'cart');
  writeFileSync(join(repo, 'src', 'cart.ts'), 'export function total(items: number[]) {\n  return items.reduce((sum, n) => sum + n, 0);\n}\n');
  H.db.channels.create({ id: 'notes', name: 'Notes', kind: 'internal', use_worktree: 0, repo_path: repo, base_dir: repo });
  const t = await H.runner.createThread({ channel: 'notes', prompt: 'hello' });
  threadId = t.id;
  await H.untilResults(t.id, 1);
  const changes = await (await app.request(`/api/threads/${t.id}/changes`)).json();
  const file = changes.groups.find((g: any) => g.kind === 'unstaged').files[0];
  const body = selectRows(diffFile(file), 3, 3, { group: 'unstaged', from: changes.base.sha, to: changes.head, turn: null });
  if (!body.ok) throw new Error(body.error);
  anchor = body.value;
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
};
const list = async (id = threadId) => (await call('GET', `/threads/${id}/review-notes`)).body.notes as ReviewNote[];
const add = async (body: string, id = threadId) => {
  const r = await call('POST', `/threads/${id}/review-notes`, { anchor, body });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.note as ReviewNote;
};
const feedFor = (id: string) => feed.filter((e: any) => e.type === 'review_notes' && e.thread_id === id).length;

describe('review notes', () => {
  it('adds a note on the picked lines, keeps it and tells open panels', async () => {
    const before = feedFor(threadId);
    const note = await add('  name these better  ');
    expect(note).toMatchObject({ thread_id: threadId, body: 'name these better', resolved_at: null, sent_at: null });
    expect(note.anchor).toEqual(anchor);
    expect(await list()).toEqual([note]);
    expect(feedFor(threadId)).toBe(before + 1);
  });

  it('refuses a note with no words, bad lines or on a thread that is not there', async () => {
    expect((await call('POST', `/threads/${threadId}/review-notes`, { anchor, body: '   ' })).status).toBe(400);
    expect((await call('POST', `/threads/${threadId}/review-notes`, { anchor: { ...anchor, path: '../x' }, body: 'x' })).body.error).toMatch(/^anchor: path/);
    expect((await call('POST', '/threads/nope/review-notes', { anchor, body: 'x' })).status).toBe(404);
    expect((await call('PATCH', `/threads/${threadId}/review-notes/nope`, { body: 'x' })).status).toBe(404);
    expect((await call('DELETE', `/threads/${threadId}/review-notes/nope`)).status).toBe(404);
  });

  it('edits, resolves, reopens and deletes', async () => {
    const note = await add('first words');
    const edited = (await call('PATCH', `/threads/${threadId}/review-notes/${note.id}`, { body: 'second words' })).body.note as ReviewNote;
    expect(edited.body).toBe('second words');
    const resolved = (await call('PATCH', `/threads/${threadId}/review-notes/${note.id}`, { resolved: true })).body.note as ReviewNote;
    expect(resolved.resolved_at).toEqual(expect.any(String));
    expect((await call('PATCH', `/threads/${threadId}/review-notes/${note.id}`, { resolved: false })).body.note.resolved_at).toBeNull();
    expect((await call('DELETE', `/threads/${threadId}/review-notes/${note.id}`)).body).toEqual({ ok: true });
    expect((await list()).map((n) => n.id)).not.toContain(note.id);
  });

  it('sends every open note as one message, marks them sent, and leaves resolved ones out', T, async () => {
    const t = await H.runner.createThread({ channel: 'notes', prompt: 'hello' });
    await H.untilResults(t.id, 1);
    const a = await add('rename sum to total', t.id);
    const b = await add('and n to price', t.id);
    const done = await add('already fixed', t.id);
    await call('PATCH', `/threads/${t.id}/review-notes/${done.id}`, { resolved: true });

    const sent = await call('POST', `/threads/${t.id}/review-notes/send`, {});
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.target).toBe(t.id);
    expect(sent.body.sent.map((n: ReviewNote) => n.id)).toEqual([a.id, b.id]);
    await H.untilResults(t.id, 2);

    const user = H.byKind(t.id, 'user').at(-1)!.p;
    expect(user.text).toBe('Address these 2 review notes on the diff.');
    expect(user.context.map((c: any) => [c.id, c.kind, c.note])).toEqual([
      [a.id, 'diff_selection', 'rename sum to total'],
      [b.id, 'diff_selection', 'and n to price'],
    ]);
    const text = H.claudeTexts(t.id).at(-1)!;
    expect(text).toContain('the user attached 2 items from Omni');
    expect(text).toContain("the user's note: rename sum to total");
    expect(text).toContain('Check: current.');

    const after = await list(t.id);
    expect(after.find((n) => n.id === a.id)!.sent_at).toEqual(expect.any(String));
    expect(after.find((n) => n.id === done.id)!.sent_at).toBeNull();
    // Nothing open is left to send; an edit opens a sent note again.
    expect((await call('POST', `/threads/${t.id}/review-notes/send`, {})).body.error).toBe('No open notes to send.');
    const reopened = (await call('PATCH', `/threads/${t.id}/review-notes/${a.id}`, { body: 'rename sum to subtotal' })).body.note as ReviewNote;
    expect(reopened.sent_at).toBeNull();
    // The same words again change nothing, so a sent note stays sent.
    expect((await call('PATCH', `/threads/${t.id}/review-notes/${b.id}`, { body: 'and n to price' })).body.note.sent_at).toEqual(expect.any(String));
  });

  it('lists the delegates notes may go to, without team members or other threads', T, async () => {
    const lead = await H.runner.createThread({ channel: 'notes', prompt: 'hello' });
    await H.untilResults(lead.id, 1);
    const crew = await H.runner.createThread({ channel: 'notes', prompt: 'hello', title: 'Check totals', role: null, parent_id: lead.id, source: 'conductor' });
    await H.runner.createThread({ channel: 'notes', prompt: 'hello' });
    const r = await call('GET', `/threads/${lead.id}/review-notes/targets`);
    expect(r.body.targets).toEqual([{ id: crew.id, title: 'Check totals', role: null, status: expect.any(String) }]);
    expect((await call('GET', '/threads/nope/review-notes/targets')).status).toBe(404);
  });

  it('sends to a delegate `target` names, marks them sent here, and refuses any other thread', T, async () => {
    const from = await H.runner.createThread({ channel: 'notes', prompt: 'hello' });
    await H.untilResults(from.id, 1);
    const to = await H.runner.createThread({ channel: 'notes', prompt: 'hello', parent_id: from.id, source: 'conductor' });
    const stranger = await H.runner.createThread({ channel: 'notes', prompt: 'hello' });
    await H.untilResults(to.id, 1);
    await H.untilResults(stranger.id, 1);
    const note = await add('look here', from.id);

    for (const target of ['nope', stranger.id]) {
      const r = await call('POST', `/threads/${from.id}/review-notes/send`, { target });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('Notes go to this thread or a thread it delegated to.');
    }
    expect(H.byKind(stranger.id, 'user')).toHaveLength(1);
    expect((await list(from.id))[0].sent_at).toBeNull();
    expect((await call('POST', `/threads/${from.id}/review-notes/send`, { target: to.id, new_delegate: true })).status).toBe(400);

    const sent = await call('POST', `/threads/${from.id}/review-notes/send`, { target: to.id });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.target).toBe(to.id);
    expect(sent.body.sent.map((n: ReviewNote) => n.id)).toEqual([note.id]);
    await H.untilResults(to.id, 2);
    const user = H.byKind(to.id, 'user').at(-1)!.p;
    expect(user.text).toBe('Address this review note on the diff.');
    expect(user.context.map((c: any) => [c.id, c.note])).toEqual([[note.id, 'look here']]);
    // The notes stay on the thread they were written on, sent; the delegate keeps none of its own.
    expect((await list(from.id))[0].sent_at).toEqual(expect.any(String));
    expect(await list(to.id)).toEqual([]);
    // Nothing went to the thread the notes came from.
    expect(H.byKind(from.id, 'user')).toHaveLength(1);
  });

  it('starts a new delegate for the notes, under this thread, with the notes as its first message', T, async () => {
    const from = await H.runner.createThread({ channel: 'notes', prompt: 'hello', title: 'Cart' });
    await H.untilResults(from.id, 1);
    const note = await add('rename sum to total', from.id);
    const request_id = '6f2c9a4e-3b1d-4c8a-9e7f-0a1b2c3d4e5f';

    const sent = await call('POST', `/threads/${from.id}/review-notes/send`, { new_delegate: true, request_id });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body).toMatchObject({ target: request_id, created: true });
    expect(sent.body.sent.map((n: ReviewNote) => n.id)).toEqual([note.id]);
    const made = H.db.threads.get(request_id)!;
    expect(made).toMatchObject({ parent_id: from.id, channel_id: 'notes', title: 'Review notes: Cart', harness: from.harness });
    await H.untilResults(made.id, 1);
    const user = H.byKind(made.id, 'user')[0].p;
    expect(user.text).toBe('Address this review note on the diff.');
    expect(user.context.map((c: any) => [c.id, c.kind, c.note])).toEqual([[note.id, 'diff_selection', 'rename sum to total']]);
    expect(H.claudeTexts(made.id)[0]).toContain("the user's note: rename sum to total");
    expect((await list(from.id))[0].sent_at).toEqual(expect.any(String));
    // It is a delegate now, so the picker offers it.
    expect((await call('GET', `/threads/${from.id}/review-notes/targets`)).body.targets.map((t: any) => t.id)).toEqual([made.id]);

    // A retry with the same id gets the same thread back and starts nothing more.
    const again = await call('POST', `/threads/${from.id}/review-notes/send`, { new_delegate: true, request_id });
    expect(again.body).toEqual({ target: made.id, sent: [], created: true });
    expect(H.db.threads.children(from.id)).toHaveLength(1);
  });

  it("starts a worktree channel's new delegate from this thread's branch, with the notes once its worktree is made", T, async () => {
    const repo = mkdtempSync(join(tmpdir(), 'omni-review-notes-wt-'));
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args]);
    git('init', '-q');
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    git('add', '.');
    git('commit', '-q', '-m', 'start');
    H.db.channels.create({ id: 'notes-wt', name: 'notes-wt', repo_path: repo, use_worktree: 1 });
    const from = await H.runner.createThread({ channel: 'notes-wt', prompt: 'hello' });
    await H.untilResults(from.id, 1);
    expect(H.thread(from.id).branch).toEqual(expect.any(String));
    await add('look at a.txt', from.id);

    const sent = await call('POST', `/threads/${from.id}/review-notes/send`, { new_delegate: true });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    await H.untilResults(sent.body.target, 1);
    expect(H.db.threadBasePicks.get(sent.body.target)).toEqual({ kind: 'ref', ref: H.thread(from.id).branch });
    expect(H.thread(sent.body.target).branch).not.toBe(H.thread(from.id).branch);
    expect(H.byKind(sent.body.target, 'user')[0].p.context.map((c: any) => c.note)).toEqual(['look at a.txt']);
  });

  it(`refuses more than ${SEND_NOTES_MAX} open notes in one send, and sends nothing`, T, async () => {
    const t = await H.runner.createThread({ channel: 'notes', prompt: 'hello' });
    await H.untilResults(t.id, 1);
    for (let i = 0; i <= SEND_NOTES_MAX; i++) await add(`note ${i}`, t.id);
    const r = await call('POST', `/threads/${t.id}/review-notes/send`, {});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/at most 40 notes/);
    expect((await list(t.id)).every((n) => n.sent_at === null)).toBe(true);
    expect(H.byKind(t.id, 'user')).toHaveLength(1);
  });

  it('goes with the thread when it is deleted', async () => {
    const t = await H.runner.createThread({ channel: 'notes', prompt: 'hello' });
    await H.untilResults(t.id, 1);
    const n = await add('gone soon', t.id);
    H.db.db.prepare('DELETE FROM threads WHERE id = ?').run(t.id);
    expect(H.db.reviewNotes.get(n.id)).toBeNull();
  });
});
