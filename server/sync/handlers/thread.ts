import { db, threads, type Thread } from '../../db.ts';
import { publishFeed } from '../../bus.ts';
import { claim, registerHandler } from '../apply.ts';
import { fromPortable, safeSegment, toRemote } from '../paths.ts';

// Threads: last writer wins on the whole row. cwd travels with the home dir as "~", through each Mac's path map.

const COLUMNS = [
  'id', 'channel_id', 'title', 'status', 'role', 'model', 'harness', 'effort', 'session_id', 'has_run', 'cwd',
  'branch', 'parent_id', 'task_id', 'source', 'automation', 'last_text', 'created_at', 'updated_at',
] as const;

const upsert = db.prepare(
  `INSERT INTO threads (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})
   ON CONFLICT(id) DO UPDATE SET ${COLUMNS.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`,
);

registerHandler('thread', {
  serialize(id) {
    const t = threads.get(id);
    return t ? { ...t, cwd: toRemote(t.cwd) } : null;
  },
  apply(change) {
    // The id names the thread's folder here: one that would leave data/threads is dropped, not retried.
    if (!safeSegment(change.entity_id) || !claim(change)) return false;
    if (change.op === 'delete') return db.prepare('DELETE FROM threads WHERE id = ?').run(change.entity_id).changes > 0;
    // The row is the one the change names, which is also the one claim just stamped.
    const t = { harness: 'claude-code', effort: '', has_run: 0, ...(change.data as Partial<Thread>), id: change.entity_id } as Thread;
    upsert.run(
      ...COLUMNS.map((c) => (c === 'cwd' ? fromPortable(t.cwd) : ((t[c] ?? null) as string | number | null))),
    );
    return true;
  },
  notify(change) {
    const t = threads.get(change.entity_id);
    if (t) publishFeed({ type: 'thread', thread: t });
  },
});
