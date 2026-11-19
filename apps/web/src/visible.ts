// Background reads stop while nobody can see them: a hidden tab, a minimized desktop window, or a phone tab under
// another one. A `/machines` GET in the last minute keeps the server sampling CPU and RAM (apps/server/machine-stats.ts).
import { useEffect, useRef, useState } from 'react';

/** True while the tab is on screen. */
export function usePageVisible() {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/**
 * Calls `fn` every `ms` while the page is visible and `active`, and not at all otherwise. Coming back after a pause
 * calls it once at once, so what was missed shows up without waiting a whole interval. True while it runs.
 */
export function useVisibleInterval(fn: () => void, ms: number, active = true): boolean {
  const live = usePageVisible() && active;
  const call = useRef(fn);
  call.current = fn;
  const paused = useRef(false);
  useEffect(() => {
    if (!live) {
      paused.current = true;
      return;
    }
    if (paused.current) {
      paused.current = false;
      call.current();
    }
    const t = setInterval(() => call.current(), ms);
    return () => clearInterval(t);
  }, [live, ms]);
  return live;
}
