import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EventRow } from '../api.ts';

/**
 * Pins the transcript to the bottom while the reader is already there, including growth that
 * is not a new event (font swap, images, expanded tool rows). `active` is true once the thread
 * has loaded and the scroll nodes exist.
 */
export function useTranscriptScroll(events: EventRow[], active: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const firstScroll = useRef(true);
  const contentRef = useRef<HTMLDivElement>(null);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    nearBottom.current = near;
    if (near) setShowJump(false);
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
