import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { ThreadStatus } from '../../../server/db.ts';

// ---------- icons (hand-drawn, 24px grid, 1.75 stroke) ----------

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
  external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  check: 'M20 6 9 17l-5-5',
  panel: 'M3 5h18v14H3zM15 5v14',
  branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  pr: 'M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM13 6h3a2 2 0 0 1 2 2v7M6 9v12',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M16 9.5h.01',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  terminal: 'm4 17 6-6-6-6M12 19h8',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  play: 'M7 4v16l13-8z',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  key: 'M14 10a4 4 0 1 0-3.5 3.97M10.5 14 4 20.5M7 17.5l2 2M14 10h7M18 10v3',
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
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className = '', strokeWidth = 1.75 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
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

// ---------- buttons ----------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-fg text-bg hover:opacity-90 disabled:opacity-40',
  secondary: 'bg-surface text-fg border border-line-strong hover:bg-surface-2 disabled:opacity-50',
  ghost: 'text-fg-2 hover:bg-surface-2 hover:text-fg disabled:opacity-40',
  danger: 'bg-bad text-white hover:opacity-90 disabled:opacity-40',
  'danger-ghost': 'text-bad hover:bg-bad-bg disabled:opacity-40',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className = '',
  busy,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; icon?: IconName; busy?: boolean }) {
  const sz = size === 'sm' ? 'h-7 px-2.5 text-[12.5px] gap-1.5 rounded-md' : 'h-8 px-3 text-[13px] gap-1.5 rounded-lg';
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors select-none ${sz} ${VARIANTS[variant]} ${className}`}
    >
      {busy ? <Spinner size={size === 'sm' ? 12 : 14} /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 15} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className = '',
  size = 16,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; size?: number }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40 ${className}`}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export function LinkButton({ href, icon, children, className = '', variant = 'secondary', size = 'md', target }: { href: string; icon?: IconName; children?: ReactNode; className?: string; variant?: Variant; size?: 'sm' | 'md'; target?: string }) {
  const sz = size === 'sm' ? 'h-7 px-2.5 text-[12.5px] gap-1.5 rounded-md' : 'h-8 px-3 text-[13px] gap-1.5 rounded-lg';
  return (
    <a
      href={href}
      target={target}
      rel={target ? 'noopener noreferrer' : undefined}
      className={`inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors ${sz} ${VARIANTS[variant]} ${className}`}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 15} />}
      {children}
    </a>
  );
}

// ---------- status ----------

const STATUS_COLOR: Record<string, string> = {
  queued: 'var(--fg-4)',
  running: 'var(--info-dot)',
  done: 'var(--ok-dot)',
  failed: 'var(--bad-dot)',
  stopped: 'var(--warn-dot)',
  imported: 'var(--fg-4)',
};

export const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  imported: 'Imported',
};

export function StatusDot({ status, size = 8, className = '' }: { status: ThreadStatus | string | null | undefined; size?: number; className?: string }) {
  const s = status ?? 'imported';
  const hollow = s === 'imported';
  return (
    <span
      title={STATUS_LABEL[s] ?? s}
      className={`inline-block shrink-0 rounded-full ${s === 'running' ? 'pulse' : ''} ${className}`}
      style={{
        width: size,
        height: size,
        background: hollow ? 'transparent' : STATUS_COLOR[s] ?? 'var(--fg-4)',
        boxShadow: hollow ? `inset 0 0 0 1.5px var(--fg-4)` : undefined,
      }}
    />
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    running: 'text-info bg-info-bg',
    done: 'text-ok bg-ok-bg',
    failed: 'text-bad bg-bad-bg',
    stopped: 'text-warn bg-warn-bg',
    queued: 'text-fg-2 bg-surface-2',
    imported: 'text-fg-3 bg-surface-2',
  };
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[12px] font-medium ${tone[status] ?? 'bg-surface-2 text-fg-2'}`}>
      <StatusDot status={status} size={6} />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Chip({ children, tone = 'default', className = '', title }: { children: ReactNode; tone?: 'default' | 'info' | 'ok' | 'bad' | 'warn' | 'outline'; className?: string; title?: string }) {
  const tones = {
    default: 'bg-surface-2 text-fg-2',
    outline: 'border border-line-strong text-fg-3',
    info: 'bg-info-bg text-info',
    ok: 'bg-ok-bg text-ok',
    bad: 'bg-bad-bg text-bad',
    warn: 'bg-warn-bg text-warn',
  };
  return (
    <span title={title} className={`inline-flex h-[18px] shrink-0 items-center rounded px-1.5 text-[11px] font-medium leading-none tracking-normal ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`spin shrink-0 ${className}`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ---------- feedback ----------

export function ErrorNote({ children, onRetry, className = '' }: { children: ReactNode; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={`flex items-start gap-2 rounded-lg border border-bad/25 bg-bad-bg px-3 py-2 text-[13px] text-bad ${className}`}>
      <Icon name="alert" size={15} className="mt-[2px]" />
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
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-fg-3">
          <Icon name={icon} size={18} />
        </div>
      )}
      <div className="text-[14px] font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-sm text-[13px] text-fg-3">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-6 text-[13px] text-fg-3">
      <Spinner /> {label}
    </div>
  );
}

// ---------- tabs ----------

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className = '',
}: {
  tabs: { id: T; label: ReactNode; href?: string; badge?: ReactNode }[];
  value: T;
  onChange?: (id: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={`flex items-center gap-1 overflow-x-auto scroll-thin ${className}`}>
      {tabs.map((t) => {
        const active = t.id === value;
        const cls = `relative inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
          active ? 'bg-surface-3 text-fg' : 'text-fg-3 hover:bg-surface-2 hover:text-fg'
        }`;
        const inner = (
          <>
            {t.label}
            {t.badge}
          </>
        );
        return t.href ? (
          <a key={t.id} role="tab" aria-selected={active} href={t.href} className={cls}>
            {inner}
          </a>
        ) : (
          <button key={t.id} role="tab" aria-selected={active} type="button" onClick={() => onChange?.(t.id)} className={cls}>
            {inner}
          </button>
        );
      })}
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={`fade-in max-h-[92vh] w-full overflow-auto rounded-t-2xl border border-line bg-surface shadow-[var(--shadow-menu)] sm:rounded-2xl ${wide ? 'sm:max-w-5xl' : 'sm:max-w-md'}`}
      >
        {title && (
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0 text-[14px] font-semibold">{title}</div>
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
      <div className="space-y-3 px-4 py-4 text-[13.5px] text-fg-2">{children}</div>
      {error && <ErrorNote className="mx-4 mb-3">{error}</ErrorNote>}
      <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
        {/* Focus starts on Cancel: every confirm here is destructive, so a stray Enter must not fire it. */}
        <Button variant="ghost" onClick={onCancel} disabled={busy} data-autofocus>
          Cancel
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} busy={busy}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
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
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-fg' : 'bg-surface-3'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-bg shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

export function PageHeader({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-b border-line px-4 pt-5 pb-3 md:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[20px] font-semibold tracking-[-0.03em]">{title}</h1>
          {subtitle && <div className="mt-0.5 text-[13px] text-fg-3">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Label({ children, hint, htmlFor }: { children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block">
      <span className="text-[12.5px] font-medium text-fg-2">{children}</span>
      {hint && <span className="mt-0.5 block text-[12px] text-fg-3">{hint}</span>}
    </label>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-surface-2 px-1 font-mono text-[10.5px] text-fg-3">{children}</kbd>;
}
