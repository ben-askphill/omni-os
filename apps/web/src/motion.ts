// Reduced motion for script. CSS handles its own animations per rule (index.css); these cover what script moves.
import { useSyncExternalStore } from 'react';

let query: MediaQueryList | null | undefined;
/** The one reduced-motion query every caller shares, or null where there is no matchMedia. */
function reduceQuery(): MediaQueryList | null {
  if (query === undefined) query = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  return query;
}

/** True when the user asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  return reduceQuery()?.matches ?? false;
}

function onReduceChange(on: () => void) {
  const mq = reduceQuery();
  mq?.addEventListener('change', on);
  return () => mq?.removeEventListener('change', on);
}

/** Reduced motion, following the system setting live: its change event re-renders whoever reads it. */
export const useReducedMotion = (): boolean => useSyncExternalStore(onReduceChange, prefersReducedMotion, () => false);

/** The `behavior` for a scroll script starts: smooth, or a jump under reduced motion. */
export const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? 'auto' : 'smooth');
