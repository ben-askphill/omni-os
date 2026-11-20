import { publishFeed } from '../../bus.ts';
import { CREW_ID } from '../../crew.ts';
import { db, memberId, members, threads, type MemberRow } from '../../db.ts';
import { claim, registerHandler } from '../apply.ts';

// The agents seated in a thread (db/repos/members.ts): last writer wins on the whole row, keyed by `<thread>:<agent>`.
// Seating decides which agent's charter runs in which channel, so it is a signed action entity (sync/verify.ts): only
// a trusted machine's applies. A row whose thread or session thread has not arrived yet waits in sync_deferred. A row
// that does not parse is dropped, never written.

const isTime = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/** The thread each applied change touched, for notify. */
const threadOf = new Map<string, string>();

registerHandler('thread_member', {
  serialize(id) {
    return members.get(id) ?? null;
  },
  apply(change) {
    const id = change.entity_id;
    if (change.op === 'delete') return false;
    const d = (change.data ?? {}) as Partial<Record<keyof MemberRow, unknown>>;
    if (typeof d.thread_id !== 'string' || typeof d.agent !== 'string' || typeof d.session_thread !== 'string') return false;
    // A lead with no agent is ''; every other agent is a plain id.
    if (!(d.lead === 1 ? d.agent === '' || CREW_ID.test(d.agent) : CREW_ID.test(d.agent))) return false;
    if (id !== memberId(d.thread_id, d.agent) || !isTime(d.seated_at)) return false;
    // The lead's session is the thread's own; a member's is a hidden thread under it.
    const lead = d.lead === 1;
    if (lead !== (d.session_thread === d.thread_id)) return false;
    // Before claim, so a deferred change is not taken as the last write and skipped when it is retried.
    if (!threads.get(d.thread_id)) throw new Error(`thread ${d.thread_id} not here yet`);
    if (!lead) {
      const session = threads.get(d.session_thread);
      if (!session) throw new Error(`member thread ${d.session_thread} not here yet`);
      if (session.parent_id !== d.thread_id || session.source !== 'member') return false;
    }
    if (!claim(change)) return false;
    db.prepare(
      `INSERT INTO thread_members (id, thread_id, agent, lead, session_thread, cursor, seated_at, removed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET session_thread = excluded.session_thread, cursor = excluded.cursor,
         seated_at = excluded.seated_at, removed_at = excluded.removed_at, updated_at = excluded.updated_at`,
    ).run(
      id, d.thread_id, d.agent, lead ? 1 : 0, d.session_thread, typeof d.cursor === 'string' ? d.cursor : null, d.seated_at,
      isTime(d.removed_at) ? d.removed_at : null, isTime(d.updated_at) ? d.updated_at : change.ts,
    );
    threadOf.set(id, d.thread_id);
    return true;
  },
  notify(change) {
    const thread = threadOf.get(change.entity_id);
    threadOf.delete(change.entity_id);
    const t = thread ? threads.get(thread) : undefined;
    if (t) publishFeed({ type: 'thread', thread: t });
  },
});
