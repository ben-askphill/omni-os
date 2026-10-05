import { db, outbox, threads, type Thread } from '../../db.ts';
import { publishFeed } from '../../bus.ts';
import { claim, registerHandler } from '../apply.ts';
import { fromPortable, safeSegment, toRemote } from '../paths.ts';

// Threads: last writer wins on the whole row, except who runs it. cwd travels with the home dir as "~", through
// each Mac's path map. run_machine names the Mac running or queueing the thread (db.ts sets it with the status).

const COLUMNS = [
  'id', 'channel_id', 'title', 'status', 'role', 'model', 'harness', 'effort', 'session_id', 'has_run', 'cwd',
  'branch', 'parent_id', 'task_id', 'source', 'automation', 'last_text', 'archived', 'run_machine', 'created_at', 'updated_at',
] as const;

type Row = Thread & { run_machine: string | null };

const upsert = db.prepare(
  `INSERT INTO threads (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})
   ON CONFLICT(id) DO UPDATE SET ${COLUMNS.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`,
);
const runOf = db.prepare('SELECT status, run_machine FROM threads WHERE id = ?');

registerHandler('thread', {
  serialize(id) {
    const t = threads.get(id);
    return t ? { ...t, cwd: toRemote(t.cwd), run_machine: threads.runMachine(id) } : null;
  },
  apply(change, ctx) {
    // The id names the thread's folder here: one that would leave data/threads is dropped, not retried.
    if (!safeSegment(change.entity_id) || !claim(change)) return false;
    if (change.op === 'delete') return db.prepare('DELETE FROM threads WHERE id = ?').run(change.entity_id).changes > 0;
    // The row is the one the change names, which is also the one claim just stamped.
    const t = { harness: 'claude-code', effort: '', archived: 0, has_run: 0, run_machine: null, ...(change.data as Partial<Row>), id: change.entity_id } as Row;
    // A run this Mac has (or the other Mac thinks it has) is this Mac's to report: an edit from over there carries
    // the status it last saw, which is stale by the time it lands. Keep this Mac's status and send the row back.
    const here = runOf.get(change.entity_id) as Pick<Row, 'status' | 'run_machine'> | undefined;
    const kept = here && (t.run_machine === ctx.machineId || here.run_machine === ctx.machineId);
    const differs = kept && (t.status !== here.status || t.run_machine !== here.run_machine);
    if (kept) (t.status = here.status), (t.run_machine = here.run_machine);
    upsert.run(
      ...COLUMNS.map((c) => (c === 'cwd' ? fromPortable(t.cwd) : ((t[c] ?? null) as string | number | null))),
    );
    if (differs) outbox.requeue('thread', change.entity_id);
    return true;
  },
  notify(change) {
    const t = threads.get(change.entity_id);
    if (t) publishFeed({ type: 'thread', thread: t });
  },
});
