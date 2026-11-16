// `--wait`: poll a thread until its turn is over, then say how it ended. Exit 0 done, 1 failed or stopped, 2 needs you.
import { OmniHttpError, type NeedsYouBlocker, type NeedsYouItem, type Thread, type ThreadOpen } from '@omni/client-core';
import type { Client } from './connection.ts';
import { EXIT, type Io } from './io.ts';
import { lastError, lastReply } from './format.ts';

export type OutcomeKind = 'done' | 'failed' | 'stopped' | 'needs-you';

export interface Outcome {
  kind: OutcomeKind;
  thread: Thread;
  reply: string;
  blockers: NeedsYouBlocker[];
  /** Why it failed, when it did. */
  error: string | null;
}

export const EXIT_OF: Record<OutcomeKind, number> = { done: EXIT.ok, failed: EXIT.failed, stopped: EXIT.failed, 'needs-you': EXIT.needsYou };

/** What the waiter knew when it started: the newest event id then, and whether it has seen the thread busy. */
export interface Seen {
  baseline: number;
  sawBusy: boolean;
}

/** Blockers that hold the thread until Ben acts, even while its turn still runs (a question waits inside the turn). */
const HOLDING = new Set<NeedsYouBlocker['kind']>(['question', 'setup', 'limited', 'recovered', 'uncertain']);

/**
 * Still going: a turn runs or waits for a slot, its worktree is being made, a message is about to start the next
 * turn, or it is on its way to the machine that will run it (a thread sent elsewhere reads `stopped` here until then).
 */
export function busy(d: Pick<ThreadOpen, 'thread' | 'pending' | 'handoff'>): boolean {
  const t = d.thread;
  if (t.status === 'queued' || t.status === 'running' || t.setup === 'preparing') return true;
  if (d.pending?.some((p) => p.state === 'waiting' || p.state === 'sent')) return true;
  return !!d.handoff && IN_FLIGHT.has(d.handoff.state.phase);
}

/** A handoff still on its way. The view stays on the thread a while after it lands, is declined or expires. */
const IN_FLIGHT = new Set(['requested', 'preparing', 'offered']);

/** How the wait ends with this reading, or null to keep waiting. */
export function settle(d: ThreadOpen, item: NeedsYouItem | null, seen: Seen): OutcomeKind | null {
  const blockers = item?.blockers ?? [];
  if (blockers.some((b) => HOLDING.has(b.kind))) return 'needs-you';
  if (busy(d)) return null;
  // The turn this wait is for has ended: it was seen running, or a result newer than the start is in, or it failed
  // before it could run. Without one of those a thread sent to another machine is not done, only not here yet.
  const ended = seen.sawBusy || d.thread.status === 'failed' || d.events.some((e) => e.kind === 'result' && e.id > seen.baseline);
  if (!ended) return null;
  if (blockers.length) return 'needs-you';
  return d.thread.status === 'done' ? 'done' : d.thread.status === 'failed' ? 'failed' : 'stopped';
}

export const newestEvent = (d: Pick<ThreadOpen, 'events'>) => d.events.reduce((max, e) => Math.max(max, e.id), 0);

/** A server that restarts mid-wait (an update) answers again within this many tries. */
const UNREACHABLE_TRIES = 60;

export async function waitFor(c: Client, io: Io, id: string, seen: Seen): Promise<Outcome> {
  let unreachable = 0;
  for (let tick = 0; ; tick++) {
    // After a sleep the server may be another one: it proves itself again before the poll gets the token.
    if (tick > 0) c.forget();
    let d: ThreadOpen;
    let needs: NeedsYouItem | null;
    try {
      const [detail, scoped] = await Promise.all([c.api.thread(id), c.api.needsYou({ thread: id })]);
      d = detail;
      needs = scoped.items.find((i) => i.thread.id === id) ?? null;
      unreachable = 0;
    } catch (err) {
      if (!(err instanceof OmniHttpError) || err.failure.kind !== 'unreachable' || ++unreachable >= UNREACHABLE_TRIES) throw err;
      await io.sleep(2000);
      continue;
    }
    if (busy(d)) seen.sawBusy = true;
    const kind = settle(d, needs, seen);
    if (kind) {
      // A failed turn's preview is the turn before it: leave it out rather than pass it off as this one's reply.
      const reply = await lastReply(c.api, id, d.events, kind === 'failed' ? null : d.thread.last_text);
      return { kind, thread: d.thread, reply, blockers: needs?.blockers ?? [], error: kind === 'failed' ? lastError(d.events) : null };
    }
    await io.sleep(tick < 30 ? 1000 : 3000);
  }
}
