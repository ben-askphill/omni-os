import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiffSelection } from '@omni/shared/message-context-diff.ts';
import { MemoryTransport } from '../sync/transport.ts';

// Review notes between two Macs in one process, each with its own data dir, through one in-memory relay: a note
// added, edited, resolved, sent and deleted on one shows the same on the other, and open panels hear about it.

async function machine(name: string) {
  vi.resetModules();
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), `omni-sync-${name}-`));
  const db = await import('../db.ts');
  const { bus } = await import('../bus.ts');
  const sync = await import('../sync/worker.ts');
  const feed: any[] = [];
  bus.on('feed', (e) => feed.push(e));
  const worker = sync.createSyncWorker({ transport: relay, machineId: name });
  return { name, db, feed, worker };
}

const relay = new MemoryTransport();
let a: Awaited<ReturnType<typeof machine>>;
let b: Awaited<ReturnType<typeof machine>>;
const home = homedir();

async function exchange() {
  for (const m of [a, b, a]) expect((await m.worker.syncNow()).error).toBeUndefined();
}

const thread = (id: string) => ({
  id, channel_id: 'volero', title: id, status: 'done' as const, role: null, model: null, session_id: id,
  cwd: join(home, 'work', 'volero'), branch: null, parent_id: null, task_id: null, source: 'manual' as const, automation: null,
});

const anchor: DiffSelection = {
  path: 'src/cart.ts',
  old_path: null,
  side: 'new',
  start: 2,
  end: 2,
  rows: [{ kind: 'add', text: '  return items.reduce((sum, n) => sum + n, 0);', old: null, new: 2 }],
  source: { group: 'unstaged', from: 'abc1234', to: 'def5678', turn: null, blob_old: null, blob_new: null },
};

beforeAll(async () => {
  a = await machine('mac-a');
  b = await machine('mac-b');
  a.db.channels.create({ id: 'volero', name: 'Volero', kind: 'client', use_worktree: 0, base_dir: join(home, 'work') });
  a.db.threads.create(thread('t-1'));
  await exchange();
});

describe('review notes', () => {
  it('a note added on A shows on B as it was written, and open panels there refetch', async () => {
    const note = a.db.reviewNotes.create('t-1', anchor, 'name these better');
    b.feed.length = 0;
    await exchange();
    expect(b.db.reviewNotes.get(note.id)).toEqual(note);
    expect(b.feed).toContainEqual({ type: 'review_notes', thread_id: 't-1' });
  });

  it('an edit, a resolve and a send travel both ways', async () => {
    const [note] = a.db.reviewNotes.byThread('t-1');
    b.db.reviewNotes.update(note!.id, { body: 'edited on B' });
    await exchange();
    expect(a.db.reviewNotes.get(note!.id)!.body).toBe('edited on B');
    a.db.reviewNotes.markSent([note!.id]);
    await exchange();
    expect(b.db.reviewNotes.get(note!.id)!.sent_at).toEqual(a.db.reviewNotes.get(note!.id)!.sent_at);
    b.db.reviewNotes.update(note!.id, { resolved: true });
    await exchange();
    expect(a.db.reviewNotes.get(note!.id)!.resolved_at).toEqual(expect.any(String));
  });

  it('the newer of two edits wins on both Macs', async () => {
    const [note] = a.db.reviewNotes.byThread('t-1');
    a.db.reviewNotes.update(note!.id, { body: 'older, on A' });
    await new Promise((r) => setTimeout(r, 5));
    b.db.reviewNotes.update(note!.id, { body: 'newer, on B' });
    await exchange();
    expect(a.db.reviewNotes.get(note!.id)!.body).toBe('newer, on B');
    expect(b.db.reviewNotes.get(note!.id)!.body).toBe('newer, on B');
  });

  it('a delete on B deletes it on A', async () => {
    const [note] = a.db.reviewNotes.byThread('t-1');
    b.db.reviewNotes.remove(note!.id);
    a.feed.length = 0;
    await exchange();
    expect(a.db.reviewNotes.get(note!.id)).toBeNull();
    expect(a.feed).toContainEqual({ type: 'review_notes', thread_id: 't-1' });
  });

  it('a note that comes before its thread waits for it', async () => {
    // Made on A for a thread B has not had yet: the thread's row is held back until after the note goes.
    a.db.threads.create(thread('t-2'));
    const note = a.db.reviewNotes.create('t-2', anchor, 'early');
    a.db.db.prepare(`UPDATE sync_outbox SET id = id + 100000 WHERE entity = 'thread' AND entity_id = 't-2'`).run();
    await exchange();
    expect(b.db.reviewNotes.get(note.id)).toEqual(note);
  });

  it('a note with lines that do not parse is dropped, not written', async () => {
    const note = a.db.reviewNotes.create('t-1', anchor, 'fine');
    await exchange();
    a.db.db.prepare(`UPDATE review_notes SET anchor = ? WHERE id = ?`).run(JSON.stringify({ ...anchor, path: '../escape' }), note.id);
    a.db.reviewNotes.update(note.id, { body: 'still fine' });
    await exchange();
    expect(b.db.reviewNotes.get(note.id)?.body).toBe('fine');
  });
});
