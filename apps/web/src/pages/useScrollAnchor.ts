import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** The index of the first of `n` stacked rows whose bottom is below `top`, by bisection; `n` when none is. */
export function firstBelow(n: number, bottomOf: (i: number) => number, top: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bottomOf(mid) > top) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

interface Anchor {
  key: string;
  offset: number;
}

/**
 * The row of `n` stacked rows to hold in place in a view from `top` to `bottom`: the first that starts inside it,
 * else the one across its top edge; `n` when none shows. Not the row across the edge when a later one starts in
 * view: that row can still be an unrendered placeholder (.tx-row), and holding its top while it takes its real
 * height would move everything below it.
 */
export function anchorRow(n: number, topOf: (i: number) => number, bottomOf: (i: number) => number, top: number, bottom: number): number {
  const across = firstBelow(n, bottomOf, top);
  if (across >= n || topOf(across) >= top - 0.5) return across;
  return across + 1 < n && topOf(across + 1) < bottom ? across + 1 : across;
}

function measure(el: HTMLElement): Anchor | null {
  const rows = el.querySelectorAll<HTMLElement>('[data-key]');
  const box = el.getBoundingClientRect();
  const i = anchorRow(rows.length, (k) => rows[k].getBoundingClientRect().top, (k) => rows[k].getBoundingClientRect().bottom, box.top, box.bottom);
  return i < rows.length ? { key: rows[i].dataset.key ?? '', offset: rows[i].getBoundingClientRect().top - box.top } : null;
}

/**
 * Keeps what Ben reads in place when rows change above it, as browser scroll anchoring does where it exists (phone
 * Safari has none). Records the first `[data-key]` row at the scroller's top as he scrolls, and when the content
 * changes or resizes puts that row back at the same offset, unless `following()` (the view keeps to the bottom). The
 * scroller sets `overflow-anchor: none` so Chrome does not correct a second time. Its content goes in one child.
 */
export function useScrollAnchor(scrollRef: RefObject<HTMLElement | null>, content: unknown, following: () => boolean, active = true) {
  const anchor = useRef<Anchor | null>(null);
  const follow = useRef(following);
  follow.current = following;

  const restore = (el: HTMLElement) => {
    const a = anchor.current;
    if (a && !follow.current()) {
      const node = el.querySelector<HTMLElement>(`[data-key="${a.key}"]`);
      const shift = node ? node.getBoundingClientRect().top - el.getBoundingClientRect().top - a.offset : 0;
      if (Math.abs(shift) >= 1) el.scrollTop += shift;
    }
    anchor.current = measure(el);
  };
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !active) return;
    let frame: number | undefined;
    const onScroll = () => {
      frame ??= requestAnimationFrame(() => {
        frame = undefined;
        anchor.current = measure(el);
      });
    };
    anchor.current = measure(el);
    el.addEventListener('scroll', onScroll, { passive: true });
    // Rows also grow without new content: images, the markdown pass, a row opened above.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => restoreRef.current(el));
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [scrollRef, active]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && active) restore(el);
  }, [content]); // eslint-disable-line react-hooks/exhaustive-deps
}
