import { db, outbox, syncMeta, threads, type StoredSessionState, type Thread } from '../../db.ts';
import { publishFeed } from '../../bus.ts';
import { claim, registerHandler } from '../apply.ts';
import { fromPortable, safeSegment, toRemote } from '../paths.ts';

// Threads: last writer wins on the whole row, except who runs it. cwd travels with the home dir as "~", through
// each Mac's path map. run_machine names the Mac running or queueing the thread (db.ts sets it with the status).
// folder_id travels with the row. A folder that has not arrived yet waits in sync_folder_wait, and the folder's own
// change files the thread (handlers/folder.ts). A change from an older build carries no folder_id: this Mac's stays,
// unless the thread moved channel. pinned_at and done_at travel the same way: a change without them keeps this Mac's, and so does
// auto_reason, which an older build does not send, sessions and handover (the run switch, runner/switch-plan.ts), the
// queued run (runner/switch.ts), and continued_from (a continued thread's source, apps/server/continue.ts).

const COLUMNS = [
  'id', 'channel_id', 'title', 'status', 'role', 'model', 'harness', 'effort', 'session_id', 'has_run', 'cwd',
  'branch', 'parent_id', 'task_id', 'source', 'automation', 'last_text', 'archived', 'run_machine', 'created_at', 'updated_at',
] as const;

type Row = Thread & { run_machine: string | null };

const upsert = db.prepare(
  `INSERT INTO threads (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})
   ON CONFLICT(id) DO UPDATE SET ${COLUMNS.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')},
   folder_id = CASE WHEN threads.channel_id = excluded.channel_id THEN threads.folder_id END`,
);
const runOf = db.prepare('SELECT status, run_machine FROM threads WHERE id = ?');
const folderOf = db.prepare('SELECT folder_id FROM threads WHERE id = ?');
const waitingFor = db.prepare('SELECT folder_id FROM sync_folder_wait WHERE thread_id = ?');
const setFolder = db.prepare('UPDATE threads SET folder_id = ? WHERE id = ?');
const wait = db.prepare(
  'INSERT INTO sync_folder_wait (thread_id, folder_id) VALUES (?, ?) ON CONFLICT(thread_id) DO UPDATE SET folder_id = excluded.folder_id',
);
const unwait = db.prepare('DELETE FROM sync_folder_wait WHERE thread_id = ?');
const setPinned = db.prepare('UPDATE threads SET pinned_at = ? WHERE id = ?');
const setDone = db.prepare('UPDATE threads SET done_at = ? WHERE id = ?');
const setAutoReason = db.prepare('UPDATE threads SET auto_reason = ? WHERE id = ?');
const setSessionState = db.prepare('UPDATE threads SET sessions = ?, handover = ? WHERE id = ?');
const setQueuedRun = db.prepare('UPDATE threads SET queued_harness = ?, queued_model = ?, queued_effort = ? WHERE id = ?');
const setContinuedFrom = db.prepare('UPDATE threads SET continued_from = ? WHERE id = ?');

/** Threads whose folder an applied change moved, so notify tells sidebars to regroup. */
const regrouped = new Set<string>();

/** File the thread where the change says. A folder not here yet (and not deleted here) is waited for. */
function file(id: string, channelId: string, want: string | null) {
  unwait.run(id);
  let folder: string | null = null;
  if (want) {
    const f = db.prepare('SELECT channel_id FROM folders WHERE id = ?').get(want) as { channel_id: string } | undefined;
    if (f) folder = f.channel_id === channelId ? want : null;
    else if (!syncMeta.get('folder', want)) wait.run(id, want);
  }
  setFolder.run(folder, id);
}

registerHandler('thread', {
  serialize(id) {
    const t = threads.get(id);
    if (!t) return null;
    // A folder still on its way here is where the thread is, as far as the other Mac knows.
    const waiting = (waitingFor.get(id) as { folder_id: string } | undefined)?.folder_id;
    return { ...t, ...threads.storedSessionState(id), folder_id: t.folder_id ?? waiting ?? null, cwd: toRemote(t.cwd), run_machine: threads.runMachine(id) };
  },
  apply(change, ctx) {
    // The id names the thread's folder here: one that would leave data/threads is dropped, not retried.
    if (!safeSegment(change.entity_id) || !claim(change)) return false;
    if (change.op === 'delete') {
      unwait.run(change.entity_id);
      return db.prepare('DELETE FROM threads WHERE id = ?').run(change.entity_id).changes > 0;
    }
    // The row is the one the change names, which is also the one claim just stamped.
    const t = { harness: 'claude-code', effort: '', archived: 0, has_run: 0, run_machine: null, ...(change.data as Partial<Row>), id: change.entity_id } as Row;
    // A run this Mac has (or the other Mac thinks it has) is this Mac's to report: an edit from over there carries
    // the status it last saw, which is stale by the time it lands. Keep this Mac's status and send the row back.
    const here = runOf.get(change.entity_id) as Pick<Row, 'status' | 'run_machine'> | undefined;
    const kept = here && (t.run_machine === ctx.machineId || here.run_machine === ctx.machineId);
    const differs = kept && (t.status !== here.status || t.run_machine !== here.run_machine);
    if (kept) (t.status = here.status), (t.run_machine = here.run_machine);
    const before = (folderOf.get(change.entity_id) as { folder_id: string | null } | undefined)?.folder_id ?? null;
    upsert.run(
      ...COLUMNS.map((c) => (c === 'cwd' ? fromPortable(t.cwd) : ((t[c] ?? null) as string | number | null))),
    );
    if (Object.prototype.hasOwnProperty.call(change.data ?? {}, 'folder_id')) file(change.entity_id, t.channel_id, t.folder_id ?? null);
    if (Object.prototype.hasOwnProperty.call(change.data ?? {}, 'pinned_at')) setPinned.run(t.pinned_at ?? null, change.entity_id);
    if (Object.prototype.hasOwnProperty.call(change.data ?? {}, 'done_at')) setDone.run(t.done_at ?? null, change.entity_id);
    if (Object.prototype.hasOwnProperty.call(change.data ?? {}, 'auto_reason')) setAutoReason.run(t.auto_reason ?? null, change.entity_id);
    if (Object.prototype.hasOwnProperty.call(change.data ?? {}, 'sessions')) {
      const s = change.data as Partial<StoredSessionState>;
      setSessionState.run(s.sessions ? JSON.stringify(s.sessions) : null, s.handover ? JSON.stringify(s.handover) : null, change.entity_id);
    }
    if (Object.prototype.hasOwnProperty.call(change.data ?? {}, 'queued_harness')) {
      setQueuedRun.run(t.queued_harness ?? null, t.queued_model ?? null, t.queued_effort ?? null, change.entity_id);
    }
    if (Object.prototype.hasOwnProperty.call(change.data ?? {}, 'continued_from')) setContinuedFrom.run(t.continued_from ?? null, change.entity_id);
    const after = (folderOf.get(change.entity_id) as { folder_id: string | null }).folder_id;
    if (after !== before) regrouped.add(change.entity_id);
    if (differs) outbox.requeue('thread', change.entity_id);
    return true;
  },
  notify(change) {
    const t = threads.get(change.entity_id);
    if (t) publishFeed({ type: 'thread', thread: t });
    // Folders are grouped in the channel list: open sidebars refetch it.
    if (t && regrouped.delete(change.entity_id)) publishFeed({ type: 'channel', id: t.channel_id });
  },
});
