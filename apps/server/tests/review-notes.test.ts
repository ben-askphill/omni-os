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

  it('sends to the thread `target` names', T, async () => {
    const from = await H.runner.createThread({ channel: 'notes', prompt: 'hello' });
    const to = await H.runner.createThread({ channel: 'notes', prompt: 'hello' });
    await H.untilResults(from.id, 1);
    await H.untilResults(to.id, 1);
    await add('look here', from.id);
    expect((await call('POST', `/threads/${from.id}/review-notes/send`, { target: 'nope' })).status).toBe(404);
    const sent = await call('POST', `/threads/${from.id}/review-notes/send`, { target: to.id });
    expect(sent.body.target).toBe(to.id);
    await H.untilResults(to.id, 2);
    expect(H.byKind(to.id, 'user').at(-1)!.p.text).toBe('Address this review note on the diff.');
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
