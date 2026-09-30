import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { ThreadStatus } from '../../../server/db.ts';
import { CHANNEL_GLYPHS, parseChannelIcon, svgDataUrl } from '../../../shared/channel-icon.ts';
import { Loader, OmniLogo } from './brand.tsx';

export { Loader } from './brand.tsx';

// ---------- icons (hand-drawn, 24px grid, 1.75 stroke, round caps and joins) ----------

const PATHS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  x: 'M18 6 6 18M6 6l12 12',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  plus: 'M12 5v14M5 12h14',
  chevronRight: 'm9 18 6-6-6-6',
  chevronDown: 'm6 9 6 6 6-6',
  chevronLeft: 'm15 18-6-6 6-6',
  stop: 'M7 7h10v10H7z',
  send: 'M12 19V5M5 12l7-7 7 7',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  check: 'M20 6 9 17l-5-5',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  panel: 'M3 5h18v14H3zM15 5v14',
  branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  pr: 'M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM13 6h3a2 2 0 0 1 2 2v7M6 9v12',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M16 9.5h.01',
  paperclip: 'M21 11.5 12.2 20.3a5.5 5.5 0 0 1-7.8-7.8l8.9-8.8a3.7 3.7 0 0 1 5.2 5.2l-8.8 8.8a1.8 1.8 0 0 1-2.6-2.6l8.1-8.1',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  terminal: 'm4 17 6-6-6-6M12 19h8',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  play: 'M7 4v16l13-8z',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  key: 'M3 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M11 12h10M17 12v3M20 12v2',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9z',
  layers: 'm12 2 10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5',
  hash: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  maximize: 'M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  tool: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16v-4M12 8h.01',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  home: 'M3 10.5 12 3l9 7.5M5 9v12h14V9',
  message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  // Omni additions, same grid and stroke.
  delegate: 'M3 12h4M7 12c3 0 3-6 7-6h7M7 12c3 0 3 6 7 6h7M7 12h14',
  switchboard: 'M3 6h18M3 12h18M3 18h18M8 4v4M15 10v4M6 16v4',
  split: 'M3 5h18v14H3zM12 5v14',
  sidebar: 'M3 5h18v14H3zM9 5v14',
  browser: 'M3 5h18v14H3zM3 9h18',
  gauge: 'M4 18a8 8 0 0 1 16 0M12 18l4-5',
  pause: 'M9 5v14M15 5v14',
  diff: 'M12 3v8M8 7h8M8 17h8M5 21h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className = '', strokeWidth = 1.75 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  if (name === 'more') strokeWidth = 3;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The continuous-line "omni" wordmark. */
export function Wordmark({ size = 18 }: { size?: number }) {
  return <OmniLogo height={size} />;
}

// ---------- buttons ----------

type Variant = 'primary' | 'secondary' | 'ghost' | 'needs';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-fg text-on-ink hover:bg-fg/88 disabled:opacity-35',
  secondary: 'bg-surface-2 text-fg hover:bg-surface-3 disabled:opacity-45',
  ghost: 'hov text-fg-2 hover:text-fg disabled:opacity-40',
  // Destructive or blocking actions: vermilion fill with ink text, never vermilion text.
  needs: 'bg-needs text-on-needs hover:bg-[color-mix(in_srgb,var(--needs)_90%,var(--fg))] disabled:opacity-40',
};

const SIZES = {
  sm: 'h-7 px-3 text-[12.5px] gap-1.5',
  md: 'h-[34px] px-4 text-[13px] gap-2',
  lg: 'h-11 px-5 text-[14px] gap-2',
};

const btnBase = 'press inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap transition-[background-color,color,opacity,transform] duration-200 select-none';

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className = '',
  busy,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: IconName; busy?: boolean }) {
  return (
    <button type="button" {...rest} disabled={rest.disabled || busy} className={`${btnBase} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}>
      {busy ? <Loader size={size === 'sm' ? 12 : 14} /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 15} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className = '',
  size = 16,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; size?: number; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-on={active || undefined}
      {...rest}
      className={`hov press inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-3 transition-colors hover:text-fg disabled:opacity-40 data-[on=true]:text-fg ${className}`}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export function IconLink({ href, icon, label, size = 15, download, newTab, className = '' }: { href: string; icon: IconName; label: string; size?: number; download?: boolean; newTab?: boolean; className?: string }) {
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      download={download || undefined}
      target={newTab ? '_blank' : undefined}
      rel={newTab ? 'noopener noreferrer' : undefined}
      className={`hov press inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-3 transition-colors hover:text-fg ${className}`}
    >
      <Icon name={icon} size={size} />
    </a>
  );
}

export function LinkButton({ href, icon, children, className = '', variant = 'secondary', size = 'md', target }: { href: string; icon?: IconName; children?: ReactNode; className?: string; variant?: Variant; size?: 'sm' | 'md' | 'lg'; target?: string }) {
  return (
    <a href={href} target={target} rel={target ? 'noopener noreferrer' : undefined} className={`${btnBase} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 15} />}
      {children}
    </a>
  );
}

// ---------- status ----------

export const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  imported: 'Imported',
  needs: 'Needs you',
  settled: 'Done',
  idle: 'Idle',
};

export type Glyph = 'running' | 'needs' | 'done' | 'settled' | 'idle' | 'queued';

/** Thread status to the glyph it draws: a failure needs you, a stop just settles. */
export function glyphFor(status: ThreadStatus | string | null | undefined): Glyph {
  switch (status) {
    case 'running':
    case 'needs':
    case 'done':
    case 'settled':
    case 'queued':
    case 'idle':
      return status;
    case 'failed':
      return 'needs';
    case 'imported':
      return 'idle';
    default:
      return 'settled';
  }
}

export function StatusDot({ status, size = 8, className = '' }: { status: ThreadStatus | Glyph | string | null | undefined; size?: number; className?: string }) {
  const s = glyphFor(status);
  return (
    <span title={STATUS_LABEL[status ?? 'imported'] ?? status ?? undefined} data-s={s} className={`glyph ${className}`} style={{ width: size, height: size }}>
      {s === 'running' && <i className="ping" />}
      <i />
    </span>
  );
}

export function StatusPill({ status, label }: { status: string; label?: ReactNode }) {
  return (
    <span role="status" data-s={glyphFor(status)} className="spill">
      <StatusDot status={status} size={6} />
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  );
}

export type ChipTone = 'default' | 'outline' | 'ink' | 'live' | 'needs' | 'done';

export function Chip({ children, tone = 'default', className = '', title }: { children: ReactNode; tone?: ChipTone; className?: string; title?: string }) {
  const tones: Record<ChipTone, string> = {
    default: 'bg-surface-2 text-fg-2',
    outline: 'shadow-[inset_0_0_0_1px_var(--line-strong)] text-fg-3',
    ink: 'bg-fg text-on-ink',
    live: 'bg-live text-on-live',
    needs: 'bg-needs text-on-needs',
    done: 'bg-done text-on-done',
  };
  return (
    <span title={title} className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium leading-none tracking-normal ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

// Every icon a channel can pick is one this file draws.
const _channelGlyphsDrawn: readonly IconName[] = CHANNEL_GLYPHS;

/** A channel's own icon (an emoji, a design system icon or an uploaded SVG), or nothing when it has none. */
export function ChannelMark({ icon, size }: { icon: string | null | undefined; size: number }) {
  const mark = parseChannelIcon(icon);
  if (!mark) return null;
  if (mark.kind === 'glyph') return <Icon name={mark.name} size={size} />;
  // An image, never markup in the page: the SVG cannot run anything or load from elsewhere.
  if (mark.kind === 'svg') return <img src={svgDataUrl(mark.markup)} alt="" draggable={false} className="object-contain" style={{ width: size, height: size }} />;
  return <span className="leading-none" style={{ fontSize: size }}>{mark.text}</span>;
}

/** Letter avatar for channels and roles: neutral surface, SF Rounded. No per-name hue. A channel's own icon replaces the letter. */
export function Avatar({ name, size = 28, icon, channelIcon, ink, className = '' }: { name: string; size?: number; icon?: IconName; channelIcon?: string | null; ink?: boolean; className?: string }) {
  const mark = parseChannelIcon(channelIcon);
  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center rounded-full font-rounded font-medium uppercase leading-none ${ink ? 'bg-fg text-on-ink' : 'bg-surface-2 text-fg-2'} ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {icon ? (
        <Icon name={icon} size={size * 0.5} />
      ) : mark ? (
        <ChannelMark icon={channelIcon} size={size * { glyph: 0.5, emoji: 0.52, svg: 0.58 }[mark.kind]} />
      ) : (
        name.replace(/[^a-z0-9]/gi, '').slice(0, 1) || '?'
      )}
    </span>
  );
}

// ---------- feedback ----------

export function ErrorNote({ children, onRetry, className = '' }: { children: ReactNode; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={`flex items-start gap-2.5 rounded-2xl bg-surface px-4 py-2.5 text-[13px] text-fg ${className}`}>
      <StatusDot status="needs" size={8} className="mt-[5px]" />
      <div className="min-w-0 flex-1 break-words whitespace-pre-wrap">{children}</div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 font-medium underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children, icon, action }: { title: string; children?: ReactNode; icon?: IconName; action?: ReactNode }) {
  return (
    <div className="fade-in flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && (
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-fg-3">
          <Icon name={icon} size={19} />
        </div>
      )}
      <div className="font-display text-[17px]">{title}</div>
      {children && <div className="mt-1.5 max-w-sm text-[13px] text-fg-3">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-6 text-[13px] text-fg-3">
      <Loader /> {label}
    </div>
  );
}

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

// ---------- modal / confirm ----------

export function Modal({ open, onClose, children, title, wide }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus], button, input, select, textarea')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="scrim fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={`modal-in max-h-[92vh] w-full overflow-auto rounded-t-[28px] bg-elev pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-menu)] sm:rounded-[28px] sm:pb-0 ${wide ? 'sm:max-w-5xl' : 'sm:max-w-md'}`}
      >
        {title && (
          <div className="flex items-center justify-between gap-3 py-3 pr-3 pl-6">
            <div className="min-w-0 font-display text-[16px]">{title}</div>
            <IconButton icon="x" label="Close" onClick={onClose} />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={busy ? () => {} : onCancel} title={title}>
      <div className="space-y-3 px-6 pt-1 pb-4 text-[13.5px] text-fg-2">{children}</div>
      {error && <ErrorNote className="mx-6 mb-3">{error}</ErrorNote>}
      <div className="flex justify-end gap-2 px-5 pt-1 pb-5">
        {/* Focus starts on Cancel: every confirm here is destructive, so a stray Enter must not fire it. */}
        <Button variant="secondary" onClick={onCancel} disabled={busy} data-autofocus>
          Cancel
        </Button>
        <Button variant={danger ? 'needs' : 'primary'} onClick={onConfirm} busy={busy}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

// ---------- inline confirm with undo (Bencho "say") ----------

type SayPhase = 'idle' | 'asking' | 'busy' | 'pending' | 'done';

/**
 * A pill that asks in place. With `undoMs`, confirming shows an Undo button with a burning fuse and
 * `onConfirm` only runs once the fuse is out (or the component unmounts). Without it, `onConfirm`
 * runs right away. Errors are the caller's to surface; the pill resets to idle.
 */
export function InlineConfirm({
  label,
  icon,
  confirmLabel,
  cancelLabel = 'Cancel',
  doneLabel,
  busyLabel,
  undoMs,
  needs = true,
  disabled,
  onConfirm,
  className = '',
}: {
  label: ReactNode;
  icon?: IconName;
  confirmLabel: string;
  cancelLabel?: string;
  doneLabel?: string;
  busyLabel?: string;
  undoMs?: number;
  needs?: boolean;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
  className?: string;
}) {
  const [phase, setPhase] = useState<SayPhase>('idle');
  const [width, setWidth] = useState<number | undefined>(undefined);
  const shell = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const run = useRef(onConfirm);
  run.current = onConfirm;
  const pending = useRef(false);

  const fire = useCallback(async () => {
    pending.current = false;
    setPhase('busy');
    try {
      await run.current();
      setPhase(doneLabel ? 'done' : 'idle');
    } catch {
      setPhase('idle');
    }
  }, [doneLabel]);

  // Measure the visible row so the shell can spring between widths.
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const set = () => setWidth(el.scrollWidth);
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase]);

  useEffect(() => {
    if (phase === 'asking') cancelRef.current?.focus();
    if (phase !== 'asking') return;
    const onDown = (e: MouseEvent) => !shell.current?.contains(e.target as Node) && setPhase('idle');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPhase('idle');
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'pending' || !undoMs) return;
    pending.current = true;
    const t = setTimeout(() => void fire(), undoMs);
    return () => clearTimeout(t);
  }, [phase, undoMs, fire]);

  // Leaving the page mid-fuse still commits, the way mail clients handle "undo send".
  useEffect(
    () => () => {
      if (pending.current) void run.current();
    },
    [],
  );

  useEffect(() => {
    if (phase !== 'done') return;
    const t = setTimeout(() => setPhase('idle'), 2400);
    return () => clearTimeout(t);
  }, [phase]);

  const confirm = () => (undoMs ? setPhase('pending') : void fire());

  let content: ReactNode;
  if (phase === 'asking') {
    content = (
      <>
        <button ref={cancelRef} type="button" className="say-btn" onClick={() => setPhase('idle')}>
          {cancelLabel}
        </button>
        <span className="say-seam" />
        <button type="button" className="say-btn" data-needs={needs || undefined} onClick={confirm}>
          {confirmLabel}
        </button>
      </>
    );
  } else if (phase === 'busy') {
    content = (
      <span className="say-done">
        <Loader size={13} /> {busyLabel ?? `${confirmLabel}…`}
      </span>
    );
  } else if (phase === 'pending' || phase === 'done') {
    content = (
      <>
        <span className="say-done">
          <Icon name="check" size={14} /> {doneLabel ?? 'Done'}
        </span>
        {phase === 'pending' && (
          <button
            type="button"
            className="say-undo"
            onClick={() => {
              pending.current = false;
              setPhase('idle');
            }}
          >
            <Icon name="undo" size={13} /> Undo
            <span className="say-fuse" style={{ animationDuration: `${undoMs}ms` }} />
          </button>
        )}
      </>
    );
  } else {
    content = (
      <button type="button" className="say-btn" disabled={disabled} onClick={() => setPhase('asking')}>
        {icon && <Icon name={icon} size={14} />}
        {label}
      </button>
    );
  }

  return (
    <div ref={shell} className={`say ${disabled ? 'opacity-45' : ''} ${className}`} style={{ width }} aria-live="polite">
      <div ref={row} className="say-row">
        {content}
      </div>
    </div>
  );
}

// ---------- slide to confirm (Bencho "sld") ----------

const GRIP = 48;

export function SlideToConfirm({
  label,
  doneLabel = 'Done',
  busyLabel,
  disabled,
  onConfirm,
  className = '',
}: {
  label: string;
  doneLabel?: string;
  busyLabel?: string;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [held, setHeld] = useState(false);
  const [spring, setSpring] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle');
  const start = useRef(0);

  const max = () => Math.max(0, (track.current?.clientWidth ?? 0) - GRIP - 8);

  const complete = async () => {
    setSpring(true);
    setX(max());
    setPhase('busy');
    try {
      await onConfirm();
      setPhase('done');
    } catch {
      setPhase('idle');
      setX(0);
    }
  };

  const release = () => {
    if (!held) return;
    setHeld(false);
    if (x >= max() * 0.9) void complete();
    else {
      setSpring(true);
      setX(0);
    }
  };

  const locked = disabled || phase !== 'idle';
  const m = max() || 1;
  const progress = Math.min(1, x / m);

  return (
    <div ref={track} className={`sld ${disabled ? 'opacity-45' : ''} ${className}`} data-held={held || undefined} data-done={phase === 'done' || undefined}>
      {phase === 'done' ? (
        <div className="sld-done">
          <Icon name="check" size={16} /> {doneLabel}
        </div>
      ) : (
        <>
          <div className="sld-wash" data-spring={spring || undefined} style={{ width: x + GRIP }} />
          <div className="sld-say" style={{ opacity: phase === 'busy' ? 1 : 1 - progress * 1.4 }}>
            {phase === 'busy' ? (
              <span className="inline-flex items-center gap-2 text-fg-2">
                <Loader size={14} /> {busyLabel ?? 'Working'}
              </span>
            ) : (
              label
            )}
          </div>
          <button
            type="button"
            className="sld-grip"
            aria-label={label}
            disabled={locked}
            data-spring={spring || undefined}
            style={{ transform: `translate3d(${x}px, 0, 0)` }}
            onPointerDown={(e) => {
              if (locked) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              start.current = e.clientX - x;
              setSpring(false);
              setHeld(true);
            }}
            onPointerMove={(e) => held && setX(Math.max(0, Math.min(max(), e.clientX - start.current)))}
            onPointerUp={release}
            onPointerCancel={release}
            onKeyDown={(e) => {
              if (locked) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void complete();
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                setSpring(true);
                const nx = Math.min(max(), x + max() / 4);
                setX(nx);
                if (nx >= max()) void complete();
              } else if (e.key === 'ArrowLeft' || e.key === 'Escape') {
                setSpring(true);
                setX(0);
              }
            }}
          >
            {phase === 'busy' ? <Loader size={16} /> : <Icon name="arrowRight" size={18} strokeWidth={2} />}
          </button>
        </>
      )}
    </div>
  );
}

// ---------- picker (Bencho "pik") ----------

export interface PickerOption<T extends string> {
  value: T;
  label: string;
  sub?: string;
  icon?: IconName;
  /** Letter avatar seed; defaults to the label. Set `avatar: false` to hide it. */
  avatar?: string | false;
  /** A channel icon for the avatar in place of the letter. */
  channelIcon?: string | null;
  /** A mark to lead with instead of the avatar (a HarnessLogo or CrewMark). */
  lead?: ReactNode;
}

export function Picker<T extends string>({
  value,
  options,
  onChange,
  label,
  prefix,
  searchable,
  disabled,
  className = '',
  align = 'left',
}: {
  value: T;
  options: PickerOption<T>[];
  onChange: (v: T) => void;
  label: string;
  prefix?: ReactNode;
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [q, setQ] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(s)) : options;
  }, [options, q]);
  const canSearch = searchable ?? options.length > 7;

  const openMenu = () => {
    if (disabled) return;
    const r = btn.current?.getBoundingClientRect();
    const need = Math.min(options.length * 44 + (canSearch ? 52 : 0) + 16, 340);
    setUp(!!r && window.innerHeight - r.bottom < need && r.top > window.innerHeight - r.bottom);
    setQ('');
    setCursor(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  const pick = (o: PickerOption<T>) => {
    onChange(o.value);
    close();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && close(false);
    document.addEventListener('mousedown', onDown);
    if (!canSearch) list.current?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, canSearch]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(shown.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = shown[cursor];
      if (o) pick(o);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') close(false);
  };

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <button
        ref={btn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? 'none'}`}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            openMenu();
          }
        }}
        className="press inline-flex h-8 max-w-full items-center gap-2 rounded-full bg-surface-2 pr-2.5 pl-1 text-[12.5px] font-medium text-fg transition-colors hover:bg-surface-3 disabled:opacity-45"
      >
        {current?.lead ? (
          <span className="grid h-6 w-6 place-items-center rounded-full bg-bg text-fg">{current.lead}</span>
        ) : current && current.avatar !== false ? (
          <Avatar name={current.avatar || current.label} icon={current.icon} channelIcon={current.channelIcon} size={24} />
        ) : current?.icon ? (
          <span className="grid h-6 w-6 place-items-center text-fg-3">
            <Icon name={current.icon} size={14} />
          </span>
        ) : (
          <span className="w-1.5" />
        )}
        {prefix && <span className="-mr-1 text-fg-4">{prefix}</span>}
        <span className="min-w-0 truncate">{current?.label ?? 'Choose'}</span>
        <Icon name="chevronDown" size={13} className="pik-chev text-fg-4" />
      </button>
      {open && (
        <div
          className={`pik-card w-[min(300px,calc(100vw-32px))] ${up ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'} ${align === 'right' ? 'right-0' : 'left-0'}`}
          data-up={up || undefined}
          onKeyDown={onKey}
        >
          {canSearch && (
            <label className="mb-1 flex h-10 items-center gap-2 rounded-2xl bg-surface px-3 text-fg-4">
              <Icon name="search" size={14} />
              <input
                autoFocus
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setCursor(0);
                }}
                placeholder={`Find ${label.toLowerCase()}`}
                aria-label={`Find ${label.toLowerCase()}`}
                className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-4"
              />
            </label>
          )}
          <div ref={list} role="listbox" aria-label={label} tabIndex={-1} className="scroll-thin max-h-[280px] overflow-y-auto outline-none">
            {shown.map((o, i) => (
              <button
                key={o.value}
                type="button"
                role="option"
                data-i={i}
                aria-selected={o.value === value}
                data-cursor={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onClick={() => pick(o)}
                className="pik-row"
              >
                {o.lead ? (
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-fg">{o.lead}</span>
                ) : o.avatar !== false ? (
                  <Avatar name={o.avatar || o.label} icon={o.icon} channelIcon={o.channelIcon} size={28} />
                ) : o.icon ? (
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-2 text-fg-3">
                    <Icon name={o.icon} size={14} />
                  </span>
                ) : null}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] text-fg">{o.label}</span>
                  {o.sub && <span className="truncate text-[11.5px] text-fg-4">{o.sub}</span>}
                </span>
                <span className="pik-mark">
                  {o.value === value && <Icon name="check" size={12} strokeWidth={2.6} />}
                </span>
              </button>
            ))}
            {!shown.length && <div className="px-3 py-3 text-[12.5px] text-fg-4">No match</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- ticks and checklist ----------

/** Usage as a row of ticks (Bencho "tick"). `value` is 0..1. */
export function Ticks({ value, count = 24, height = 14, tone, label, className = '' }: { value: number; count?: number; height?: number; tone?: 'needs'; label?: string; className?: string }) {
  const v = Math.max(0, Math.min(1, value));
  const on = v > 0 ? Math.max(1, Math.round(v * count)) : 0;
  const style = { '--ticks-h': `${height}px`, '--tick-on': tone === 'needs' ? 'var(--needs)' : 'var(--fg)' } as CSSProperties;
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} className={`ticks ${className}`} style={style}>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} data-on={i < on || undefined} />
      ))}
    </div>
  );
}

/** One animated to-do row (Bencho "chk"): box fills, tick draws, the label gets struck through. */
export function CheckItem({ state, children }: { state: 'pending' | 'in_progress' | 'completed' | string; children: ReactNode }) {
  return (
    <div data-state={state} className="flex items-start gap-2.5 py-[3px]">
      <span className="chk-box mt-[1px]">
        <span className="chk-fill" />
        <svg viewBox="0 0 24 24" className="chk-tick" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
        {state === 'in_progress' && <span className="pulse absolute h-[7px] w-[7px] rounded-full bg-live" />}
      </span>
      <span className={`min-w-0 text-[13.5px] leading-[1.4] ${state === 'in_progress' ? 'font-medium text-fg' : 'text-fg-2'}`}>
        <span className="chk-say">{children}</span>
      </span>
    </div>
  );
}

// ---------- misc ----------

export function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API needs a secure context; fall back for plain http over Tailscale.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* ignore */
      }
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1400);
  };
  return (
    <Button size="sm" variant="secondary" icon={done ? 'check' : 'copy'} onClick={copy} className={className}>
      {done ? 'Copied' : label}
    </Button>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className="tgl">
      <span className="tgl-knob" />
    </button>
  );
}

/** `width` matches the page body's max width so the title lines up with the content under it. */
export function PageHeader({ title, subtitle, actions, children, eyebrow, width = '' }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode; eyebrow?: ReactNode; width?: string }) {
  return (
    <div className={`mx-auto px-4 pt-6 pb-4 md:px-8 md:pt-10 ${width}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <div className="caption mb-2.5">{eyebrow}</div>}
          <h1 className="truncate font-display text-[26px] leading-[1.1] md:text-[30px]">{title}</h1>
          {subtitle && <div className="mt-1.5 max-w-xl text-[13.5px] text-fg-3">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Label({ children, hint, htmlFor }: { children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block">
      <span className="text-[12.5px] font-medium text-fg-2">{children}</span>
      {hint && <span className="mt-0.5 block text-[12px] text-fg-3">{hint}</span>}
    </label>
  );
}

export function Kbd({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <kbd className={`inline-grid h-[18px] min-w-[18px] place-items-center rounded-[6px] bg-surface-2 px-1 font-sans text-[10.5px] text-fg-3 ${className}`}>{children}</kbd>;
}
