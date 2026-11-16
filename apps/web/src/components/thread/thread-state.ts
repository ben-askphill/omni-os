// What a thread's status reads as on the thread screen: the header pill (desktop and phone), the quick card's run row
// and the last run divider all take it from here, so they never disagree.
import type { Thread } from '../../api.ts';
import { PHASE, STATUS, threadGlyph, threadPhase, type Glyph, type Phase, type TurnPhase } from '@omni/shared/status.ts';
import { limitLabel } from '../../limits.ts';
import { runningLabel } from '@omni/shared/goal.ts';

export interface ThreadPill {
  glyph: Glyph;
  label: string;
  /** What the thread is doing while it is at work, for the pill's dot. */
  phase?: Phase | null;
}

export interface ThreadSeen {
  /** The agent waits on a question card. */
  asking?: boolean;
  /** The live stream dropped: what the thread does now is not known here until it is back. */
  reconnecting?: boolean;
  now?: number;
  /** What the running turn is doing, read off the thread's rows (turnPhase). */
  turn?: TurnPhase | null;
}

/** The header's pill. Lost stream first, then a pending question, then the thread's own state with its limit's time. */
export function threadPill(
  thread: Pick<Thread, 'status' | 'delegating' | 'limit_state' | 'limit_resets_at'> & Partial<Pick<Thread, 'goal_objective' | 'goal_status' | 'setup'>>,
  seen: ThreadSeen = {},
): ThreadPill {
  if (seen.reconnecting) return { glyph: 'settled', label: 'Reconnecting…' };
  if (seen.asking) return { glyph: 'needs', label: STATUS.needs.label };
  const glyph = threadGlyph(thread);
  // A turn working toward a `/goal` reads Goal, as the goal line under the transcript says.
  const phase = glyph === 'running' || glyph === 'queued' ? threadPhase(thread, seen.turn) : null;
  if (glyph === 'running' && thread.status === 'running') return { glyph, label: runningLabel(thread, phase ? PHASE[phase].label : STATUS.running.label), ...(phase && { phase }) };
  return { glyph, label: (glyph === 'limited' && limitLabel(thread, seen.now)) || (phase ? PHASE[phase].label : STATUS[glyph].label), ...(phase && { phase }) };
}
