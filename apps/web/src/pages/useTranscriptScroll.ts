import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useScrollAnchor } from './useScrollAnchor.ts';

/** How close to the bottom counts as at it, for fractional scroll positions and zoom. */
export const BOTTOM_SLACK = 8;

/**
 * Whether the transcript follows the bottom after a scroll. Any move up leaves it, however small, so a resize
 * cannot pull Ben back down while he reads. Only reaching the bottom again (or the jump) follows again. A move
 * down that stops short of the bottom keeps the current state: it is Ben heading back, or the jump on its way.
 */
export function followAfterScroll(following: boolean, prevTop: number, top: number, gap: number): boolean {
  if (gap <= BOTTOM_SLACK) return true;
  if (top < prevTop) return false;
  return following;
}

/**
 * What the view does when the transcript changes: keep to the bottom while it follows it, or show "New activity"
 * when the thread's newest row is newer than before. Older rows loading above (`grew` false) do neither.
 */
export function onContent(first: boolean, following: boolean, grew: boolean): 'bottom' | 'pill' | 'stay' {
  if (first || following) return 'bottom';
  return grew ? 'pill' : 'stay';
}

/**
 * Pins the transcript to the bottom while the reader is already there, including growth that
 * is not a new event (font swap, images, expanded tool rows). `tailId`: the newest held event, so only rows at the
 * end count as new activity. `content`: what the transcript shows; older rows loading above keep the reading
 * position (useScrollAnchor). `active` is true once the thread has loaded and the scroll nodes exist.
 */
export function useTranscriptScroll(tailId: number, content: unknown, active: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const lastTop = useRef(0);
  const [showJump, setShowJump] = useState(false);
  const firstScroll = useRef(true);
  const contentRef = useRef<HTMLDivElement>(null);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    nearBottom.current = followAfterScroll(nearBottom.current, lastTop.current, top, el.scrollHeight - top - el.clientHeight);
    lastTop.current = top;
    if (nearBottom.current) setShowJump(false);
  };
  const jump = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    nearBottom.current = true;
    setShowJump(false);
  };
  const pin = () => {
    nearBottom.current = true;
  };
  /** Stop following the bottom: the view moved to something older on purpose (a search hit). */
  const release = () => {
    nearBottom.current = false;
    firstScroll.current = false;
  };

  useScrollAnchor(scrollRef, content, () => nearBottom.current, active);

  // Content also grows without new events (web font swap, images, expanded tool rows, the
  // markdown pass). Stay pinned to the bottom through those as long as the user was there.
  useEffect(() => {
    const el = scrollRef.current;
    const inner = contentRef.current;
    if (!el || !inner || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (nearBottom.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastTail = useRef(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !tailId) return;
    const next = onContent(firstScroll.current, nearBottom.current, tailId > lastTail.current);
    lastTail.current = Math.max(lastTail.current, tailId);
    if (next === 'bottom') {
      el.scrollTop = el.scrollHeight;
      firstScroll.current = false;
    } else if (next === 'pill') setShowJump(true);
  }, [tailId, content]);

  return { scrollRef, contentRef, onScroll, showJump, jump, pin, release };
}
