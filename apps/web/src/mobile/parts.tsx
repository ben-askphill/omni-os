// The Omni mobile design system's parts (ui_kits/omni-mobile/MobileParts.jsx), on the Web UI's own components.
// Metrics are the design's, in CSS pixels on a 390-wide phone.
import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { ThreadAvatar } from '../components/ThreadAvatar.tsx';
import { Folded } from '../components/Folded.tsx';
import { FindTargetCtx } from '../transcript/find-target.ts';
import { Icon, StatusDot, type Glyph, type IconName } from '../components/ui.tsx';
import type { ThreadMember } from '@omni/shared/members.ts';
import { glyphFor, markOf, type Mark, type Phase } from '@omni/shared/status.ts';
import type { RowItem } from './rows.ts';
import { LayerShownCtx, SheetHostCtx } from './sheet-stack.ts';
import { drawsFaces, MarkLine } from '../components/thread/AvatarMark.tsx';

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
  expanded,
  controls,
  buttonRef,
}: {
  icon?: IconName;
  label: string;
  onClick?: () => void;
  size?: number;
  ink?: boolean;
  quiet?: boolean;
  disabled?: boolean;
  children?: ReactNode;
  /** A button that shows and hides a popup: whether it shows, and its id. */
  expanded?: boolean;
  controls?: string;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
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
        {count != null && <span className="text-[12px] leading-[1.3] text-fg-3 tabular-nums">{count}</span>}
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

/** Who works the thread (ThreadAvatar): its agent's avatar, its eyes showing `shows` as a list row's do, else its channel's. */
export function MoAvatar({ size = 36, ...who }: Omit<Parameters<typeof ThreadAvatar>[0], 'size'> & { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <ThreadAvatar {...who} size={size} />
    </span>
  );
}

type RowState = { state?: Glyph | string | null; phase?: Phase | null; mark?: Mark | null };

/**
 * A thread row's start: who works it, its eyes on the row's state (ADR 0021, D23). A group thread's lead shows its own
 * state, as the busy faces on the row's second line show theirs. The row's mark sits at its far end (MoRowMark).
 */
export function MoRowLead({ state, phase, mark, members, ...who }: Omit<Parameters<typeof MoAvatar>[0], 'shows' | 'size'> & RowState & { members?: readonly Pick<ThreadMember, 'lead' | 'state'>[] }) {
  const lead = members?.find((m) => m.lead);
  return <MoAvatar {...who} shows={lead ? { member: lead.state } : state ? { mark: mark ?? markOf(glyphFor(state), phase) } : undefined} />;
}

/** A thread row's status mark, at the far end of its title's line (ADR 0021, D23). Nothing without a state. */
export function MoRowMark({ state, phase, mark }: RowState) {
  if (!state) return null;
  return (
    <span className="grid min-w-3 shrink-0 place-items-center self-center">
      <StatusDot status={state} phase={phase} mark={mark} size={8} />
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

/** One thread in a list: a channel, search. */
/** `trailing`: room at the end of the second line, for a control laid over the row (MoDelegatedRow's count). */
export function MoRow({ it, onOpen, last, trailing }: { it: RowItem; onOpen: () => void; last?: boolean; trailing?: ReactNode }) {
  return (
    <button type="button" onClick={onOpen} className="mo-row flex min-w-0 w-full items-center gap-3 px-1 py-2.5 text-left">
      <MoRowLead role={it.role} channel={it.channelId} channelIcon={it.channelIcon} avatarBg={it.avatarBg} state={it.status} phase={it.phase} members={it.members} />
      <span className={`-mb-2.5 flex min-w-0 flex-1 flex-col gap-0.5 pb-2.5 ${last ? '' : 'border-b border-line'}`}>
        <span className="flex items-baseline gap-2">
          <span className={`min-w-0 flex-1 truncate text-[15px] leading-[1.3] ${it.settled ? 'text-fg-2' : 'text-fg'}`}>{it.title}</span>
          <span className="shrink-0 text-[12px] leading-none text-fg-3 tabular-nums">{it.time}</span>
          <MoRowMark state={it.status} phase={it.phase} />
        </span>
        {/* A group thread at work says who on its second line: "Builder asks you · Designer working" (Q35). */}
        {drawsFaces(it.members) ? (
          <span className="flex items-center gap-2 text-[12.5px] leading-[1.35] text-fg-3">
            <MarkLine members={it.members} className="min-w-0 flex-1" />
            {trailing}
          </span>
        ) : (
          <span className="flex items-center gap-2 text-[12.5px] leading-[1.35] text-fg-3">
            <span className="min-w-0 flex-1 truncate">{[`#${it.channel}`, it.meta].filter(Boolean).join(' · ')}</span>
            {trailing}
          </span>
        )}
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
  disabled,
  wrapSub,
}: {
  icon?: IconName | ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  /** Let the sub line wrap instead of cutting it off, for a row whose sub must be read whole. */
  wrapSub?: boolean;
  right?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  last?: boolean;
  disabled?: boolean;
}) {
  const inner = (
    <>
      {icon && <span className="grid text-fg-2">{typeof icon === 'string' ? <Icon name={icon as IconName} size={18} /> : icon}</span>}
      <span className={`flex min-w-0 flex-1 items-center gap-2.5 self-stretch ${last ? '' : 'border-b border-line'}`}>
        <span className="flex min-w-0 flex-1 flex-col gap-px py-2.5">
          <span className="truncate text-[15px] leading-[1.3]">{label}</span>
          {sub && <span className={`${wrapSub ? 'text-pretty' : 'truncate'} text-[12.5px] leading-[1.35] text-fg-3`}>{sub}</span>}
        </span>
        {right && <span className="flex items-center gap-1.5 text-[13px] leading-none text-fg-3 tabular-nums">{right}</span>}
        {chevron && onClick && (
          <span className="grid text-fg-3">
            <Icon name="chevronRight" size={16} />
          </span>
        )}
      </span>
    </>
  );
  const cls = 'flex min-h-[52px] w-full items-center gap-3.5 px-4 text-left';
  return onClick ? (
    <button type="button" onClick={onClick} disabled={disabled} className={`${cls} active:bg-[var(--wash)] disabled:opacity-45`}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/**
 * Ben's message. `above` sits over the bubble (the context he attached); without `children` there is no bubble.
 * `fold` keeps a long message to its first lines, faded, with Show more under it.
 */
/** `event`: the message's row, for the find bar (thread-find-dom.ts), which opens a fold its match is in. */
export function MoBubble({ children, caption, above, fold, event }: { children: ReactNode; caption?: ReactNode; above?: ReactNode; fold?: boolean; event?: number }) {
  const found = useContext(FindTargetCtx) === event && event !== undefined;
  return (
    <div className="flex flex-col items-end gap-1">
      {caption && <span className="text-[12px] leading-[1.3] text-fg-3">{caption}</span>}
      {above}
      {children != null && (
        <div data-find-event={event} className="max-w-[86%] rounded-[20px] bg-bubble px-3.5 py-2.5 text-[15px] leading-[1.45] break-words whitespace-pre-wrap text-pretty">
          {fold ? <Folded opens={found}>{children}</Folded> : children}
        </div>
      )}
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

/** The phone's toast: one note over the tab bar. An error one stays, with a button to dismiss it. */
export interface MoToastNote {
  text: string;
  key: number;
  error?: boolean;
}

/**
 * Where the phone's toasts show, mounted with the shell so a screen reader is already watching it when a note comes
 * in: a polite region for notes and an assertive one for errors. Long text wraps.
 */
export function MoToastRegion({ note, onDismiss }: { note: MoToastNote | null; onDismiss: () => void }) {
  const pill = (n: MoToastNote) => (
    <div
      key={n.key}
      className={`flex max-w-full items-center gap-1 rounded-[22px] bg-fg py-[9px] text-[13.5px] leading-[1.35] font-medium text-pretty break-words text-on-ink shadow-[var(--shadow-menu)] ${n.error ? 'pointer-events-auto pr-1.5 pl-[18px]' : 'px-[18px]'}`}
      style={{ animation: 'mo-toast 320ms var(--ease-spring)' }}
    >
      <span className="min-w-0 py-0.5">{n.text}</span>
      {n.error && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="press -my-1 grid size-8 shrink-0 place-items-center rounded-full">
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
  return (
    <div className="pointer-events-none absolute inset-x-4 z-[60] flex flex-col items-center" style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 20px) + 78px)' }}>
      <div role="status" className="contents">
        {note && !note.error && pill(note)}
      </div>
      <div role="alert" className="contents">
        {note?.error && pill(note)}
      </div>
    </div>
  );
}

/**
 * A bottom sheet: a scrim and a panel that rises from the bottom. The scrim, Escape, or dragging the grabber down
 * closes it. `full` holds it open to just under the status bar, for lists that scroll.
 *
 * In the phone shell it renders over every screen and the tab bar, and acts as a modal: what is behind it, a sheet
 * under it included, goes inert, and the focus moves in (to a field that took it, a `data-autofocus` control, or the
 * sheet itself) and goes back to what opened it on close. A sheet opened from a screen that another one has since
 * covered hides with that screen and shows again with it. It stays out of the top layer: iOS keeps the top layer
 * under the keyboard, and the shell sizes itself from the visual viewport for that.
 */
export function MoSheet({ onClose, children, full, label }: { onClose: () => void; children: ReactNode; full?: boolean; label: string }) {
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const host = useContext(SheetHostCtx);
  const shown = useContext(LayerShownCtx);
  const shownNow = useRef(shown);
  shownNow.current = shown;
  const ref = useRef<HTMLDivElement>(null);
  // Read on the first render, before a field inside takes the focus.
  const [trigger] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));
  useEffect(() => {
    // Only the top sheet: one Escape closes one sheet.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (!host || host.stack.top() === ref.current) && close.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [host]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !shown) return;
    host?.stack.open(el);
    if (!el.contains(document.activeElement)) (el.querySelector<HTMLElement>('[data-autofocus]') ?? el).focus({ preventScroll: true });
    return () => {
      const held = el.contains(document.activeElement);
      host?.stack.close(el);
      // Once it is gone: StrictMode runs this effect twice, and the second run keeps the focus where the first left it.
      // Closed, not hidden under a screen pushed over its own: that screen takes the focus.
      queueMicrotask(() => {
        const back = !el.isConnected && held && shownNow.current && trigger instanceof HTMLElement && trigger.isConnected && !trigger.closest('[inert]');
        if (back) trigger.focus({ preventScroll: true });
      });
    };
  }, [host, shown, trigger]);
  const top = `calc(${SAFE_TOP} + 56px)`;
  const sheet = (
    <div ref={ref} className="absolute inset-0 z-40 outline-none" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} hidden={!shown}>
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
  return host ? createPortal(sheet, host.el) : sheet;
}
