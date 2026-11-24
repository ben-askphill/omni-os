import { db, now, tx } from '../connection.ts';
import { record } from '../sync.ts';

// The agents seated in a thread (ADR 0019): one row per agent per thread, the lead's included once a member is seated.
// A thread nobody was seated in has no rows: its lead is the thread's own agent (`threads.role`). Every write records
// the row for sync (sync/handlers/thread-member.ts), where the newest write of the whole row wins.

export interface MemberRow {
  /** `<thread id>:<agent id>`, the same on every machine. */
  id: string;
  thread_id: string;
  agent: string;
  /** 1 for the agent the thread started as. Fixed for the thread's life. */
  lead: number;
  /** The thread whose session this agent runs in: the thread itself for the lead, a hidden member thread otherwise. */
  session_thread: string;
  /** The uid of the last transcript row this agent has read, null before its first turn. */
  cursor: string | null;
  /** The machine this seat's client-channel threads must run on, if pinned. */
  device: string | null;
  seated_at: string;
  removed_at: string | null;
  updated_at: string;
}

const COLUMNS = 'id, thread_id, agent, lead, session_thread, cursor, seated_at, removed_at, updated_at, device';
export const memberId = (threadId: string, agent: string) => `${threadId}:${agent}`;

export const members = {
  get: (id: string) => db.prepare(`SELECT ${COLUMNS} FROM thread_members WHERE id = ?`).get(id) as MemberRow | undefined,
  /** Every agent ever seated in the thread, removed ones included, the lead first, then in the order they were seated. */
  all: (threadId: string) =>
    db.prepare(`SELECT ${COLUMNS} FROM thread_members WHERE thread_id = ? ORDER BY lead DESC, seated_at, rowid`).all(threadId) as unknown as MemberRow[],
  /** The agents seated now, the lead first. */
  seated: (threadId: string) =>
    db
      .prepare(`SELECT ${COLUMNS} FROM thread_members WHERE thread_id = ? AND removed_at IS NULL ORDER BY lead DESC, seated_at, rowid`)
      .all(threadId) as unknown as MemberRow[],
  /** The row an agent has, or had, in the thread. */
  of: (threadId: string, agent: string) => members.get(memberId(threadId, agent)),
  /** The row whose session runs in `sessionThread`: a hidden member thread's, or a lead's. */
  bySession: (sessionThread: string) =>
    db.prepare(`SELECT ${COLUMNS} FROM thread_members WHERE session_thread = ? ORDER BY removed_at IS NOT NULL, seated_at DESC LIMIT 1`).get(sessionThread) as
      | MemberRow
      | undefined,
  /** Threads with any member seated now besides the lead, for the lists' busiest-state mark. */
  groupThreads: () =>
    (db.prepare(`SELECT DISTINCT thread_id FROM thread_members WHERE lead = 0 AND removed_at IS NULL`).all() as { thread_id: string }[]).map((r) => r.thread_id),
  /** Seat `agent`, or seat it again after a removal with a new session thread. The cursor starts empty: a first turn gets the catch-up. */
  seat(threadId: string, agent: string, sessionThread: string, lead = false): MemberRow {
    return tx(() => {
      const id = memberId(threadId, agent);
      const at = now();
      db.prepare(
        `INSERT INTO thread_members (${COLUMNS}) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET session_thread = excluded.session_thread, cursor = NULL, seated_at = excluded.seated_at, removed_at = NULL, updated_at = excluded.updated_at, device = NULL`,
      ).run(id, threadId, agent, lead ? 1 : 0, sessionThread, at, at);
      record('thread_member', id);
      return members.get(id)!;
    });
  },
  setDevice(id: string, device: string | null) {
    if (db.prepare('UPDATE thread_members SET device = ?, updated_at = ? WHERE id = ? AND device IS NOT ?').run(device, now(), id, device).changes) {
      record('thread_member', id);
    }
  },
  setCursor(id: string, cursor: string | null) {
    const changed = db.prepare('UPDATE thread_members SET cursor = ?, updated_at = ? WHERE id = ? AND cursor IS NOT ?').run(cursor, now(), id, cursor).changes > 0;
    if (changed) record('thread_member', id);
  },
  remove(id: string): boolean {
    const changed = db.prepare('UPDATE thread_members SET removed_at = ?, updated_at = ? WHERE id = ? AND removed_at IS NULL AND lead = 0').run(now(), now(), id).changes > 0;
    if (changed) record('thread_member', id);
    return changed;
  },
};
