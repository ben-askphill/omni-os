import { useEffect, useRef, useState } from 'react';

/**
 * Props for a box that scrolls on its own (a wide table, a code block, a long diff): a named region with a tab stop
 * while its content is bigger than the box, so the keyboard can scroll it. Safari does not focus a scroller by itself.
 *
 * It starts focusable, so the server markup and a browser without ResizeObserver keep the tab stop, and drops it once
 * the content is seen to fit. `axis` says which way the box scrolls.
 */
export function useScrollRegion<T extends HTMLElement>(label: string, axis: 'x' | 'both' = 'x') {
  const ref = useRef<T>(null);
  const [wide, setWide] = useState(true);
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    setWide(el.scrollWidth > el.clientWidth + 1 || (axis === 'both' && el.scrollHeight > el.clientHeight + 1));
  };
  // After every render (a streamed reply grows its table), and whenever the box or its first child resizes.
  useEffect(measure);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);
  return { ref, role: 'region', 'aria-label': label, tabIndex: wide ? 0 : undefined } as const;
}
