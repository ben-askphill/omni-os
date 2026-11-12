import { useContext, useEffect, type ReactNode } from 'react';
import { avatarInk } from '@omni/shared/avatar-color.ts';
import { parseChannelIcon } from '@omni/shared/channel-icon.ts';
import type { ChannelWithRunning } from '../../api.ts';
import { href } from '../../router.ts';
import { useApp } from '../../store.tsx';
import { monogram } from '@omni/shared/monogram.ts';
import { needsByChannel, railBadge, railGroups, type RailBadge, type RailSelection } from '../../rail-model.ts';
import { OmniMark, StaticMark } from '../brand.tsx';
import { ChannelMark, Icon, Monograms, StatusDot, type IconName } from '../ui.tsx';
import { useScrollFade } from './useScrollFade.ts';

/**
 * The channel rail ("D · Ink rail"): 72px of dark chrome, 98px in the macOS desktop app to hold the traffic lights. From the top: the Omni mark, the Inbox and the Conductor, then
 * client channels and internal and personal channels as discs that scroll between two pinned blocks, then Add
 * channel, Settings and Ben's monogram. On macOS the desktop app's native traffic lights sit in the rail's top strip.
 */
export function ChannelRail({ selection }: { selection: RailSelection }) {
  const { channels, needsYou, profile } = useApp();
  const marks = useContext(Monograms);
  const needs = needsByChannel(needsYou?.items);
  const { clients, rest } = railGroups(channels);
  const conductor = channels.find((c) => c.id === 'conductor');
  const isChannel = (id: string) => selection.kind === 'channel' && selection.id === id;
  const badgeOf = (c: ChannelWithRunning) => railBadge(c.running, needs.get(c.id) ?? 0);
  const disc = (c: ChannelWithRunning) => (
    <RailItem key={c.id} to={href.channel(c.id)} label={c.name} selected={isChannel(c.id)} badge={badgeOf(c)}>
      <Disc selected={isChannel(c.id)} fill={c.avatar_bg}>{parseChannelIcon(c.icon) ? <ChannelMark icon={c.icon} size={22} /> : (marks.get(c.id) ?? monogram(c.name))}</Disc>
    </RailItem>
  );
  const { ref, fade } = useScrollFade();
  // The selected disc scrolls into view when it is out of sight, for a thread opened from elsewhere.
  const selectedId = selection.kind === 'channel' ? selection.id : null;
  useEffect(() => {
    if (!selectedId) return;
    ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, ref, channels.length]);

  return (
    <nav aria-label="Channels" className="scheme-dark rail-chrome relative flex h-full w-[72px] shrink-0 flex-col items-center bg-[var(--chrome)] pb-3.5 text-fg">
      {/* The glass capsule behind the macOS traffic lights, in the desktop app only (index.css). */}
      <span aria-hidden="true" className="rail-lights-glass" />
      {/* rail-top: the desktop app's macOS window drags by this strip, where its traffic lights sit (index.css). */}
      <div className="rail-top flex w-full shrink-0 items-end justify-center pt-3.5">
        <a href={href.home()} aria-label="Omni, Inbox" className="grid h-10 w-10 place-items-center text-fg">
          <OmniMark size={30} title="" />
        </a>
      </div>
      <div className="mt-1.5 flex flex-col items-center gap-1">
        <RailItem to={href.home()} label="Inbox" selected={selection.kind === 'inbox'}>
          <Disc selected={selection.kind === 'inbox'} icon="inbox" />
        </RailItem>
        {conductor && (
          <RailItem to={href.channel('conductor')} label="Conductor" selected={isChannel('conductor')} badge={badgeOf(conductor)}>
            <Disc selected={isChannel('conductor')} fill={conductor.avatar_bg}>
              <StaticMark size={20} title="" />
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

function Hairline() {
  return <span aria-hidden className="my-1.5 block h-px w-7 shrink-0 bg-[var(--line-strong)]" />;
}

/** A 48px hit target holding a disc, with its badge top right and its name as the tooltip. */
function RailItem({ to, label, selected, badge, children }: { to: string; label: string; selected: boolean; badge?: RailBadge; children: ReactNode }) {
  const what = badge === 'needs' ? `${label}, needs you` : badge === 'running' ? `${label}, running` : label;
  return (
    <a
      href={to}
      aria-label={what}
      title={what}
      aria-current={selected ? 'page' : undefined}
      className="press relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl transition-colors hover:bg-[var(--wash)]"
    >
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
      className={`grid h-10 w-10 place-items-center rounded-full font-rounded text-[14px] font-medium leading-none transition-colors ${look}`}
      style={fill ? { backgroundColor: fill, color: avatarInk(fill) } : undefined}
    >
      {icon ? <Icon name={icon} size={18} /> : children}
    </span>
  );
}
