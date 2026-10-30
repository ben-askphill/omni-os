import { db, now, tx } from '../connection.ts';
import { outbox, record } from '../sync.ts';
import { kv } from './kv.ts';

// The one record of who runs a thread (docs/adr/0005-one-execution-owner.md): the machine that holds it, running or
// between turns, and a generation that counts the times it moved. Every write goes through `claim`; everything that
// decides where a message, wake, report or Stop goes reads it through apps/server/ownership.ts and
// apps/server/sync/guard.ts. The row syncs as its own entity (sync/handlers/assignment.ts), merged by generation:
// the higher one wins whatever the clocks say, so a late copy of an old owner never takes the thread back.
//
// Older builds keep `handoff.holder.<thread>` (a machine id in kv) and `runon.thread.<thread>`. `claim` writes the
// first in step with the row for them, and `get` still reads both: a kv holder that differs from the row's machine
// was written by such a build, after this row, so it is the owner, at this row's generation.

export interface Assignment {
  thread_id: string;
  /** The machine that holds the thread. */
  machine: string;
  /** How many times the thread was assigned to a different machine. A turn carries the generation it started on. */
  generation: number;
  /** The thread was sent to run on another machine (run-on.ts) or delegated: messages follow the holder wherever it goes. */
  routed: boolean;
  at: string;
}

const HOLDER = 'handoff.holder.';
const ROUTED = 'runon.thread.';
const isMachineId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(v);

type Row = { thread_id: string; machine: string; generation: number; routed: number; at: string };
const parse = (r: Row | undefined): Assignment | null => (r ? { ...r, routed: r.routed === 1 } : null);
const legacyHolder = (threadId: string) => {
  const v = kv.get<unknown>(HOLDER + threadId);
  return isMachineId(v) ? v : null;
};

export const assignments = {
  /** The row as this machine stores it, without the older builds' records. */
  stored: (threadId: string) => parse(db.prepare('SELECT thread_id, machine, generation, routed, at FROM assignments WHERE thread_id = ?').get(threadId) as Row | undefined),

  /** Who holds the thread, or null when no machine is known to (sync never set up, or it has not run since). */
  get(threadId: string): Assignment | null {
    const row = assignments.stored(threadId);
    const legacy = legacyHolder(threadId);
    if (!row) return legacy ? { thread_id: threadId, machine: legacy, generation: 0, routed: isMachineId(kv.get(ROUTED + threadId)), at: '' } : null;
    return legacy && legacy !== row.machine ? { ...row, machine: legacy } : row;
  },

  /** The machine that holds the thread, or null. */
  holder: (threadId: string) => assignments.get(threadId)?.machine ?? null,

  /**
   * Assign the thread to `machine` (this one by default): a turn starting here, a pickup, or the hub sending a new
   * thread elsewhere (`routed`). A new machine is the next generation; the same one again changes nothing, so a
   * turn on the holder never bumps it. Nothing is written while sync is not set up here.
   */
  claim(threadId: string, machine = outbox.machineId(), opts: { routed?: boolean } = {}): Assignment | null {
    if (!machine) return null;
    return tx(() => {
      const cur = assignments.get(threadId);
      const stored = assignments.stored(threadId);
      const routed = !!(opts.routed || cur?.routed);
      if (stored && stored.machine === machine && stored.routed === routed && legacyHolder(threadId) === machine) return stored;
      const generation = cur && cur.machine !== machine ? cur.generation + 1 : (cur?.generation ?? 0);
      db.prepare(
        `INSERT INTO assignments (thread_id, machine, generation, routed, at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET machine = excluded.machine, generation = excluded.generation, routed = excluded.routed, at = excluded.at`,
      ).run(threadId, machine, generation, routed ? 1 : 0, now());
      record('assignment', threadId);
      // For machines on an older build, which read only this key.
      if (legacyHolder(threadId) !== machine) kv.set(HOLDER + threadId, machine);
      return assignments.stored(threadId);
    });
  },

  /**
   * Another machine's row, from sync: kept when it is a later generation than this machine's, or the same one from
   * a machine whose id sorts first, so every machine settles on the same owner. True when it was kept.
   */
  applyRemote(a: Assignment): boolean {
    const cur = assignments.stored(a.thread_id);
    if (cur && a.generation < cur.generation) return false;
    // The same generation: the same machine only adds the routed mark; two machines tie by id.
    if (cur && a.generation === cur.generation && (a.machine === cur.machine ? !a.routed || cur.routed : a.machine > cur.machine)) return false;
    db.prepare(
      `INSERT INTO assignments (thread_id, machine, generation, routed, at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET machine = excluded.machine, generation = excluded.generation, routed = excluded.routed, at = excluded.at`,
    ).run(a.thread_id, a.machine, a.generation, a.routed ? 1 : 0, a.at);
    // The holder key agrees with the row again, whichever of the two the relay delivered first; not recorded, so nothing echoes.
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(HOLDER + a.thread_id, JSON.stringify(a.machine));
    return true;
  },
};
