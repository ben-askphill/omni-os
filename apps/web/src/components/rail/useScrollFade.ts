import { useCallback, useEffect, useRef, useState } from 'react';

/** A scroll area's mask: it fades at an edge only while content hides past it. Set `fade` as maskImage. */
export function useScrollFade<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setEdges((e) => (e.top === top && e.bottom === bottom ? e : { top, bottom }));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => (el.removeEventListener('scroll', measure), ro?.disconnect());
  }, [measure]);
  const top = edges.top ? 'transparent 0, black 28px' : 'black 0';
  const bottom = edges.bottom ? 'black calc(100% - 28px), transparent 100%' : 'black 100%';
  return { ref, fade: `linear-gradient(to bottom, ${top}, ${bottom})` };
}
