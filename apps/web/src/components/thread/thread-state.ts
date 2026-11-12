// What a thread's status reads as on the thread screen: the header pill (desktop and phone), the quick card's run row
// and the last run divider all take it from here, so they never disagree.
import type { Thread } from '../../api.ts';
import { STATUS, threadGlyph, type Glyph } from '@omni/shared/status.ts';
import { limitLabel } from '../../limits.ts';

export interface ThreadPill {
  glyph: Glyph;
  label: string;
}

export interface ThreadSeen {
  /** The agent waits on a question card. */
  asking?: boolean;
  /** The live stream dropped: what the thread does now is not known here until it is back. */
  reconnecting?: boolean;
  now?: number;
}

/** The header's pill. Lost stream first, then a pending question, then the thread's own state with its limit's time. */
export function threadPill(thread: Pick<Thread, 'status' | 'delegating' | 'limit_state' | 'limit_resets_at'>, seen: ThreadSeen = {}): ThreadPill {
  if (seen.reconnecting) return { glyph: 'settled', label: 'Reconnecting…' };
  if (seen.asking) return { glyph: 'needs', label: STATUS.needs.label };
  const glyph = threadGlyph(thread);
  return { glyph, label: (glyph === 'limited' && limitLabel(thread, seen.now)) || STATUS[glyph].label };
}
