import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './icons.tsx';
import { Avatar } from './primitives.tsx';
import { useDismissable } from './use-dismissable.ts';

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

  useDismissable(open, () => close(false), { root: wrap, escape: false });

  useEffect(() => {
    if (!open || canSearch) return;
    list.current?.focus();
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
