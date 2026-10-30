// Which machine gets Ben's messages to a thread that runs on another one (run-on.ts). Apart from run-on.ts, which
// reaches the runner, so the sync handlers can ask too (sync/handlers/limit-stop.ts).
import { kv, outbox, threads, type Thread } from './db.ts';
import { inFlight } from './handoff/records.ts';

const THREAD = 'runon.thread.';
const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(v);

/** The machine a thread was sent to, when it was routed. */
export const routedTo = (threadId: string): string | null => {
  const v = kv.get<unknown>(THREAD + threadId);
  return isId(v) ? v : null;
};

/** Mark the thread as routed to `to`. Its offer goes out separately (handoff.ts sendNewThread). */
export function markRouted(threadId: string, to: string) {
  kv.set(THREAD + threadId, to);
}

/**
 * The machine that runs the thread now, when that is not this one and the thread stays there: where Ben's messages,
 * Stop and limit actions go. That is a thread this machine routed, or a delegated one, which never moves since its
 * report wakes its parent where it ran (handoff.ts refusal): one a routed parent delegated on the other machine has
 * no worktree here to run in. Null for any other thread, one taken back here, or one on its way between machines
 * (the handoff decides then).
 */
export function remoteHolder(t: Pick<Thread, 'id' | 'parent_id'>): string | null {
  const self = outbox.machineId();
  if (!self || inFlight(t.id)) return null;
  const routed = routedTo(t.id);
  if (!routed && !t.parent_id) return null;
  const holder = threads.holder(t.id) ?? routed;
  return holder && holder !== self ? holder : null;
}
