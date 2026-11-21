import { progressMark, progressTone } from '@omni/shared/progress-panel.ts';
import type { StepState } from '@omni/shared/steps.ts';
import { StatusDot } from '../ui.tsx';

/** How far the rail stops short of a mark's middle, so a pulsing mark has room around it. */
const GAP = 8;
const LINE = 'absolute left-1/2 w-[2px] -translate-x-1/2';

/**
 * One step's piece of the rail down a step list (the Progress card and the transcript's steps): the dark part runs from
 * the first step into the mark of the step it is on (`reach`, progressReach), and the rail stays light past it, even
 * over a done step below it (a turn back on an earlier phase). Only the step it is on carries a mark, and once every
 * step is done (`finished`) the last one carries the done check, so a finished list ends on it. The row lays it out as
 * a full-height column with no padding of its own; `mid` is the px from the row's top to the middle of its title's
 * first line.
 */
export function StepRail({
  state,
  index,
  count,
  reach,
  mid,
  finished = false,
  className = 'w-[15px]',
}: {
  state: StepState;
  index: number;
  count: number;
  reach: number;
  mid: number;
  finished?: boolean;
  className?: string;
}) {
  const tone = progressTone(state);
  const mark = progressMark(state, { last: index === count - 1, finished });
  const gap = mark ? GAP : 0;
  // Every step above `reach` is done: a line above a step is dark down to the step it is on, one below only above it.
  const above = index <= reach && tone !== 'pending';
  const below = index < reach;
  return (
    <span className={`relative shrink-0 self-stretch ${className}`}>
      {index > 0 && <span aria-hidden className={`${LINE} top-0 ${above ? 'bg-fg-4' : 'bg-line'} ${gap || index === count - 1 ? 'rounded-b-full' : ''}`} style={{ height: mid - gap }} />}
      {index < count - 1 && (
        <span aria-hidden className={`${LINE} bottom-0 ${below ? 'bg-fg-4' : 'bg-line'} ${gap || index === 0 ? 'rounded-t-full' : ''}`} style={{ top: mid + gap }} />
      )}
      {mark && (
        <span className="absolute left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center" style={{ top: mid }}>
          <StatusDot mark={mark} size={mark === 'done' ? 12 : 8} />
        </span>
      )}
    </span>
  );
}
