import { canSteer, type HarnessInfo, type PendingMsg, type SendMode, type Thread } from '@omni/client-core';

/** A turn is running or waiting for a slot, so a message to it steers or queues instead of starting the next turn. */
export function isBusy(thread: Pick<Thread, 'status'>): boolean {
  return thread.status === 'running' || thread.status === 'queued';
}

/** Nothing runs while the worktree is being prepared, so there is nothing to stop. */
export function canStop(thread: Pick<Thread, 'status' | 'setup'>): boolean {
  return isBusy(thread) && !thread.setup;
}

type SteerFacts = Pick<Thread, 'status' | 'harness' | 'queued_harness'>;

/**
 * Whether a message to a busy thread steers. A run switch queued behind the turn makes the message wait for it too
 * (apps/server/runner/queue.ts), so nothing steers then.
 */
export function steers(thread: SteerFacts, catalog: readonly HarnessInfo[] | null): boolean {
  return canSteer(thread.harness, catalog) && !thread.queued_harness;
}

/** The mode a send carries. Undefined on an idle thread: the server just starts the next turn. */
export function sendModeFor(thread: SteerFacts, catalog: readonly HarnessInfo[] | null): SendMode | undefined {
  if (!isBusy(thread)) return undefined;
  return steers(thread, catalog) ? 'steer' : 'queue';
}

export function composerPlaceholder(thread: SteerFacts, catalog: readonly HarnessInfo[] | null): string {
  if (!isBusy(thread)) return 'Follow up';
  return steers(thread, catalog) ? 'Steer the agent' : 'Queue for after this turn';
}

export function sendLabel(thread: SteerFacts, catalog: readonly HarnessInfo[] | null): string {
  if (!isBusy(thread)) return 'Send';
  return steers(thread, catalog) ? 'Send to the running turn' : 'Send after this turn';
}

/** The line over a pending message the agent has. Parked ones are the Resume card's (needs/parked.ts). */
export function pendingLabel(m: PendingMsg): string {
  if (m.kind === 'crew_report') return `Crew report${m.task_id ? ` ${m.task_id}` : ''}${m.role ? ` from ${m.role}` : ''}`;
  if (m.state === 'waiting') return 'Waiting for a free slot';
  if (m.state === 'held') return 'Queued, runs after this turn';
  return m.mode === 'interrupt' ? 'Interrupting, runs next' : 'Sent, the agent reads it next';
}

/** The newest user row the stream has delivered. A row for this phone's own message is one of these. */
export function latestUserRowId(rows: readonly { id: number; kind: string }[]): number | null {
  let latest: number | null = null;
  for (const r of rows) if (r.kind === 'user' && (latest === null || r.id > latest)) latest = r.id;
  return latest;
}
