import { useEffect, useRef } from 'react';

/** Whether CSS drives the fade from the scroll position itself (scroll-driven animations: Chrome 115, Safari 26). */
const cssFades = () => typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('animation-timeline: scroll()');

/**
 * A scroll area that fades at an edge only while content hides past it: put the ref and the `scroll-fade` class
 * (index.css) on it. Where CSS has scroll-driven animations the class does it all. Elsewhere this marks the edges
 * with content past them (`data-fade-start`, `data-fade-end`) as it scrolls or resizes.
 */
export function useScrollFade<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || cssFades()) return;
    const measure = () => {
      el.toggleAttribute('data-fade-start', el.scrollTop > 1);
      el.toggleAttribute('data-fade-end', el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    for (const child of el.children) ro?.observe(child);
    return () => (el.removeEventListener('scroll', measure), ro?.disconnect());
  }, []);
  return ref;
}
