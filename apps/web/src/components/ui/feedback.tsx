import { useState, type CSSProperties, type ReactNode } from 'react';
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
