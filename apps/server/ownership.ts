// Who runs a thread, read from its assignment (db/repos/assignments.ts) and nowhere else. Every path that delivers to
// a thread asks here or sync/guard.ts, which builds on this; none assembles an answer of its own from the thread
// row, the live registry or a kv key (docs/adr/0005-one-execution-owner.md). Kept apart from run-on.ts, which
// reaches the runner, so the sync handlers can ask too; it names no machine (sync/guard.ts machineName does).
import { assignments, outbox, type Thread } from './db.ts';
import { inFlight } from './handoff/records.ts';

/** The machine that holds a thread. */
export interface Owner {
  machine: string;
  generation: number;
  /** Ben's messages follow the holder wherever it goes (a thread sent to run elsewhere, or a delegated one). */
  routed: boolean;
}

/** The thread's owner, or null when no machine is known to hold it (sync never set up, or it has not run since). */
export function ownerOf(threadId: string): Owner | null {
  const a = assignments.get(threadId);
  return a && { machine: a.machine, generation: a.generation, routed: a.routed };
}

/** The machine that holds the thread, or null. */
export const holderOf = (threadId: string): string | null => assignments.holder(threadId);

/** Another machine owns the thread, on its way or not. */
export function heldElsewhere(threadId: string): Owner | null {
  const self = outbox.machineId();
  const owner = self ? ownerOf(threadId) : null;
  return owner && owner.machine !== self ? owner : null;
}

/** Another machine owns the thread, and it is not on its way between machines (the handoff decides then). */
export const ownedElsewhere = (t: Pick<Thread, 'id'>): Owner | null => (inFlight(t.id) ? null : heldElsewhere(t.id));

/**
 * The machine that keeps Ben's messages, Stop and limit actions for a thread that stays where it is: one sent to run
 * there (run-on.ts), or a delegated one, which never moves since its report wakes its parent where it ran. Null for
 * any other thread: a reply to one of those between turns brings it here (docs/user/sync.md).
 */
export function remoteHolder(t: Pick<Thread, 'id' | 'parent_id'>): string | null {
  const owner = ownedElsewhere(t);
  return owner && (owner.routed || t.parent_id) ? owner.machine : null;
}

/**
 * The owner a turn that started here on `generation` has lost the thread to, or null while it still holds it. A
 * stale executor must not deliver, start or continue a turn (runner/queue.ts, run-on.ts fenceStale). With no
 * generation (a turn from before sync was set up) only the machine counts.
 */
export function lostTo(threadId: string, generation: number | undefined): Owner | null {
  const self = outbox.machineId();
  if (!self) return null;
  const owner = ownerOf(threadId);
  if (!owner) return null;
  if (owner.machine !== self) return owner;
  return generation !== undefined && owner.generation !== generation ? owner : null;
}

/** The hub sent a new thread to run on `machine`: it owns it from the first message, and messages follow it from then on. */
export const assignRouted = (threadId: string, machine: string) => assignments.claim(threadId, machine, { routed: true });
