import { conductorChannelLook, type FaceShows } from '@omni/shared/agent-avatar.ts';
import { CONDUCTOR_CHANNEL } from '@omni/shared/channel-icon.ts';
import { View } from 'react-native';

import { useAgents, useChannelLook } from '../live/react';
import { AgentAvatar } from './AgentAvatar';
import { ChannelAvatar } from './ChannelAvatar';

/** The avatar's slot at the start of a thread row (ADR 0021, In use), 12pt before the title. */
export const ROW_AVATAR = 32;

/**
 * What a thread row leads with (D23), as the Web UI's rows do: its agent's avatar, showing the row's state in its eyes,
 * else its channel's for a thread with no agent. A Conductor thread wears the Conductor's face as every surface does
 * (conductorChannelLook): its agent's photo or icon, else the Conductor channel's saved look, else its crew character.
 * The status dot sits at the row's far end, never on the avatar. The slot stays 32pt, so a photo or icon's ring never
 * moves the title.
 */
export function ThreadAvatar({ agent, eyes, channelId, channel }: { agent: string | null; eyes: FaceShows; channelId: string; channel?: string }) {
  const home = useChannelLook(channelId);
  const agents = useAgents();
  const conductorHome = useChannelLook(CONDUCTOR_CHANNEL);
  const conductor = agent ? conductorChannelLook(agents.find((a) => a.id === agent) ?? { id: agent }, { name: conductorHome.name, icon: conductorHome.icon, avatar_bg: conductorHome.avatarBg }) : null;
  return (
    <View style={{ width: ROW_AVATAR, height: ROW_AVATAR, alignItems: 'center', justifyContent: 'center' }}>
      {conductor ? (
        <ChannelAvatar name={conductor.name ?? 'Conductor'} icon={conductor.icon} avatarBg={conductor.avatar_bg} conductor size={ROW_AVATAR} />
      ) : agent ? (
        <AgentAvatar agent={agent} size={ROW_AVATAR} shows={eyes} placement="row" />
      ) : (
        <ChannelAvatar name={home.name ?? channel ?? channelId} icon={home.icon} avatarBg={home.avatarBg} conductor={channelId === CONDUCTOR_CHANNEL} size={ROW_AVATAR} />
      )}
    </View>
  );
}
