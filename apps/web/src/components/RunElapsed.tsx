import { runElapsed } from '@omni/shared/ran-on.ts';
import { useTick } from '../clock.ts';

/** How long the thread's run has gone ("12m", "1h 05m"), ticking on the shared clock. Nothing without a start. */
export function RunElapsed({ since, className = '' }: { since: string | null | undefined; className?: string }) {
  const now = useTick();
  const text = runElapsed({ run_started_at: since }, now);
  if (!text) return null;
  return <span className={`shrink-0 font-num tabular-nums ${className}`}>{text}</span>;
}
