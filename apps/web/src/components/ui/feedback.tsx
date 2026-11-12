import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Loader } from '../brand.tsx';
import { Icon, type IconName } from './icons.tsx';
import { Button } from './primitives.tsx';
import { StatusDot } from './status.tsx';

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
      <div className="font-display text-[length:var(--fs-heading)]">{title}</div>
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

// ---------- ticks and checklist ----------

/** Usage as a row of ticks (Bencho "tick"). `value` is 0..1. Responsive bars keep 3px ticks and 2px gaps. */
export function Ticks({ value, count = 24, height = 14, tone, label, responsive = false, className = '' }: { value: number; count?: number; height?: number; tone?: 'needs' | 'muted'; label?: string; responsive?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!responsive || !ref.current) return;
    const element = ref.current;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [responsive]);
  const visibleCount = responsive && width !== null ? Math.max(1, Math.min(count, Math.floor((width + 2) / 5))) : count;
  const v = Math.max(0, Math.min(1, value));
  const on = v > 0 ? Math.max(1, Math.round(v * visibleCount)) : 0;
  const style = { '--ticks-h': `${height}px`, '--tick-on': tone === 'needs' ? 'var(--needs)' : tone === 'muted' ? 'var(--fg-3)' : 'var(--fg)' } as CSSProperties;
  return (
    <div ref={ref} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} className={`ticks ${className}`} style={style}>
      {Array.from({ length: visibleCount }, (_, i) => (
        <i key={i} data-on={i < on || undefined} />
      ))}
    </div>
  );
}

/** One animated to-do row (Bencho "chk"): box fills, tick draws, the label gets struck through. */
export function CheckItem({ state, children, onClick }: { state: 'pending' | 'in_progress' | 'completed' | string; children: ReactNode; onClick?: () => void }) {
  return (
    <div data-state={state} className="flex items-start gap-2.5 py-[3px] cursor-pointer" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick?.()}>
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

/** Clipboard write with a fallback for plain http (Tailscale), where the async API is unavailable. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
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
}

export function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    await copyText(text);
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

/** The two content widths, both centred: `page` (--w-page) for lists, `measure` (--measure) for reading and forms. */
export type PageWidth = 'page' | 'measure';

const COLUMN: Record<PageWidth, string> = {
  page: 'max-w-[var(--w-page)]',
  measure: 'max-w-[var(--measure)]',
};

/** The centred column a page's header and body share. content-box, so the side padding sits outside the width. */
export const pageColumn = (width: PageWidth) => `mx-auto box-content px-4 md:px-8 ${COLUMN[width]}`;

/**
 * A page's title block: eyebrow, title, subtitle and one action on the right. `width` takes a PageWidth so the title
 * lines up with a body in `pageColumn(width)`; a Tailwind max-width class still works for pages not moved over yet.
 */
export function PageHeader({ title, subtitle, actions, children, eyebrow, width = '' }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode; eyebrow?: ReactNode; width?: PageWidth | string }) {
  const column = width === 'page' || width === 'measure' ? pageColumn(width) : `mx-auto px-4 md:px-8 ${width}`;
  return (
    <div className={`${column} pt-6 pb-4 md:pt-10 md:pb-6`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <div className="caption mb-1.5">{eyebrow}</div>}
          <h1 className="truncate font-display text-[length:var(--fs-title)] leading-[1.1] md:text-[length:var(--fs-title-lg)]">{title}</h1>
          {subtitle && <div className="mt-2 max-w-2xl text-[length:var(--fs-body)] leading-[1.45] text-fg-3">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** A list page's controls in one row: search and filters from the left, then `right` (view, refresh) at the far end. */
export function PageToolbar({ children, right, className = '' }: { children?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-2 ${className}`}>
      {children}
      {right && <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

/** The one search field: --h-search tall, a pill on surface. Escape clears it. */
export function SearchField({ value, onChange, placeholder, label, className = '' }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; className?: string }) {
  return (
    <label
      className={`flex h-[var(--h-search,40px)] min-w-0 flex-[1_1_280px] items-center gap-2.5 rounded-full bg-surface px-3.5 text-fg-3 shadow-[inset_0_0_0_1px_var(--line)] transition-[box-shadow,background-color] focus-within:bg-bg focus-within:shadow-[inset_0_0_0_1px_var(--line-strong),0_0_0_4px_var(--wash)] sm:max-w-[360px] ${className}`}
    >
      <Icon name="search" size={15} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && value && onChange('')}
        placeholder={placeholder}
        aria-label={label}
        className="h-full min-w-0 flex-1 bg-transparent text-[length:var(--fs-ui)] text-fg outline-none placeholder:text-fg-3"
      />
    </label>
  );
}

/** Refresh for a toolbar's right slot. `status` (when it last ran, what it found) goes in its tooltip. */
export function RefreshButton({ onClick, busy, status, label = 'Refresh' }: { onClick: () => void; busy?: boolean; status?: string; label?: string }) {
  const title = status ? `${label}. ${status}` : label;
  return <Button variant="ghost" icon="refresh" aria-label={title} title={title} onClick={onClick} busy={busy} className="h-8 w-8 px-0" />;
}

export function Label({ children, hint, htmlFor }: { children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block">
      <span className="text-[12.5px] font-medium text-fg-2">{children}</span>
      {hint && <span className="mt-0.5 block text-[13px] leading-[18px] text-fg-3">{hint}</span>}
    </label>
  );
}

export function Kbd({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <kbd className={`inline-grid h-[18px] min-w-[18px] place-items-center rounded-[6px] bg-surface-2 px-1 font-sans text-[10.5px] text-fg-3 ${className}`}>{children}</kbd>;
}
