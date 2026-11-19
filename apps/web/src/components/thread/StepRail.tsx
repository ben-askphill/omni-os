import { PROGRESS_MARK, progressTone } from '@omni/shared/progress-panel.ts';
import type { StepState } from '@omni/shared/steps.ts';
import { StatusDot } from '../ui.tsx';

/** How far the rail stops short of a mark's middle, so a pulsing mark has room around it. */
const GAP = 8;
const LINE = 'absolute left-1/2 w-[2px] -translate-x-1/2';

/**
 * One step's piece of the rail down a step list (the Progress card and the transcript's steps): the line above the step
 * darkens once the step is reached, the line below once it is done, so the dark part runs from the first step into the
 * mark of the step it is on. Only the step it is on carries a mark. The row lays it out as a full-height column with no
 * padding of its own; `mid` is the px from the row's top to the middle of its title's first line.
 */
export function StepRail({ state, index, count, mid, className = 'w-[15px]' }: { state: StepState; index: number; count: number; mid: number; className?: string }) {
  const tone = progressTone(state);
  const mark = PROGRESS_MARK[state];
  const gap = mark ? GAP : 0;
  return (
    <span className={`relative shrink-0 self-stretch ${className}`}>
      {index > 0 && <span aria-hidden className={`${LINE} top-0 ${tone === 'pending' ? 'bg-line' : 'bg-fg-4'} ${gap || index === count - 1 ? 'rounded-b-full' : ''}`} style={{ height: mid - gap }} />}
      {index < count - 1 && (
        <span aria-hidden className={`${LINE} bottom-0 ${tone === 'done' ? 'bg-fg-4' : 'bg-line'} ${gap || index === 0 ? 'rounded-t-full' : ''}`} style={{ top: mid + gap }} />
      )}
      {mark && (
        <span className="absolute left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center" style={{ top: mid }}>
          <StatusDot mark={mark} size={8} />
        </span>
      )}
    </span>
  );
}
