import { CHANNEL_GLYPHS, parseChannelIcon, type ChannelIcon } from '@omni/shared/channel-icon.ts';
import { monogram } from '@omni/shared/monogram.ts';

import type { IconName } from '../ui/symbols';

// Every icon a channel can pick on the computer resolves to a shared drawing here.
CHANNEL_GLYPHS satisfies readonly IconName[];

/** What a channel avatar draws: the Conductor's mark, the channel's own icon as the Web UI reads it, or its monogram. */
export type ChannelFace = { kind: 'conductor' } | ChannelIcon | { kind: 'letters'; letters: string };

export function channelFace(name: string, icon: string | null | undefined, conductor = false): ChannelFace {
  if (conductor) return { kind: 'conductor' };
  return parseChannelIcon(icon) ?? { kind: 'letters', letters: monogram(name) };
}

