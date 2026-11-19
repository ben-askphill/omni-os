// The phone stack's push and back as view transitions (index.css, "phone stack transitions"). Browsers without
// transition types keep the timed push keyframe in MobileShell.tsx.
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { parseHash, setHashChangeWrap } from '../router.ts';
import { placeEntry, stackOf } from './screens.ts';

/** The view transition type for a move of the stack: a screen pushed on, or the top one taken off. */
export type StackMove = 'push' | 'pop';

/**
 * How a hash change moves the stack, from the shown entry's place in history (`last`) and the new entry's state.
 * Null leaves it to plain rendering: a replace, a reload, or a switch between two tab roots (those fade instead).
 */
export function stackMove(from: string, to: string, last: number | null, state: unknown): StackMove | null {
  const { dir } = placeEntry(last, state);
  if (dir === 'none') return null;
  if (!stackOf(parseHash(from), from).length && !stackOf(parseHash(to), to).length) return null;
  return dir === 'forward' ? 'push' : 'pop';
}

/**
 * Whether this browser can play the moves: view transitions with types (Chrome 125, Safari 18.2, Firefox 147).
 * Safari 18.0 and 18.1 have view transitions without types, and keep the keyframe.
 */
export function canTransitionStack(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof document.startViewTransition === 'function' &&
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('selector(:active-view-transition-type(push))')
  );
}

/**
 * Starts the move's view transition, or applies the change at once when there is nothing to play. `update` renders
 * the new screens synchronously (flushSync), so the transition captures them; `animated` says which it was. A swipe
 * the browser already animated (`swiped`, iOS Safari's edge swipe) gets no second slide.
 */
export function playStackMove(move: StackMove | null, update: (animated: boolean) => void, swiped = false): void {
  if (!move || swiped || document.visibilityState === 'hidden') return update(false);
  try {
    document.startViewTransition({ update: () => update(true), types: [move] });
  } catch {
    // The router holds the change until it is applied, so it must never be dropped.
    update(false);
  }
}

/**
 * Plays a push or a back as a view transition where the browser can. The ref holds the hash
 * the last transition showed, so the shell skips its own push keyframe and fades for it; elsewhere it stays null.
 */
export function useStackTransitions(placeIndex: number) {
  const index = useRef(placeIndex);
  index.current = placeIndex;
  const played = useRef<string | null>(null);
  useEffect(() => {
    if (!canTransitionStack()) return;
    let swiped = false;
    const onPop = (e: PopStateEvent) => {
      swiped = !!(e as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition;
    };
    window.addEventListener('popstate', onPop);
    const clear = setHashChangeWrap((apply, to, from) => {
      const move = stackMove(from, to, index.current, history.state);
      const skip = swiped;
      swiped = false;
      playStackMove(
        move,
        (animated) => {
          // Set as the new screens render, not before: a render of the old ones in between keeps their state.
          played.current = animated ? window.location.hash : null;
          // Only the transition needs them on the page before it returns. A replace can come from inside an effect,
          // where flushSync cannot run.
          if (animated) flushSync(apply);
          else apply();
        },
        skip,
      );
    });
    return () => {
      clear();
      window.removeEventListener('popstate', onPop);
    };
  }, []);
  return played;
}
