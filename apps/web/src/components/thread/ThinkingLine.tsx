import { useState } from 'react';
import { duration } from '../../format.ts';
import { useNow } from '../../store.tsx';
import { OmniMark } from '../brand.tsx';

/**
 * The row under a running turn: the mark thinking, the label shimmering and how long the turn has run.
 * `since` is when the turn started; without one the timer counts from when the row appeared.
 */
export function ThinkingLine({ label, since, className = 'text-[12.5px]' }: { label: string; since?: string | null; className?: string }) {
  const now = useNow(1000);
  const [mounted] = useState(() => Date.now());
  const start = since ? new Date(since).getTime() : NaN;
  const elapsed = Math.max(0, now - (Number.isFinite(start) ? start : mounted));
  return (
    <div className={`flex items-center gap-2 text-fg-3 ${className}`} role="status">
      <OmniMark size={16} state="thinking" title="Thinking" />
      <span className="shimmer-text min-w-0 truncate">{label}</span>
      <span className="shrink-0 tabular-nums">{duration(Math.floor(elapsed / 1000) * 1000)}</span>
    </div>
  );
}
