// The delegate count on a Conductor thread's sidebar row: how many threads it delegated, and the one state the count
// wears. Delegated threads get no sidebar row of their own, so this count is where a stuck one shows.

/** needs: a delegated thread waits on Ben. failed: one failed and Ben has not seen it. working: one runs or queues. settled: none of those. */
export type DelegateState = 'needs' | 'failed' | 'working' | 'settled';

export interface DelegateSummary {
  /** Every delegated thread, active or finished, so a finished parent still shows its count. */
  total: number;
  /** The ones working, waiting on Ben or failed unseen. */
  active: number;
  needs: number;
  failed: number;
  state: DelegateState;
}

/** The parts of a delegated thread the count reads. */
export interface DelegateChild {
  id: string;
  status: string;
  done_at?: string | null;
  delegating?: boolean;
}

/**
 * What the needs-you inbox says about one thread: `blocked`, it waits on Ben (a question, setup, a limit, a message to
 * resend); `failed`, its newest unread result failed. Undefined when the thread is not in the inbox.
 */
export interface DelegateNeeds {
  blocked: boolean;
  failed: boolean;
}

/**
 * The parts of a thread its running state reads. `delegating`: a thread it delegated, at any depth, runs or queues.
 * The server derives it from the statuses (apps/server/delegating.ts) and sends it with every thread.
 */
export interface WorkState {
  status: string;
  delegating?: boolean;
}

/**
 * The thread shows running: its own turn runs, or a thread it delegated still works, so a Conductor job whose turn
 * ended keeps running until its crew reports back. Queued alone waits for a slot and shows as queued.
 */
export const showsRunning = (t: WorkState) => t.status === 'running' || !!t.delegating;

/** The thread is at work, for the Running lists and counts: running, queued, or waiting on a thread it delegated. */
export const isWorking = (t: WorkState) => t.status === 'running' || t.status === 'queued' || !!t.delegating;

/** The status a thread's dot, pill or label shows: running while what it delegated works, its own otherwise. */
export const shownStatus = (t: WorkState) => (t.delegating && t.status !== 'queued' ? 'running' : t.status);

const working = (c: DelegateChild) => isWorking(c);

/**
 * The count for one Conductor thread's delegated threads, or null when it delegated none. The state goes by priority:
 * needs you, then failed, then working, then settled. A thread Ben marked done never needs him. Without the inbox
 * (`needs` left out, or it does not know the thread), a failed status that is not marked done still counts as failed.
 */
export function delegateSummary(children: readonly DelegateChild[], needs?: (id: string) => DelegateNeeds | undefined): DelegateSummary | null {
  if (!children.length) return null;
  let nNeeds = 0;
  let nFailed = 0;
  let active = 0;
  let anyWorking = false;
  for (const c of children) {
    const inbox = c.done_at ? undefined : needs?.(c.id);
    const blocked = !!inbox?.blocked;
    const failed = !blocked && !c.done_at && (inbox ? inbox.failed : !needs && c.status === 'failed');
    const busy = working(c);
    if (blocked) nNeeds++;
    if (failed) nFailed++;
    if (busy) anyWorking = true;
    if (blocked || failed || busy) active++;
  }
  const state: DelegateState = nNeeds ? 'needs' : nFailed ? 'failed' : anyWorking ? 'working' : 'settled';
  return {
    total: children.length,
    active,
    needs: nNeeds,
    failed: nFailed,
    state,
  };
}

/** The tooltip and accessible label: "3 delegated threads, 2 active", with what needs Ben after it. */
export function delegateLabel(s: DelegateSummary): string {
  const parts = [`${s.total} delegated ${s.total === 1 ? 'thread' : 'threads'}`, `${s.active} active`];
  if (s.needs) parts.push(`${s.needs} ${s.needs === 1 ? 'needs' : 'need'} you`);
  if (s.failed) parts.push(`${s.failed} failed`);
  return parts.join(', ');
}

/** The delegated threads under each Conductor thread, as the channel API's `handoffs` sends them, keyed by parent id. */
export function delegatesByParent<T extends DelegateChild>(
  groups: readonly { parent: { id: string }; children: readonly T[] }[] | undefined,
): Map<string, readonly T[]> {
  return new Map((groups ?? []).map((g) => [g.parent.id, g.children]));
}

/** Every delegated thread's id: these get no sidebar row of their own. */
export function delegatedIds(groups: readonly { children: readonly { id: string }[] }[] | undefined): Set<string> {
  return new Set((groups ?? []).flatMap((g) => g.children.map((c) => c.id)));
}
