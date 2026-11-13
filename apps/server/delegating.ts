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
import { bus, publishFeed, type FeedEvent } from './bus.ts';
import { threads } from './db.ts';
import { activeTasks } from './runner/state.ts';

export type WithDelegating<T> = T & { delegating: boolean };

/** The threads whose own sub-agents still run. A team member's count for its lead too, the thread above it. */
const agentHosts = () => [...new Set(activeTasks().filter((t) => t.subagent).map((t) => t.thread_id))];

/** The ids of the threads with a delegated thread or sub-agent working below them. */
export const delegatingIds = (): ReadonlySet<string> => new Set(threads.delegating(agentHosts()));

/** The thread as the clients get it. Pass `ids` to read many with one query. */
export const withDelegating = <T extends { id: string }>(t: T, ids = delegatingIds()): WithDelegating<T> => ({ ...t, delegating: ids.has(t.id) });

/** Every thread as the clients get it, with one query. */
export function allWithDelegating<T extends { id: string }>(list: readonly T[]): WithDelegating<T>[] {
  const ids = delegatingIds();
  return list.map((t) => withDelegating(t, ids));
}

/**
 * Keeps the clients' copies current: once a burst of thread or task updates is over, each thread whose `delegating`
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
  bus.on('feed', onFeed);
  return () => bus.off('feed', onFeed);
}
