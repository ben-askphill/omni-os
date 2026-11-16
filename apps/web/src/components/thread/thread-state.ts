// What a thread's status reads as on the thread screen: the header pill (desktop and phone), the quick card's run row
// and the last run divider all take it from here, so they never disagree.
import type { Thread } from '../../api.ts';
import { MARK, PHASE, STATUS, markOf, threadGlyph, threadMark, threadPhase, type Glyph, type Mark, type MarkContext, type Phase, type TurnPhase } from '@omni/shared/status.ts';
import { limitLabel } from '../../limits.ts';
import { runningLabel } from '@omni/shared/goal.ts';

export interface ThreadPill {
  glyph: Glyph;
  label: string;
  /** What the thread is doing while it is at work, for the pill's dot. */
  phase?: Phase | null;
  /** The mark the pill's dot draws. */
  mark: Mark;
}

export interface ThreadSeen {
  /** The agent waits on a question card. */
  asking?: boolean;
  /** The live stream dropped: what the thread does now is not known here until it is back. */
  reconnecting?: boolean;
  now?: number;
  /** What the running turn is doing, read off the thread's rows (turnPhase). */
  turn?: TurnPhase | null;
  /** The thread's Needs you item: what holds it up names the pill. */
  need?: MarkContext['need'];
  /** The pull request on its branch: a finished thread with one open reads Ready for review. */
  pr?: MarkContext['pr'];
}

/** The header's pill. Lost stream first, then a pending question, then what holds it up, then the thread's own state with its limit's time. */
export function threadPill(
  thread: Pick<Thread, 'status' | 'delegating' | 'limit_state' | 'limit_resets_at'> & Partial<Pick<Thread, 'goal_objective' | 'goal_status' | 'setup'>>,
  seen: ThreadSeen = {},
): ThreadPill {
  if (seen.reconnecting) return { glyph: 'settled', label: 'Reconnecting…', mark: 'stopped' };
  if (seen.asking) return { glyph: 'needs', label: MARK.question.label, mark: 'question' };
  const glyph = threadGlyph(thread);
  // A turn working toward a `/goal` reads Goal, as the goal line under the transcript says.
  const phase = glyph === 'running' || glyph === 'queued' ? threadPhase(thread, seen.turn) : null;
  const mark = threadMark(thread, seen);
  // What holds it up, a folder that could not be prepared and a review say more than the thread's own status.
  if (MARK[mark].glyph !== glyph || mark === 'resuming' || mark === 'setup_failed' || mark === 'crew_failed' || mark === 'review')
    return { glyph: MARK[mark].glyph, label: (MARK[mark].glyph === 'limited' && limitLabel(thread, seen.now)) || MARK[mark].label, ...(MARK[mark].glyph === 'running' && phase && { phase }), mark };
  if (glyph === 'running' && thread.status === 'running') return { glyph, label: runningLabel(thread, phase ? PHASE[phase].label : STATUS.running.label), ...(phase && { phase }), mark: markOf(glyph, phase) };
  return { glyph, label: (glyph === 'limited' && limitLabel(thread, seen.now)) || (phase ? PHASE[phase].label : STATUS[glyph].label), ...(phase && { phase }), mark: markOf(glyph, phase) };
}
