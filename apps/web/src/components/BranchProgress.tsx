// A delegated thread's step list in brief on its row of a delegation card (desktop web, phone web and the desktop app):
// the segmented bar the thread's own steps card has, the step it is on, and what it does now while it runs. From the
// `progress` its parent's detail and the feed carry (@omni/shared/steps.ts StepProgress). Nothing without a list.
import { progressInk, progressLine, type StepProgress } from '@omni/shared/steps.ts';
import { Ticks } from './ui.tsx';

/** Ticks per step at most: a long list keeps the bar short, each tick still one step. */
const MAX_TICKS = 12;

/** `stacked`: the bar on a line of its own above the step's words, for a narrow row beside a pill (the phone). */
export function BranchProgress({ p, stacked = false, className = '' }: { p: StepProgress; stacked?: boolean; className?: string }) {
  const line = progressLine(p);
  const ink = progressInk(p);
  return (
    <span data-progress={p.live ? 'live' : 'ended'} className={`flex min-w-0 flex-col gap-0.5 ${className}`}>
      {/* A narrow row lets the step's words take a second line rather than cut the title. */}
      <span className={`flex min-w-0 gap-2.5 ${stacked ? 'flex-col items-start gap-1' : 'items-start'}`}>
        <Ticks
          value={p.count ? p.done / p.count : 0}
          count={Math.min(MAX_TICKS, Math.max(1, p.count))}
          height={7}
          tone={ink ?? undefined}
          label={`${p.done} of ${p.count} steps done`}
          className={stacked ? 'w-20' : 'mt-[5px] w-16 shrink-0'}
        />
        <span className={`line-clamp-2 min-w-0 text-[12.5px] leading-[1.4] break-words ${p.live ? 'text-fg-2' : 'text-fg-3'}`} title={line}>
          {line}
        </span>
      </span>
      {p.now && (
        <span className="truncate text-[12px] text-fg-3" title={p.now}>
          Now: {p.now}
        </span>
      )}
    </span>
  );
}
