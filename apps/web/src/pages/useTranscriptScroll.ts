import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EventRow } from '../api.ts';

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
 * Pins the transcript to the bottom while the reader is already there, including growth that
 * is not a new event (font swap, images, expanded tool rows). `active` is true once the thread
 * has loaded and the scroll nodes exist.
 */
export function useTranscriptScroll(events: EventRow[], active: boolean) {
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
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !events.length) return;
    if (firstScroll.current || nearBottom.current) {
      el.scrollTop = el.scrollHeight;
      firstScroll.current = false;
    } else setShowJump(true);
  }, [events]);

  return { scrollRef, contentRef, onScroll, showJump, jump, pin };
}
