import { useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { avatarInk } from '@omni/shared/avatar-color.ts';
import { parseChannelIcon } from '@omni/shared/channel-icon.ts';
import type { ChannelWithRunning } from '../../api.ts';
import { href, navigate } from '../../router.ts';
import { useInboxKey } from '../../inbox-key.ts';
import { useRailColor } from '../../layout-pref.ts';
import { useApp } from '../../store.tsx';
import { monogram } from '@omni/shared/monogram.ts';
import { needsByChannel, railBadge, railGroups, type RailBadge, type RailSelection } from '../../rail-model.ts';
import { StaticMark } from '../brand.tsx';
import { ChannelMark, Icon, Monograms, StatusDot, type IconName } from '../ui.tsx';
import { focusFirstItem, MenuGroups, moveFocus, useMenuDismiss, useMenuPlacement, type MenuItem } from '../ContextMenuParts.tsx';
import { MENU_SURFACE } from '../ui/overlay.tsx';
import { useScrollFade } from './useScrollFade.ts';

/**
 * The channel rail ("D · Ink rail"): 72px of dark chrome, 98px in the macOS desktop app to hold the traffic lights.
 * From the top: the Inbox and the Conductor, then client channels and internal and personal channels as discs that
 * scroll between two pinned blocks, then "More" (Pull requests, Library and Automations), Add channel, Settings and
 * Ben's monogram. On macOS the desktop app's native traffic lights sit in the rail's top strip, above the Inbox.
 */
export function ChannelRail({ selection }: { selection: RailSelection }) {
  const { channels, needsYou, profile } = useApp();
  const marks = useContext(Monograms);
  const needs = needsByChannel(needsYou?.items);
  const { clients, rest } = railGroups(channels);
  const conductor = channels.find((c) => c.id === 'conductor');
  const isChannel = (id: string) => selection.kind === 'channel' && selection.id === id;
  // A thread opened from the Inbox: its channel's disc is marked, quieter than selected.
  const isMarked = (id: string) => selection.kind === 'inbox' && selection.marked === id;
  const badgeOf = (c: ChannelWithRunning) => railBadge(c.running, needs.get(c.id) ?? 0);
  const disc = (c: ChannelWithRunning) => (
    <RailItem key={c.id} to={href.channel(c.id)} label={c.name} selected={isChannel(c.id)} marked={isMarked(c.id)} badge={badgeOf(c)}>
      <Disc selected={isChannel(c.id)} fill={c.avatar_bg}>{parseChannelIcon(c.icon) ? <ChannelMark icon={c.icon} size={22} /> : (marks.get(c.id) ?? monogram(c.name))}</Disc>
    </RailItem>
  );
  const { ref, fade } = useScrollFade();
  // "i" opens the Inbox, the page the Inbox disc opens.
  useInboxKey(() => navigate(href.inbox()));
  const color = useRailColor();
  // The selected disc scrolls into view when it is out of sight, for a thread opened from elsewhere.
  const selectedId = selection.kind === 'channel' ? selection.id : selection.kind === 'inbox' ? (selection.marked ?? null) : null;
  useEffect(() => {
    if (!selectedId) return;
    ref.current?.querySelector('[aria-current="page"], [data-marked]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, ref, channels.length]);

  return (
    <nav aria-label="Channels" data-color={color} className="scheme-dark rail-chrome relative flex h-full w-[72px] shrink-0 flex-col items-center bg-[var(--chrome)] pb-3.5 text-fg">
      {/* The glass capsule behind the macOS traffic lights, in the desktop app only (index.css). */}
      <span aria-hidden="true" className="rail-lights-glass" />
      {/* rail-top: the desktop app's macOS window drags by this strip, where its traffic lights sit (index.css). */}
      <div className="rail-top flex w-full shrink-0 flex-col items-center gap-1 pt-3.5">
        <RailItem to={href.inbox()} label="Inbox" selected={selection.kind === 'inbox'}>
          <Disc selected={selection.kind === 'inbox'} icon="inbox" />
        </RailItem>
        {conductor && (
          <RailItem to={href.channel('conductor')} label="Conductor" selected={isChannel('conductor')} badge={badgeOf(conductor)}>
            <Disc selected={isChannel('conductor')} fill={conductor.avatar_bg}>
              {parseChannelIcon(conductor.icon) ? <ChannelMark icon={conductor.icon} size={22} /> : <StaticMark size={20} title="" />}
            </Disc>
          </RailItem>
        )}
      </div>
      <Hairline />
      <div
        ref={ref}
        className="rail-scroll min-h-0 w-full flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ maskImage: fade, WebkitMaskImage: fade }}
      >
        <div className="flex flex-col items-center gap-1 py-1.5">
          {clients.map(disc)}
          {clients.length > 0 && rest.length > 0 && <Hairline />}
          {rest.map(disc)}
        </div>
      </div>
      <Hairline />
      <div className="flex flex-col items-center gap-1">
        <MoreMenu selection={selection} />
        <RailItem to={href.newChannel()} label="Add channel" selected={selection.kind === 'new-channel'}>
          <Disc selected={selection.kind === 'new-channel'} icon="plus" quiet />
        </RailItem>
        <RailItem to={href.settingsPage()} label="Settings" selected={selection.kind === 'settings'}>
          <Disc selected={selection.kind === 'settings'} icon="sliders" quiet />
        </RailItem>
        {profile?.name && (
          <span title={profile.name} className="mt-1 grid h-8 w-8 place-items-center rounded-full bg-surface-3 font-rounded text-[12px] font-medium text-fg-2">
            {monogram(profile.name)}
          </span>
        )}
      </div>
    </nav>
  );
}

/** The workspace pages behind the rail's "More" disc, in menu order. */
export const MORE_PAGES = [
  { kind: 'prs', label: 'Pull requests', icon: 'pr', to: href.pullRequests() },
  { kind: 'library', label: 'Library', icon: 'layers', to: href.artifacts() },
  { kind: 'automations', label: 'Automations', icon: 'zap', to: href.automations() },
] as const satisfies readonly { kind: RailSelection['kind']; label: string; icon: IconName; to: string }[];

/**
 * The "More" disc: Pull requests, Library and Automations in one menu that opens beside the rail, so they take one
 * disc of height instead of three. Selected while one of them is on screen, its label saying which. Enter, Space or
 * the down arrow open it on its first item; the arrows walk it; Escape or Tab closes it and puts focus back on the
 * disc, so Tab carries on from the disc.
 */
function MoreMenu({ selection }: { selection: RailSelection }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = MORE_PAGES.find((p) => p.kind === selection.kind);
  const open = () => {
    const r = button.current?.getBoundingClientRect();
    if (r) setAt({ x: r.right + 8, y: r.top });
  };
  const close = useCallback((refocus: boolean) => {
    setAt(null);
    if (refocus) button.current?.focus();
  }, []);
  const label = current ? `More, ${current.label} open` : 'More';
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        title="Pull requests, Library and Automations"
        aria-haspopup="menu"
        aria-expanded={!!at}
        aria-current={current ? 'page' : undefined}
        onClick={() => (at ? close(false) : open())}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' || at) return;
          e.preventDefault();
          open();
        }}
        className="rail-item press relative grid h-12 w-12 shrink-0 place-items-center"
      >
        <Disc selected={!!current} icon="more" quiet />
      </button>
      {at && createPortal(<MorePopup at={at} anchor={button} onClose={close} />, document.body)}
    </>
  );
}

function MorePopup({ at, anchor, onClose }: { at: { x: number; y: number }; anchor: RefObject<HTMLButtonElement | null>; onClose: (refocus: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useMenuPlacement(ref, at.x, at.y);
  const dismiss = useCallback(() => onClose(ref.current?.contains(document.activeElement) ?? false), [onClose]);
  useMenuDismiss(ref, dismiss, anchor);
  useEffect(() => focusFirstItem(ref), []);
  const items: MenuItem[] = MORE_PAGES.map((p) => ({
    label: p.label,
    icon: p.icon,
    run: () => (onClose(false), navigate(p.to)),
  }));
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(ref, e.key);
    } else if (e.key === 'Tab') {
      // The menu is portaled to the end of the page: focus goes back to the disc first, so Tab moves on from there.
      onClose(true);
    }
  };
  return (
    <div ref={ref} role="menu" aria-label="More" style={{ left: pos.x, top: pos.y }} onKeyDown={onKey} className={`pop-in fixed z-[60] min-w-[200px] p-1.5 ${MENU_SURFACE}`}>
      <MenuGroups groups={[{ items }]} />
    </div>
  );
}

function Hairline() {
  return <span aria-hidden className="my-1.5 block h-px w-7 shrink-0 bg-[var(--line-strong)]" />;
}

/**
 * A 48px hit target holding a disc, with its badge top right and its name as the tooltip. `marked`: the channel of
 * the thread on screen while the Inbox stays selected, drawn as a short bar at the rail's left edge.
 */
function RailItem({ to, label, selected, marked, badge, children }: { to: string; label: string; selected: boolean; marked?: boolean; badge?: RailBadge; children: ReactNode }) {
  const state = badge === 'needs' ? `${label}, needs you` : badge === 'running' ? `${label}, running` : label;
  const what = marked ? `${state}, open thread's channel` : state;
  return (
    <a
      href={to}
      aria-label={what}
      title={what}
      aria-current={selected ? 'page' : undefined}
      data-marked={marked || undefined}
      className="rail-item press relative grid h-12 w-12 shrink-0 place-items-center"
    >
      {marked && <span aria-hidden className="rail-mark-bar absolute top-1/2 -left-2 h-4 w-1 -translate-y-1/2 rounded-full bg-fg-2" />}
      {children}
      {badge && (
        <span aria-hidden className="absolute top-[5px] right-[5px] grid h-3.5 w-3.5 place-items-center rounded-full bg-[var(--chrome)]">
          <StatusDot status={badge} size={8} />
        </span>
      )}
    </a>
  );
}

/**
 * The 40px disc: letters, a channel's own icon or a glyph. Selected, it turns ink-on-light. `quiet`: the bottom
 * controls, with no fill until selected. `fill`: the channel's avatar background, kept when selected, which adds a ring.
 */
function Disc({ selected, icon, quiet, fill, children }: { selected: boolean; icon?: IconName; quiet?: boolean; fill?: string | null; children?: ReactNode }) {
  const look = fill
    ? selected ? 'ring-2 ring-fg ring-offset-2 ring-offset-[var(--chrome)]' : ''
    : selected ? 'bg-fg text-[var(--chrome)]' : quiet ? 'text-fg-3' : 'bg-surface-2 text-fg-2';
  return (
    <span
      className={`rail-disc grid h-10 w-10 place-items-center rounded-full font-rounded text-[14px] font-medium leading-none ${look}`}
      style={fill ? { backgroundColor: fill, color: avatarInk(fill) } : undefined}
    >
      {icon ? <Icon name={icon} size={18} /> : children}
    </span>
  );
}
