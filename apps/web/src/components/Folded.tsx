import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './ui.tsx';

/** Lines a folded message shows. */
const FOLD_LINES = 6;
/** It folds only when there are this many more, so the button never hides a line or two. */
const FOLD_SLACK = 2;

/**
 * A long message kept to its first lines, faded, with Show more and Show less under it. A delegated thread's first
 * message, the Conductor's brief, folds this way on desktop and on the phone. It goes inside the message's bubble,
 * whose line height it counts in.
 */
export function Folded({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [tall, setTall] = useState(false);
  const [open, setOpen] = useState(false);
  // Measured, not counted in characters: the lines depend on the width and the font.
  const measure = () => {
    const el = box.current;
    if (el) setTall(el.scrollHeight > parseFloat(getComputedStyle(el).lineHeight) * (FOLD_LINES + FOLD_SLACK));
  };
  useLayoutEffect(measure);
  useEffect(() => {
    const seen = new ResizeObserver(() => measure());
    if (box.current) seen.observe(box.current);
    return () => seen.disconnect();
  }, []);
  const folded = tall && !open;
  return (
    <>
      <div
        ref={box}
        className={folded ? 'overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]' : undefined}
        style={folded ? { maxHeight: `${FOLD_LINES}lh` } : undefined}
      >
        {children}
      </div>
      {tall && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="press -mb-1 flex h-8 items-center gap-1 text-[13px] leading-none font-medium whitespace-normal text-fg-2"
        >
          {open ? 'Show less' : 'Show more'}
          <Icon name="chevronDown" size={13} className={open ? 'rotate-180' : undefined} />
        </button>
      )}
    </>
  );
}
