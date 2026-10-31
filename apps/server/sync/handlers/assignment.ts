import { assignments, threads, type Assignment } from '../../db.ts';
import { publishFeed } from '../../bus.ts';
import { registerHandler } from '../apply.ts';

// Who runs a thread (db/repos/assignments.ts), keyed by the thread's id. Not last-writer-wins: the row with the higher
// generation wins, whatever the clocks say, so a late copy of an old owner never takes a thread back from the machine
// it moved to. One whose thread has not arrived yet waits in sync_deferred. A move is never deleted.

const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(v);

registerHandler('assignment', {
  serialize(threadId) {
    return assignments.stored(threadId);
  },
  apply(change) {
    if (change.op === 'delete') return false;
    const d = (change.data ?? {}) as Partial<Assignment>;
    if (!isId(change.entity_id) || !isId(d.machine) || typeof d.generation !== 'number' || !Number.isInteger(d.generation) || d.generation < 0) return false;
    if (!threads.get(change.entity_id)) throw new Error(`thread ${change.entity_id} not here yet`);
    return assignments.applyRemote({ thread_id: change.entity_id, machine: d.machine, generation: d.generation, routed: !!d.routed, at: typeof d.at === 'string' ? d.at : change.ts });
  },
  notify(change) {
    // Where the thread runs changed: its Take over note and whether a turn may start here follow it.
    const t = threads.get(change.entity_id);
    if (t) publishFeed({ type: 'thread', thread: t });
  },
});
