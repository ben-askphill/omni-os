// Reduced motion for script. CSS handles its own animations per rule (index.css); these cover what script moves.

/** True when the user asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The `behavior` for a scroll script starts: smooth, or a jump under reduced motion. */
export const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? 'auto' : 'smooth');
