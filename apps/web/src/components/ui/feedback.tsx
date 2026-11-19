import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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
    <div aria-busy="true" className="flex items-center gap-2 px-1 py-6 text-[13px] text-fg-3">
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

/** What a to-do row's box shows, said in words for a screen reader. */
const CHECK_SAID: Record<string, string> = { pending: 'To do', in_progress: 'In progress', completed: 'Done' };

/**
 * One animated to-do row (Bencho "chk"): box fills, tick draws, the label gets struck through. A list item with its
 * state in words; render it inside a <ul>. It is not a control.
 */
export function CheckItem({ state, children }: { state: 'pending' | 'in_progress' | 'completed' | string; children: ReactNode }) {
  return (
    <li data-state={state} className="flex items-start gap-2.5 py-[3px]">
      <span className="chk-box mt-[1px]" aria-hidden="true">
        <span className="chk-fill" />
        <svg viewBox="0 0 24 24" className="chk-tick">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
        {state === 'in_progress' && <span className="pulse absolute h-[7px] w-[7px] rounded-full bg-live" />}
      </span>
      <span className={`min-w-0 text-[13.5px] leading-[1.4] ${state === 'in_progress' ? 'font-medium text-fg' : 'text-fg-2'}`}>
        <span className="sr-only">{CHECK_SAID[state] ?? state}: </span>
        <span className="chk-say">{children}</span>
      </span>
    </li>
  );
}

// ---------- misc ----------

/**
 * Clipboard write with a fallback for plain http (Tailscale), where the async API is unavailable. True when the text
 * reached the clipboard. The fallback field is readonly and 16px, so iOS raises no keyboard and does not zoom in.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.readOnly = true;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    back?.focus({ preventScroll: true });
    return ok;
  }
}

export type CopyState = 'idle' | 'copied' | 'failed';

/** What a copy control says once it has tried. */
export const COPY_SAID: Record<Exclude<CopyState, 'idle'>, string> = { copied: 'Copied', failed: "Couldn't copy" };

/** A copy control's outcome: Copied or Couldn't copy for a moment (a failure stays twice as long), then idle again. */
export function useCopy(ms = 1400) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(
    async (text: string) => {
      const ok = await copyText(text);
      clearTimeout(timer.current);
      setState(ok ? 'copied' : 'failed');
      timer.current = setTimeout(() => setState('idle'), ok ? ms : ms * 2);
      return ok;
    },
    [ms],
  );
  return { state, copy, icon: (state === 'copied' ? 'check' : state === 'failed' ? 'alert' : 'copy') as IconName };
}

/**
 * The live region a copy control announces its outcome through. It sits outside the button and is always mounted, so
 * a screen reader hears Copied or Couldn't copy once, without the button's name changing under focus.
 */
export function CopyStatus({ state }: { state: CopyState }) {
  return (
    <span role="status" className="sr-only">
      {state === 'idle' ? '' : COPY_SAID[state]}
    </span>
  );
}

export function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const { state, copy, icon } = useCopy();
  return (
    <>
      <Button size="sm" variant="secondary" icon={icon} onClick={() => void copy(text)} className={className}>
        {state === 'idle' ? label : COPY_SAID[state]}
      </Button>
      <CopyStatus state={state} />
    </>
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
          <h1 className="font-display text-[length:var(--fs-title)] leading-[1.1] text-balance md:text-[length:var(--fs-title-lg)]">{title}</h1>
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
      className={`flex h-[var(--h-search,40px)] min-w-0 flex-[1_1_280px] items-center gap-2.5 rounded-full bg-surface px-3.5 text-fg-3 shadow-[inset_0_0_0_1px_var(--line)] focus-ring-within transition-[box-shadow,background-color] focus-within:bg-bg focus-within:shadow-[inset_0_0_0_1px_var(--line-strong)] sm:max-w-[360px] ${className}`}
    >
      <Icon name="search" size={15} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && value && onChange('')}
        placeholder={placeholder}
        aria-label={label}
        className="field-sm h-full min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-3"
      />
    </label>
  );
}

/** Refresh for a toolbar's right slot. `status` (when it last ran, what it found) goes in its tooltip. */
export function RefreshButton({ onClick, busy, status, label = 'Refresh' }: { onClick: () => void; busy?: boolean; status?: string; label?: string }) {
  const title = status ? `${label}. ${status}` : label;
  return <Button variant="ghost" icon="refresh" aria-label={title} title={title} onClick={onClick} busy={busy} className="h-8 w-8 px-0" />;
}

/** The ids a Label or Row gives its hint and its error. */
export const fieldHintId = (id: string) => `${id}-hint`;
export const fieldErrorId = (id: string) => `${id}-error`;

/** aria-describedby for the control under a Label or Row: its hint and its error, whichever it shows. */
export const fieldDescribedBy = (id: string, { hint, error }: { hint?: unknown; error?: unknown }) => [hint ? fieldHintId(id) : '', error ? fieldErrorId(id) : ''].filter(Boolean).join(' ') || undefined;

/**
 * A field's problem, under its label: the needs dot and the message in ink, as the design system's Input shows it (the
 * field itself takes the vermilion edge). The control points at it with aria-describedby and carries aria-invalid.
 */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 flex items-start gap-2 text-[12.5px] leading-[18px] text-fg">
      <StatusDot status="needs" size={8} className="mt-[5px]" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * A field's label, with its hint and its error under it. Only the label text is in <label>, so it alone names the
 * control; the hint and the error describe it, by the ids fieldHintId and fieldErrorId give `htmlFor`. The control
 * takes aria-describedby={fieldDescribedBy(id, { hint, error })}. Without `htmlFor` there is no control to name (a group whose
 * control names itself), so the label text is plain text.
 */
export function Label({ children, hint, htmlFor, error }: { children: ReactNode; hint?: ReactNode; htmlFor?: string; error?: ReactNode }) {
  const text = <span className="text-[12.5px] font-medium text-fg-2">{children}</span>;
  return (
    <div className="mb-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="block">
          {text}
        </label>
      ) : (
        <div>{text}</div>
      )}
      {hint && (
        <span id={htmlFor && fieldHintId(htmlFor)} className="mt-0.5 block text-[13px] leading-[18px] text-fg-3">
          {hint}
        </span>
      )}
      {error && htmlFor && <FieldError id={fieldErrorId(htmlFor)}>{error}</FieldError>}
    </div>
  );
}

export function Kbd({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <kbd className={`inline-grid h-[18px] min-w-[18px] place-items-center rounded-[6px] bg-surface-2 px-1 font-sans text-[10.5px] text-fg-3 ${className}`}>{children}</kbd>;
}
