// A thread is at work while a thread it delegated is, at any depth: a Conductor job whose own turn ended still shows
// running until its crew reports back. The same goes for the sub-agents its own process runs (Agent calls, workflows,
// forks, teammates): a turn that ended with them still working shows running until they finish. Derived from the
// statuses and the live tasks on each read, never stored, and sent as `delegating` on every thread the clients list,
// open or get from the feed. They read it through packages/shared/delegate-count.ts.
//
// A child that died does not pin its parent: Omni already settles a dead run's status (its exit, Stop, and the boot
// sweep in threads.failInterrupted), and the parent follows. An archived child counts for nothing. Sub-agents a
// stopped or failed turn left behind do not count, so a thread Ben stopped reads Stopped, and neither do background
// shells and monitors.
//
// A thread another machine holds has no process here, so its sub-agents come from the task rows sync brings: a
// sub-agent started there whose end has not arrived counts while its rows keep coming. One silent for
// REMOTE_TASK_STALE_MS no longer does, so a machine that died mid-run does not pin the thread on the others.
import { bus, publishFeed, SYNCED_TASK, type FeedEvent } from './bus.ts';
import { assignments, events, outbox, threads } from './db.ts';
import { activeTasks, lives } from './runner/state.ts';
import { isSubagent } from './stream.ts';
import { machineNames, ranOnFields, type MachineNames } from './ran-on.ts';
import type { StepField } from '@omni/shared/steps.ts';
import { stepField } from './step-line.ts';
import type { RanOnFields } from '@omni/shared/ran-on.ts';

/** With `delegating`, where it runs or ran and when its run started (ran-on.ts), and the step it is on (step-line.ts), for the Inbox rows. */
export type WithDelegating<T> = T & { delegating: boolean } & Required<RanOnFields> & StepField;

/** How long a sub-agent on another machine counts without a new row: its progress is stored every 20 s while it works. */
export const REMOTE_TASK_STALE_MS = 15 * 60_000;

/** The threads another machine holds whose sub-agents there still run, by their synced task rows. */
function remoteAgentHosts(at = Date.now()): string[] {
  const here = outbox.machineId();
  if (!here) return [];
  const open = events.openTasksSince(new Date(at - REMOTE_TASK_STALE_MS).toISOString());
  const ids = open.filter((t) => t.started && isSubagent(JSON.parse(t.started))).map((t) => t.thread_id);
  return [...new Set(ids)].filter((id) => !lives.has(id) && assignments.holder(id) !== here);
}

/** The threads whose own sub-agents still run, here or on another machine. A team member's count for its lead too, the thread above it. */
const agentHosts = () => [...new Set([...activeTasks().filter((t) => t.subagent).map((t) => t.thread_id), ...remoteAgentHosts()])];

/** The ids of the threads with a delegated thread or sub-agent working below them. */
export const delegatingIds = (): ReadonlySet<string> => new Set(threads.delegating(agentHosts()));

/** The thread as the clients get it. Pass `ids` and `names` to read many with one query each. */
export const withDelegating = <T extends { id: string; status?: string }>(t: T, ids = delegatingIds(), names: MachineNames = machineNames()): WithDelegating<T> => {
  const delegating = ids.has(t.id);
  return { ...t, delegating, ...ranOnFields(t, delegating, names), ...stepField(t) };
};

/** Every thread as the clients get it, with one query. */
export function allWithDelegating<T extends { id: string; status?: string }>(list: readonly T[]): WithDelegating<T>[] {
  const ids = delegatingIds();
  const names = machineNames();
  return list.map((t) => withDelegating(t, ids, names));
}

/**
 * Keeps the clients' copies current: once a burst of thread or task updates (here or synced in) is over, each thread whose `delegating`
 * changed goes out on the feed again. Waiting for the burst matters: a child that ends wakes its parent with its report in the
 * same tick, and checking in between would send the parent idle for a moment. Returns the stop.
 */
export function watchDelegating(): () => void {
  let sent = delegatingIds();
  let pending = false;
  const check = () => {
    pending = false;
    const now = delegatingIds();
    const changed = [...now].filter((id) => !sent.has(id)).concat([...sent].filter((id) => !now.has(id)));
    sent = now;
    for (const id of changed) {
      const t = threads.get(id);
      if (t) publishFeed({ type: 'thread', thread: t });
    }
  };
  // A sub-agent starting or ending arrives as a tasks update, not a thread one.
  const onFeed = (e: FeedEvent) => {
    if ((e.type !== 'thread' && e.type !== 'tasks') || pending) return;
    pending = true;
    setImmediate(check);
  };
  const onSynced = () => onFeed({ type: 'tasks', tasks: [] });
  bus.on('feed', onFeed);
  bus.on(SYNCED_TASK, onSynced);
  // Another machine's sub-agent that went silent stops counting with no row to say so.
  const stale = setInterval(onSynced, 60_000);
  stale.unref();
  return () => {
    bus.off('feed', onFeed);
    bus.off(SYNCED_TASK, onSynced);
    clearInterval(stale);
  };
}
