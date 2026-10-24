import { useLayoutEffect, useRef, type RefObject } from 'react';
import { keyAtOrBefore } from '../thread-history.ts';

const FLASH_MS = 2200;

/**
 * Scrolls to a revealed event (a search hit) once its row is on screen: the row whose `data-key` is the event, else
 * the last one before it (the phone's turn that holds it). `center` puts the row in the middle, else its top at the
 * top. The row flashes, and `done` runs once, for the caller to stop following the bottom and clear the target.
 */
export function useReveal(scrollRef: RefObject<HTMLElement | null>, target: number | null, content: unknown, done: () => void, center = true) {
  const after = useRef(done);
  after.current = done;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || target === null) return;
    const rows = [...el.querySelectorAll<HTMLElement>('[data-key]')];
    const key = keyAtOrBefore(
      rows.map((r) => Number(r.dataset.key)),
      target,
    );
    const row = rows.find((r) => Number(r.dataset.key) === key);
    if (!row) return;
    const box = el.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const offset = center ? Math.max(8, (el.clientHeight - r.height) / 2) : 8;
    el.scrollTop += r.top - box.top - offset;
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), FLASH_MS);
    after.current();
  }, [target, content]); // eslint-disable-line react-hooks/exhaustive-deps
}
