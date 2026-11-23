// What switching a thread's run does to its sessions. Pure, so every path is tested without a process (switch.ts applies it).
import { sameRun, type Run, type RunName, type SwitchMode } from '@omni/shared/run-switch.ts';
import type { PendingHandover, Sessions } from '../db.ts';
import { profileOf } from '../harness/profile.ts';
import { capabilitiesOf } from '../harness/registry.ts';

/** The run state of a thread, as the switch reads it. */
export interface RunState extends Run {
  id: string;
  has_run: number;
  session_id: string;
  sessions: Sessions;
  handover: PendingHandover | null;
}

export type SwitchPlan =
  | { kind: 'reject'; error: string }
  | { kind: 'none' }
  | { kind: SwitchMode; session_id: string; sessions: Sessions; handover: PendingHandover | null };

/** Said when a harness that is not switchable has no refusal of its own. */
const NOT_SWITCHABLE = 'This thread cannot move to or from its harness. Start a new thread to move its work.';

/**
 * Why the switch is refused, or null when it can go ahead. A harness whose run is fixed refuses any change, even of
 * model; one whose capabilities say it is not switchable refuses a move to or from it. An id that names no harness here
 * is not switchable either.
 */
function refusal(from: string, to: string): string | null {
  const fixed = [from, to].map(profileOf).find((p) => p.fixedRun);
  if (fixed) return fixed.switchRefusal ?? NOT_SWITCHABLE;
  if (from === to) return null;
  const locked = [from, to].find((h) => !capabilitiesOf(h)?.switchable);
  return locked ? (profileOf(locked).switchRefusal ?? NOT_SWITCHABLE) : null;
}

/**
 * The thread's sessions once it runs on `to`. `from` names the run it leaves, `lastEventId` is where its transcript
 * stands, and `hasContentSince(id)` says whether anything ran after that event (a message, a reply, a tool call).
 */
export function planSwitch(t: RunState, to: Run, from: RunName, lastEventId: number, hasContentSince: (id: number) => boolean): SwitchPlan {
  if (sameRun(t, to)) return { kind: 'none' };
  const same = { session_id: t.session_id, sessions: t.sessions, handover: t.handover };
  const refused = refusal(t.harness, to.harness);
  if (refused) return { kind: 'reject', error: refused };
  if (t.harness === to.harness) return { kind: 'settings', ...same };
  // Nothing ran yet, so there is nothing to hand over. A session id the old harness noted belongs to it: the thread id
  // is "no session yet" to every harness.
  if (!t.has_run && !t.handover) return { kind: 'settings', ...same, session_id: t.id };

  const sessions = { ...t.sessions };
  // A session that never started (a fresh handover still pending, even one that ran a command) has nothing to come back to. One resumed for a
  // handover still pending has seen only what it saw before.
  if (!t.handover) sessions[t.harness] = { id: t.session_id, seen: lastEventId };
  else if (t.handover.since > 0) sessions[t.harness] = { id: t.session_id, seen: t.handover.since };
  const origin = t.handover?.from ?? from;
  const past = sessions[to.harness];
  delete sessions[to.harness];
  if (!past) return { kind: 'handover', session_id: t.session_id, sessions, handover: { from: origin, since: 0 } };
  if (!hasContentSince(past.seen)) return { kind: 'back', session_id: past.id, sessions, handover: null };
  return { kind: 'handover', session_id: past.id, sessions, handover: { from: origin, since: past.seen } };
}
