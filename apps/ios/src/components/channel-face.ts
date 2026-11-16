import { CHANNEL_GLYPHS, channelFace as sharedFace, type ChannelIcon } from '@omni/shared/channel-icon.ts';
import { monogram } from '@omni/shared/monogram.ts';

import type { IconName } from '../ui/symbols';

// Every icon a channel can pick on the computer resolves to a shared drawing here.
CHANNEL_GLYPHS satisfies readonly IconName[];

/**
 * What a channel avatar draws, as the Web UI does (packages/shared/channel-icon.ts channelFace): the channel's own
 * icon, the Omni mark for the Conductor while it has none, or its monogram.
 */
export type ChannelFace = ChannelIcon | { kind: 'omni' } | { kind: 'letters'; letters: string };

export function channelFace(name: string, icon: string | null | undefined, conductor = false): ChannelFace {
  const face = sharedFace(icon, conductor);
  return face.kind === 'letters' ? { kind: 'letters', letters: monogram(name) } : face;
}
