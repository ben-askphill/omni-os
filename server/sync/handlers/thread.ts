import { db, threads, type Thread } from '../../db.ts';
import { publishFeed } from '../../bus.ts';
import { claim, registerHandler } from '../apply.ts';
import { fromPortable, toPortable } from '../paths.ts';

// Threads: last writer wins on the whole row. cwd travels with the home dir as "~".

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
    return t ? { ...t, cwd: toPortable(t.cwd) } : null;
  },
  apply(change) {
    if (!claim(change)) return false;
    if (change.op === 'delete') return db.prepare('DELETE FROM threads WHERE id = ?').run(change.entity_id).changes > 0;
    const t = { harness: 'claude-code', effort: '', has_run: 0, ...(change.data as Partial<Thread>) } as Thread;
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
