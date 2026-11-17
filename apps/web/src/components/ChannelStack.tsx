// ChannelStack: in a thread's header, one overlapping avatar per channel its delegated threads work in, each with the
// channel's own face from the sidebar and a ring in the page colour so the overlap reads. Past four channels the last
// disc is a +N chip. The tooltip names every channel. It opens the thread's Details at the agents card, like the
// sidebar's delegate count. The rules are @omni/shared/channel-stack.ts.
import { useMemo } from 'react';
import { CONDUCTOR_CHANNEL } from '@omni/shared/channel-icon.ts';
import { channelStack, channelStackLabel, type StackThread } from '@omni/shared/channel-stack.ts';
import { useApp } from '../store.tsx';
import { Avatar } from './ui.tsx';

/** How far each disc slides under the one before it, as a share of its size. */
const OVERLAP = 0.28;

/**
 * `threads`: the thread's delegated threads, finished ones included. `own`: the thread's channel, left out unless a
 * delegated thread works there too. `size`: each disc's, 24 in the desktop header, 18 on the phone. Nothing when no
 * delegated thread works in another channel.
 */
export function ChannelStack({ threads, own, to, size = 24, className = '' }: { threads: readonly StackThread[]; own: string; to: string; size?: number; className?: string }) {
  const { channels } = useApp();
  const stack = useMemo(() => channelStack(threads, own), [threads, own]);
  if (!stack) return null;
  const find = (id: string) => channels.find((c) => c.id === id);
  const label = channelStackLabel(stack, (id) => find(id)?.name ?? id);
  const tuck = { marginLeft: -Math.round(size * OVERLAP) };
  return (
    <a href={to} title={label} aria-label={`${label}. Show in Details`} data-channel-stack={stack.channels.length} className={`press flex shrink-0 items-center rounded-full p-0.5 ${className}`}>
      {stack.shown.map((c, i) => {
        const ch = find(c.id);
        return (
          <span key={c.id} className="flex rounded-full ring-2 ring-bg" style={i ? tuck : undefined} data-channel={c.id}>
            <Avatar name={ch?.name ?? c.id} channelIcon={ch?.icon} avatarBg={ch?.avatar_bg} omni={c.id === CONDUCTOR_CHANNEL} size={size} />
          </span>
        );
      })}
      {stack.more > 0 && (
        <span
          className="inline-grid shrink-0 place-items-center rounded-full bg-surface-2 font-num font-medium text-fg-2 tabular-nums ring-2 ring-bg"
          style={{ ...tuck, width: size, height: size, fontSize: Math.max(10.5, size * 0.48) }}
          data-channel-more={stack.more}
        >
          +{stack.more}
        </span>
      )}
    </a>
  );
}
