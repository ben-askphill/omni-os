import { useLayoutEffect, useState, type RefObject } from 'react';

/** The longest an exit may hold an overlay in: past it, it goes anyway. */
const CAP_MS = 400;

/**
 * Keep an overlay in for its exit animation after `open` turns false: `shown` stays true and `closing` turns true
 * until the animations named `exit-*` on `ref` (or its `::backdrop`) finish. Mark the element `data-closing` while
 * `closing`, so index.css plays the exit and stops it taking presses, and leave it off the dismiss stack.
 *
 * The exit rules sit under `prefers-reduced-motion: no-preference`, so with Reduce motion on, or where none applies
 * (a test, an engine without `getAnimations`), there is nothing to wait for and it goes at once.
 */
export function useExit(open: boolean, ref: RefObject<Element | null>) {
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  const closing = shown && !open;

  useLayoutEffect(() => {
    if (!closing) return;
    const el = ref.current;
    const exits = (el?.getAnimations?.({ subtree: true }) ?? []).filter((a) => (a as CSSAnimation).animationName?.startsWith('exit-'));
    if (!exits.length) {
      setShown(false);
      return;
    }
    let live = true;
    const done = () => live && setShown(false);
    const cap = setTimeout(done, CAP_MS);
    void Promise.all(exits.map((a) => a.finished)).then(done, done);
    return () => {
      live = false;
      clearTimeout(cap);
    };
  }, [closing, ref]);

  return { shown: open || closing, closing };
}
