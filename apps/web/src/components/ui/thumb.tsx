import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Icon, type IconName } from './icons.tsx';

// ---------- sliding thumb (Bencho pill indicator: stretch toward the target, then settle) ----------

type Phase = 'idle' | 'stretch' | 'settle';
export interface ThumbBox {
  x: number;
  y: number;
  w: number;
  h: number;
  phase: Phase;
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Tracks the `[data-active="true"]` child of `track` and returns where the thumb should sit. */
export function useSlidingThumb(
  track: RefObject<HTMLElement | null>,
  activeKey: unknown,
  vertical = false,
  selector = ':scope > [data-active="true"], :scope > * > [data-active="true"]',
): ThumbBox | null {
  const [box, setBox] = useState<ThumbBox | null>(null);
  const last = useRef<Omit<ThumbBox, 'phase'> | null>(null);

  const measure = useCallback(() => {
    const el = track.current?.querySelector<HTMLElement>(selector);
    if (!el) return null;
    return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  }, [track, selector]);

  useLayoutEffect(() => {
    const next = measure();
    const prev = last.current;
    last.current = next;
    if (!next) return setBox(null);
    if (!prev || reducedMotion()) return setBox({ ...next, phase: 'idle' });
    if (prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h) return;
    // Stretch to cover old and new along the travel axis, then spring into place.
    const x = vertical ? next.x : Math.min(prev.x, next.x);
    const y = vertical ? Math.min(prev.y, next.y) : next.y;
    const w = vertical ? next.w : Math.max(prev.x + prev.w, next.x + next.w) - x;
    const h = vertical ? Math.max(prev.y + prev.h, next.y + next.h) - y : next.h;
    setBox({ x, y, w, h, phase: 'stretch' });
    const t = setTimeout(() => setBox({ ...next, phase: 'settle' }), 150);
    return () => clearTimeout(t);
  }, [activeKey, measure, vertical]);

  // Fonts loading, lists growing and window resizes move items: follow without animating.
  useEffect(() => {
    const el = track.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const n = measure();
      last.current = n;
      setBox(n ? { ...n, phase: 'idle' } : null);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [track, measure]);

  return box;
}

export function Thumb({ box, tone, className = '' }: { box: ThumbBox | null; tone?: 'wash'; className?: string }) {
  if (!box) return null;
  return (
    <span
      aria-hidden="true"
      className={`seg-thumb ${className}`}
      data-phase={box.phase}
      data-tone={tone}
      style={{ width: box.w, height: box.h, transform: `translate3d(${box.x}px, ${box.y}px, 0)` }}
    />
  );
}

export interface SegOption<T extends string> {
  id: T;
  label?: ReactNode;
  href?: string;
  icon?: IconName;
  badge?: ReactNode;
  title?: string;
}

/** Segmented pill with a sliding thumb. Links when options carry `href`, buttons otherwise. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  label,
  radio,
  className = '',
}: {
  options: SegOption<T>[];
  value: T;
  onChange?: (id: T) => void;
  size?: 'sm' | 'md';
  label?: string;
  /** Radio semantics for settings; tab semantics otherwise. */
  radio?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const box = useSlidingThumb(ref, value);
  return (
    <div ref={ref} role={radio ? 'radiogroup' : 'tablist'} aria-label={label} data-size={size} className={`seg ${className}`}>
      <Thumb box={box} />
      {options.map((o) => {
        const active = o.id === value;
        const common = {
          role: radio ? 'radio' : 'tab',
          'aria-selected': radio ? undefined : active,
          'aria-checked': radio ? active : undefined,
          'aria-label': o.label ? undefined : o.title,
          title: o.title,
          'data-active': active,
          className: 'seg-item',
        } as const;
        const inner = (
          <>
            {o.icon && <Icon name={o.icon} size={size === 'sm' ? 13 : 14} />}
            {o.label}
            {o.badge}
          </>
        );
        return o.href ? (
          <a key={o.id} href={o.href} {...common}>
            {inner}
          </a>
        ) : (
          <button key={o.id} type="button" onClick={() => onChange?.(o.id)} {...common}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className = '',
  size,
}: {
  tabs: { id: T; label: ReactNode; href?: string; badge?: ReactNode }[];
  value: T;
  onChange?: (id: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`scroll-thin max-w-full overflow-x-auto ${className}`}>
      <Segmented options={tabs} value={value} onChange={onChange} size={size} />
    </div>
  );
}
