import { useState } from 'react';
import { duration } from '../../format.ts';
import { useNow } from '../../store.tsx';
import type { TurnPhase } from '@omni/shared/status.ts';
import { StatusDot } from '../ui/status.tsx';

/**
 * The row under a running turn: the dot in the turn's phase, the label shimmering and how long the turn has run.
 * `since` is when the turn started; without one the timer counts from when the row appeared.
 */
export function ThinkingLine({ label, since, phase = 'working', className = 'text-[12.5px]' }: { label: string; since?: string | null; phase?: TurnPhase; className?: string }) {
  const now = useNow(1000);
  const [mounted] = useState(() => Date.now());
  const start = since ? new Date(since).getTime() : NaN;
  const elapsed = Math.max(0, now - (Number.isFinite(start) ? start : mounted));
  return (
    <div className={`flex items-center gap-2 text-fg-3 ${className}`} role="status">
      <span className="grid w-4 shrink-0 place-items-center">
        <StatusDot status="running" phase={phase} size={8} />
      </span>
      <span className="shimmer-text min-w-0 truncate">{label}</span>
      <span className="shrink-0 tabular-nums">{duration(Math.floor(elapsed / 1000) * 1000)}</span>
    </div>
  );
}
