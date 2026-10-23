// The Omni mobile design system's parts (ui_kits/omni-mobile/MobileParts.jsx), on the Web UI's own components.
// Metrics are the design's, in CSS pixels on a 390-wide phone.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CrewMark, isCrewRole } from '../components/brand.tsx';
import { Avatar, Icon, StatusDot, type Glyph, type IconName } from '../components/ui.tsx';
import type { RowItem } from './rows.ts';

/** Safe-area insets: a home-screen app draws under the status bar and the home indicator. */
export const SAFE_TOP = 'env(safe-area-inset-top)';
/** The design's bottom inset (30 to 34 on a phone with a home indicator), and a little air without one. */
export const bottomInset = (minus = 0, floor = 12) => `max(${floor}px, calc(env(safe-area-inset-bottom) - ${minus}px))`;

export function MoRound({
  icon,
  label,
  onClick,
  size = 40,
  ink,
  quiet,
  disabled,
  children,
}: {
  icon?: IconName;
  label: string;
  onClick?: () => void;
  size?: number;
  ink?: boolean;
  quiet?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`mo-press grid shrink-0 place-items-center rounded-full disabled:opacity-40 ${ink ? 'bg-fg text-on-ink' : quiet ? 'bg-transparent text-fg' : 'bg-surface-2 text-fg'}`}
      style={{ width: size, height: size }}
    >
      {children ?? (icon && <Icon name={icon} size={18} />)}
    </button>
  );
}

/** A screen's top bar. Pushed screens get Back and a one-line title; tab roots put their own control on the left. */
export function MoHeader({ onBack, title, sub, right, left }: { onBack?: () => void; title?: ReactNode; sub?: ReactNode; right?: ReactNode; left?: ReactNode }) {
  return (
    <header className="relative z-[2] shrink-0 bg-bg" style={{ paddingTop: SAFE_TOP }}>
      <div className="flex h-[52px] items-center gap-2.5 px-3">
        {onBack ? <MoRound icon="chevronLeft" label="Back" onClick={onBack} /> : left}
        <div className="min-w-0 flex-1">
          {title && <div className="truncate text-[15px] leading-[1.25] font-medium">{title}</div>}
          {sub && <div className="truncate text-[12px] leading-[1.35] text-fg-3">{sub}</div>}
        </div>
        {right && <div className="flex items-center gap-2">{right}</div>}
      </div>
    </header>
  );
}

/** The large title, on tab roots only. */
export function MoTitle({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="px-5 pt-1 pb-3.5">
      <h1 className="m-0 font-head text-[30px] leading-[1.1] font-medium tracking-[-0.01em]">{title}</h1>
      {sub && <div className="mt-1.5 text-[13px] leading-[1.4] text-fg-3 tabular-nums">{sub}</div>}
    </div>
  );
}

export function MoSection({ title, count, right, children, pad = true }: { title: ReactNode; count?: number | null; right?: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <section className={`flex flex-col gap-2 ${pad ? 'px-4' : ''}`}>
      <div className="flex items-baseline gap-1.5 px-1">
        <span className="text-[12px] leading-[1.3] font-medium text-fg-3">{title}</span>
        {count != null && <span className="text-[12px] leading-[1.3] text-fg-4 tabular-nums">{count}</span>}
        <span className="flex-1" />
        {right}
      </div>
      {children}
    </section>
  );
}

/** A tab root or pushed screen's scrolling body. Tab roots leave room for the floating tab bar. */
export function MoScroll({ children, tabBar, className = '' }: { children: ReactNode; tabBar?: boolean; className?: string }) {
  return (
    <div
      className={`mo-scroll flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto ${className}`}
      style={{ paddingBottom: tabBar ? 'calc(max(env(safe-area-inset-bottom), 20px) + 92px)' : bottomInset(0, 20) }}
    >
      {children}
    </div>
  );
}

export function MoEmpty({ children }: { children: ReactNode }) {
  return <p className="m-0 px-5 py-[18px] text-[14px] leading-[1.5] text-pretty text-fg-3">{children}</p>;
}

/**
 * Who works the thread: its crew mark, or the channel's letter when it runs without a role, with its status on the
 * corner.
 */
export function MoAvatar({ role, channel, channelIcon, state, size = 36 }: { role?: string | null; channel?: string; channelIcon?: string | null; state?: Glyph | string | null; size?: number }) {
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {isCrewRole(role) ? (
        <span className="grid h-full w-full place-items-center rounded-full bg-surface-2 text-fg-2">
          <CrewMark role={role} size={Math.round(size * 0.46)} />
        </span>
      ) : (
        <Avatar name={channel ?? '?'} channelIcon={channelIcon} icon={channel === 'conductor' ? 'target' : undefined} size={size} />
      )}
      {state && (
        <span className="absolute -right-px -bottom-px grid h-3.5 w-3.5 place-items-center rounded-full bg-bg">
          <StatusDot status={state} size={8} />
        </span>
      )}
    </span>
  );
}

export function MoDiff({ add, del }: { add: number; del: number }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className="text-fg-2">+{add}</span> <span className="text-fg-3">−{del}</span>
    </span>
  );
}

/** One thread in a list: Activity, a channel, search. */
export function MoRow({ it, onOpen, last }: { it: RowItem; onOpen: () => void; last?: boolean }) {
  return (
    <button type="button" onClick={onOpen} className="mo-row flex w-full items-center gap-3 px-1 py-2.5 text-left">
      <MoAvatar role={it.role} channel={it.channelId} channelIcon={it.channelIcon} state={it.status} />
      <span className={`-mb-2.5 flex min-w-0 flex-1 flex-col gap-0.5 pb-2.5 ${last ? '' : 'border-b border-line'}`}>
        <span className="flex items-baseline gap-2">
          <span className={`min-w-0 flex-1 truncate text-[15px] leading-[1.3] ${it.settled ? 'text-fg-2' : 'text-fg'}`}>{it.title}</span>
          <span className="shrink-0 text-[12px] leading-none text-fg-3 tabular-nums">{it.time}</span>
        </span>
        <span className="flex items-center gap-2 text-[12.5px] leading-[1.35] text-fg-3">
          <span className="min-w-0 flex-1 truncate">{[`#${it.channel}`, it.meta].filter(Boolean).join(' · ')}</span>
        </span>
      </span>
    </button>
  );
}

export function MoRows({ items, onOpen }: { items: RowItem[]; onOpen: (it: RowItem) => void }) {
  return (
    <div className="flex flex-col">
      {items.map((t, i) => (
        <MoRow key={t.id} it={t} last={i === items.length - 1} onOpen={() => onOpen(t)} />
      ))}
    </div>
  );
}

export function MoRadio({ on }: { on: boolean }) {
  return (
    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${on ? 'bg-fg' : 'shadow-[inset_0_0_0_1.5px_var(--line-strong)]'}`}>
      {on && <span className="h-2 w-2 rounded-full bg-bg" />}
    </span>
  );
}

export function MoGroup({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-[20px] bg-surface ${className}`}>{children}</div>;
}

export function MoListRow({
  icon,
  label,
  sub,
  right,
  onClick,
  chevron = true,
  last,
}: {
  icon?: IconName | ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  last?: boolean;
}) {
  const inner = (
    <>
      {icon && <span className="grid text-fg-2">{typeof icon === 'string' ? <Icon name={icon as IconName} size={18} /> : icon}</span>}
      <span className={`flex min-w-0 flex-1 items-center gap-2.5 self-stretch ${last ? '' : 'border-b border-line'}`}>
        <span className="flex min-w-0 flex-1 flex-col gap-px py-2.5">
          <span className="truncate text-[15px] leading-[1.3]">{label}</span>
          {sub && <span className="truncate text-[12.5px] leading-[1.35] text-fg-3">{sub}</span>}
        </span>
        {right && <span className="flex items-center gap-1.5 text-[13px] leading-none text-fg-3 tabular-nums">{right}</span>}
        {chevron && onClick && (
          <span className="grid text-fg-4">
            <Icon name="chevronRight" size={16} />
          </span>
        )}
      </span>
    </>
  );
  const cls = 'flex min-h-[52px] w-full items-center gap-3.5 px-4 text-left';
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} active:bg-[var(--wash)]`}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function MoBubble({ children, caption }: { children: ReactNode; caption?: ReactNode }) {
  return (
    <div className="flex flex-col items-end gap-1">
      {caption && <span className="text-[12px] leading-[1.3] text-fg-3">{caption}</span>}
      <div className="max-w-[86%] rounded-[20px] bg-bubble px-3.5 py-2.5 text-[15px] leading-[1.45] break-words whitespace-pre-wrap text-pretty">{children}</div>
    </div>
  );
}

/** Where a preview would be: a file with nothing to draw, labelled with its type. */
export function MoStripes({ label, className = '' }: { label: string; className?: string }) {
  return (
    <div className={`grid h-full w-full place-items-center bg-[repeating-linear-gradient(135deg,var(--surface-2)_0_8px,var(--surface-3)_8px_9px)] ${className}`}>
      <span className="rounded-md bg-surface px-[7px] py-[3px] font-mono text-[11px] leading-[1.3] text-fg-3">{label}</span>
    </div>
  );
}

export function MoToast({ text }: { text: string }) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute left-1/2 z-[60] -translate-x-1/2 rounded-full bg-fg px-[18px] py-[11px] text-[13.5px] leading-none font-medium whitespace-nowrap text-on-ink shadow-[var(--shadow-menu)]"
      style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 20px) + 78px)', animation: 'mo-toast 320ms var(--ease-spring)' }}
    >
      {text}
    </div>
  );
}

/**
 * A bottom sheet: a scrim and a panel that rises from the bottom. The scrim, Escape, or dragging the grabber down
 * closes it. `full` holds it open to just under the status bar, for lists that scroll.
 */
export function MoSheet({ onClose, children, full, label }: { onClose: () => void; children: ReactNode; full?: boolean; label: string }) {
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const top = `calc(${SAFE_TOP} + 56px)`;
  return (
    <div className="absolute inset-0 z-40" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 bg-[var(--scrim)]" style={{ animation: 'mo-fade 240ms var(--ease-out)' }} onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-[28px] bg-bg shadow-[var(--shadow-menu)]"
        style={{
          top: full ? top : 'auto',
          maxHeight: `calc(100% - ${top})`,
          paddingBottom: bottomInset(4, 16),
          animation: 'mo-up 460ms var(--ease-out)',
          transform: drag ? `translateY(${drag}px)` : undefined,
          transition: start.current === null && drag === 0 ? 'transform 320ms var(--ease-spring)' : undefined,
        }}
      >
        <div
          className="flex shrink-0 touch-none justify-center pt-2 pb-0.5"
          onPointerDown={(e) => {
            start.current = e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => start.current !== null && setDrag(Math.max(0, e.clientY - start.current))}
          onPointerUp={() => {
            start.current = null;
            if (drag > 80) onClose();
            else setDrag(0);
          }}
          onPointerCancel={() => {
            start.current = null;
            setDrag(0);
          }}
        >
          <span className="h-[5px] w-9 rounded-full bg-surface-3" />
        </div>
        {children}
      </div>
    </div>
  );
}
