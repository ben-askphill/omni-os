import type { FaceShows } from '@omni/shared/agent-avatar.ts';
import { View } from 'react-native';

import { useChannelLook } from '../live/react';
import { AgentAvatar } from './AgentAvatar';
import { ChannelAvatar } from './ChannelAvatar';

/** The avatar's slot at the start of a thread row (ADR 0021, In use), 12pt before the title. */
export const ROW_AVATAR = 32;

/**
 * What a thread row leads with (D23), as the Web UI's rows do: its agent's avatar, showing the row's state in its eyes,
 * else its channel's for a thread with no agent. The status dot sits at the row's far end, never on the avatar. The
 * slot stays 32pt, so a photo or icon's ring never moves the title.
 */
export function ThreadAvatar({ agent, eyes, channelId, channel }: { agent: string | null; eyes: FaceShows; channelId: string; channel?: string }) {
  const home = useChannelLook(channelId);
  return (
    <View style={{ width: ROW_AVATAR, height: ROW_AVATAR, alignItems: 'center', justifyContent: 'center' }}>
      {agent ? (
        <AgentAvatar agent={agent} size={ROW_AVATAR} shows={eyes} placement="row" />
      ) : (
        <ChannelAvatar name={home.name ?? channel ?? channelId} icon={home.icon} avatarBg={home.avatarBg} conductor={channelId === 'conductor'} size={ROW_AVATAR} />
      )}
    </View>
  );
}
