import { sameRun, type Run } from '@omni/shared/run-switch.ts';
import type { TransitionKind, TransitionState } from '@omni/shared/transition.ts';
import { db, now } from '../connection.ts';

// This machine's ledger of the transitions it created through apps/server/transition.ts: what was asked, with the id
// the client reads and cancels it by. Local, never synced: what the other machines need of a relocate travels in the
// handoff records (apps/server/handoff/records.ts), a reconfigure is the thread row's `queued_*` and run columns, and
// a fork is the new thread. The service derives a transition's current state from those on every read; the state kept
// here is the last one this machine saw, for a transition whose records have since been replaced.

export interface TransitionRow {
  id: string;
  thread_id: string;
  kind: TransitionKind;
  state: TransitionState;
  /** The request as it was made, for the read to show (a reconfigure's run, a relocate's target, a fork's run). */
  request: Record<string, unknown>;
  /** What the create produced: a relocate's parties, a fork's new thread id. */
  result: Record<string, unknown>;
  error: string | null;
  created_at: string;
  updated_at: string;
}

type Raw = Omit<TransitionRow, 'request' | 'result'> & { request: string; result: string };

const parse = (r: Raw | undefined): TransitionRow | undefined =>
  r && { ...r, request: JSON.parse(r.request) as Record<string, unknown>, result: JSON.parse(r.result) as Record<string, unknown> };

export const transitions = {
  add(t: Pick<TransitionRow, 'id' | 'thread_id' | 'kind' | 'state' | 'request'> & Partial<Pick<TransitionRow, 'result' | 'error'>>): TransitionRow {
    const at = now();
    db.prepare(
      `INSERT INTO transitions (id, thread_id, kind, state, request, result, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET state = excluded.state, result = excluded.result, error = excluded.error, updated_at = excluded.updated_at`,
    ).run(t.id, t.thread_id, t.kind, t.state, JSON.stringify(t.request), JSON.stringify(t.result ?? {}), t.error ?? null, at, at);
    return transitions.get(t.id)!;
  },

  get: (id: string) => parse(db.prepare('SELECT * FROM transitions WHERE id = ?').get(id) as Raw | undefined),

  /** A thread's transitions, newest first. */
  forThread: (threadId: string, limit = 50) =>
    (db.prepare('SELECT * FROM transitions WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(threadId, limit) as unknown as Raw[]).map((r) => parse(r)!),

  /** The thread's newest transition of a kind, if any. */
  latest: (threadId: string, kind: TransitionKind) =>
    parse(db.prepare('SELECT * FROM transitions WHERE thread_id = ? AND kind = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(threadId, kind) as Raw | undefined),

  /**
   * The thread's run switches still waiting on a turn are over: the one to `applied` applied, any other was replaced,
   * dropped or cancelled (`error` says why when it was dropped). The runner calls this where the queued run changes.
   */
  settleQueued(threadId: string, applied: Run | null, error: string | null = null) {
    for (const row of transitions.forThread(threadId)) {
      if (row.kind !== 'reconfigure' || row.state !== 'queued') continue;
      const run = row.request.run as Run | undefined;
      const done = !!applied && !!run && sameRun(run, applied);
      transitions.settle(row.id, done ? 'applied' : 'cancelled', done ? null : error);
    }
  },

  /** Record where it stands now, so a later read of a superseded one still answers. */
  settle(id: string, state: TransitionState, error: string | null = null) {
    return db.prepare('UPDATE transitions SET state = ?, error = ?, updated_at = ? WHERE id = ? AND (state <> ? OR error IS NOT ?)').run(state, error, now(), id, state, error).changes > 0;
  },
};
