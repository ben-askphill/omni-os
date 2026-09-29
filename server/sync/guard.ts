import { outbox, syncMeta, type Thread } from '../db.ts';

// Whether this machine may start a turn in a synced thread.

/**
 * True when the thread is running or queued on another machine: the last write to it came from there.
 * A new turn here would fork the session, so the runner must refuse one.
 */
export function runningElsewhere(t: Pick<Thread, 'id' | 'status'>): boolean {
  if (t.status !== 'running' && t.status !== 'queued') return false;
  const self = outbox.machineId();
  const last = syncMeta.get('thread', t.id);
  return !!self && !!last && last.machine_id !== self;
}
