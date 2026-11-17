// Overlapping channel avatars, each with the channel's own face from the sidebar. ChannelStack sits in a thread's
// header: one disc per channel its delegated threads work in, a link that opens Details at the agents card.
// ChannelRollup sits on a job's Inbox card (its own channel first, in place of the channel's avatar) and on its
// sidebar and phone Activity rows (without its own channel), with a tooltip and no click of its own. Past four
// channels the last disc is a +N chip. The rules are @omni/shared/channel-stack.ts.
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { CONDUCTOR_CHANNEL } from '@omni/shared/channel-icon.ts';
import {
  channelRollup,
  channelRollupLabel,
  channelStack,
  channelStackLabel,
  type ChannelStack as Stack,
  type StackThread,
} from '@omni/shared/channel-stack.ts';
import { useApp } from '../store.tsx';
import { Avatar } from './ui.tsx';

/** How far each disc slides under the one before it, as a share of its size. */
const OVERLAP = 0.28;
/** The clear gap the cut-out leaves around the disc on top, in px. */
const GAP = 1.5;

/**
 * Each disc after the first: pulled under the one before, with a crescent cut out where that disc covers it. The cut
 * is transparent, so the overlap reads on any fill (a card at rest, hovered or selected, the panel, the dark chrome)
 * where a ring would have to match one background colour.
 */
function tucked(size: number, overlap: number): CSSProperties {
  const cut = `radial-gradient(circle at ${overlap - size / 2}px 50%, transparent ${size / 2 + GAP}px, #000 ${size / 2 + GAP + 0.5}px)`;
  return { marginLeft: -overlap, WebkitMaskImage: cut, maskImage: cut };
}

/** The discs, the first on top, then the +N chip: a pill one overlap wider, so its count sits clear of the cut. */
function Discs({ stack, size }: { stack: Stack; size: number }) {
  const { channels } = useApp();
  const overlap = Math.round(size * OVERLAP);
  const tuck = tucked(size, overlap);
  return (
    <>
      {stack.shown.map((c, i) => {
        const ch = channels.find((x) => x.id === c.id);
        return (
          <span key={c.id} className="relative flex rounded-full" style={{ zIndex: stack.shown.length - i, ...(i ? tuck : undefined) }} data-channel={c.id}>
            <Avatar name={ch?.name ?? c.id} channelIcon={ch?.icon} avatarBg={ch?.avatar_bg} omni={c.id === CONDUCTOR_CHANNEL} size={size} />
          </span>
        );
      })}
      {stack.more > 0 && (
        <span
          className="relative inline-grid shrink-0 place-items-center rounded-full bg-surface-3 font-num font-medium text-fg-2 tabular-nums"
          style={{ ...tuck, width: size + overlap, height: size, paddingLeft: overlap, fontSize: Math.max(9.5, size * 0.5) }}
          data-channel-more={stack.more}
        >
          +{stack.more}
        </span>
      )}
    </>
  );
}

/** A channel's name for a tooltip, by its id. */
function useChannelName() {
  const { channels } = useApp();
  return (id: string) => channels.find((c) => c.id === id)?.name ?? id;
}

/**
 * `threads`: the thread's delegated threads, finished ones included. `own`: the thread's channel, left out unless a
 * delegated thread works there too. `size`: each disc's, 24 in the desktop header, 18 on the phone. Nothing when no
 * delegated thread works in another channel.
 */
export function ChannelStack({ threads, own, to, size = 24, className = '' }: { threads: readonly StackThread[]; own: string; to: string; size?: number; className?: string }) {
  const name = useChannelName();
  const stack = useMemo(() => channelStack(threads, own), [threads, own]);
  if (!stack) return null;
  const label = channelStackLabel(stack, name);
  return (
    <a href={to} title={label} aria-label={`${label}. Show in Details`} data-channel-stack={stack.channels.length} className={`press flex shrink-0 items-center rounded-full p-0.5 ${className}`}>
      <Discs stack={stack} size={size} />
    </a>
  );
}

/**
 * The channels a job touches, on its card or row. `threads`: every thread under it, oldest first (JobTree.threads).
 * `lead`: its own channel leads, on the Inbox card where the stack replaces that channel's avatar; without it the row
 * leaves its own channel out. `size`: 18 on the card, 14 on a sidebar row, 16 on a phone row. `fallback` shows when
 * nothing under the job works outside its channel: the card's single avatar, or nothing on a row.
 */
export function ChannelRollup({
  threads,
  own,
  lead = false,
  size,
  fallback = null,
  className = '',
}: {
  threads: readonly StackThread[];
  own: string;
  lead?: boolean;
  size: number;
  fallback?: ReactNode;
  className?: string;
}) {
  const name = useChannelName();
  const stack = useMemo(() => channelRollup(threads, own, { lead }), [threads, own, lead]);
  if (!stack) return <>{fallback}</>;
  const label = (lead ? channelRollupLabel : channelStackLabel)(stack, name);
  return (
    <span role="img" title={label} aria-label={label} data-channel-rollup={stack.channels.length} className={`inline-flex shrink-0 items-center ${className}`}>
      <Discs stack={stack} size={size} />
    </span>
  );
}
