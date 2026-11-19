// The event the thread's find bar is on (useThreadFind), for the transcript's folds: a steps card, a step's actions, a
// tool row, a long message's Show all. Each opens while the current match is inside it, so the match can be drawn and
// scrolled to, and stays open after the find moves on, as a browser's find opens a closed <details>.
import { createContext, useContext, useEffect } from 'react';
import type { ToolCall } from '@omni/shared/transcript-fold.ts';

/** The current match's event, or null while no find is on one. */
export const FindTargetCtx = createContext<number | null>(null);

/** Whether a call, or a call under it, is the event `target`: its tool_use row or its result's. */
export const callHolds = (c: ToolCall, target: number): boolean => c.event === target || c.result?.event === target || c.children.some((ch) => callHolds(ch, target));

/** Whether any of these calls holds `target`. */
export const callsHold = (calls: readonly ToolCall[], target: number | null): boolean => target !== null && calls.some((c) => callHolds(c, target));

/**
 * Opens a fold while the current match is inside it: `holds` says whether the target event is. Returns whether it is,
 * for a fold that draws open at once in the same render; `open` runs once each time the target moves in.
 */
export function useFindOpens(holds: (target: number) => boolean, open: () => void): boolean {
  const target = useContext(FindTargetCtx);
  const inside = target !== null && holds(target);
  useEffect(() => {
    if (inside) open();
  }, [inside, target]); // eslint-disable-line react-hooks/exhaustive-deps
  return inside;
}
