// What switching a thread's run does to its sessions. Pure, so every path is tested without a process (switch.ts applies it).
import { sameRun, type Run, type RunName, type SwitchMode } from '@omni/shared/run-switch.ts';
import type { PendingHandover, Sessions } from '../db.ts';

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

export const HERMES_REFUSAL =
  "Hermes runs on its own server without this thread's worktree. Start a new thread to move work to or from Hermes.";

/** A cloud agent keeps the model it was created with (a run cannot change it) and has no worktree on this Mac. */
export const CURSOR_CLOUD_REFUSAL =
  "A Cursor cloud agent keeps its model and works on its own clone of the repo. Start a new thread to change the model or move work to or from Cursor Cloud.";

/**
 * The thread's sessions once it runs on `to`. `from` names the run it leaves, `lastEventId` is where its transcript
 * stands, and `hasContentSince(id)` says whether anything ran after that event (a message, a reply, a tool call).
 */
export function planSwitch(t: RunState, to: Run, from: RunName, lastEventId: number, hasContentSince: (id: number) => boolean): SwitchPlan {
  if (sameRun(t, to)) return { kind: 'none' };
  const same = { session_id: t.session_id, sessions: t.sessions, handover: t.handover };
  if (t.harness === 'cursor-cloud' || to.harness === 'cursor-cloud') return { kind: 'reject', error: CURSOR_CLOUD_REFUSAL };
  if (t.harness === to.harness) return { kind: 'settings', ...same };
  if (t.harness === 'hermes' || to.harness === 'hermes') return { kind: 'reject', error: HERMES_REFUSAL };
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
