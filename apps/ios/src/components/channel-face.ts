import { CHANNEL_GLYPHS, parseChannelIcon, type ChannelIcon } from '@omni/shared/channel-icon.ts';

import type { IconName } from '../ui/symbols';

// Every icon a channel can pick on the computer has an SF Symbol here.
CHANNEL_GLYPHS satisfies readonly IconName[];

/** What a channel avatar draws: the Conductor's mark, the channel's own icon as the Web UI reads it, or its first letter. */
export type ChannelFace = { kind: 'conductor' } | ChannelIcon | { kind: 'letter'; letter: string };

export function channelFace(name: string, icon: string | null | undefined, conductor = false): ChannelFace {
  if (conductor) return { kind: 'conductor' };
  return parseChannelIcon(icon) ?? { kind: 'letter', letter: letterOf(name) };
}

export const letterOf = (name: string) => name.replace(/[^a-z0-9]/gi, '').slice(0, 1).toUpperCase() || '?';
