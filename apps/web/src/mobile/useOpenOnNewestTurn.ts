import { useEffect, useRef, type RefObject } from 'react';
import { useReveal } from '../pages/useReveal.ts';
import { useScrollAnchor } from '../pages/useScrollAnchor.ts';
import type { useThread } from './shell.tsx';
import type { ThreadView } from './thread-view.ts';

/** The reading position of the thread screen: the scroller, and the element of the newest turn. */
export function useOpenOnNewestTurn({
  view,
  history,
  ready,
  revealTarget,
  clearReveal,
}: {
  view: ThreadView | null;
  history: ReturnType<typeof useThread>['history'];
  ready: boolean;
  revealTarget: number | null;
  clearReveal: () => void;
}): { scroll: RefObject<HTMLDivElement | null>; newest: RefObject<HTMLDivElement | null> } {
  // Outcome first: open on the newest turn, its prompt at the top, and again when a new turn starts. Earlier turns
  // loading above keep the reading position instead, and a search hit opens on the turn that holds it.
  const scroll = useRef<HTMLDivElement>(null);
  const newest = useRef<HTMLDivElement>(null);
  const newestKey = view?.turns[view.turns.length - 1]?.key ?? 0;
  useEffect(() => {
    const el = scroll.current;
    if (el && newest.current && ready && revealTarget === null) el.scrollTop = newest.current.offsetTop - el.offsetTop - 8;
  }, [ready, newestKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useScrollAnchor(scroll, view, () => false, ready);
  useReveal(scroll, revealTarget, view, clearReveal, false);
  // Held rows are bounded (#411): the oldest go freely while the newest turn is on screen, as following does on desktop.
  const { follows } = history;
  useEffect(() => {
    follows.current = () => {
      const el = scroll.current;
      const turn = newest.current;
      return !el || !turn || turn.offsetTop - el.offsetTop < el.scrollTop + el.clientHeight;
    };
  }, [follows]);
  return { scroll, newest };
}
