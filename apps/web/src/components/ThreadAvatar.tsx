import { conductorChannelLook, type FaceShows } from '@omni/shared/agent-avatar.ts';
import { CONDUCTOR_CHANNEL } from '@omni/shared/channel-icon.ts';
import { useChannel } from '../store.tsx';
import { AgentAvatar, useAgent } from './AgentAvatar.tsx';
import { Avatar } from './ui.tsx';

/**
 * What a thread row leads with (ADR 0021, D23): its agent's avatar, its eyes on `shows` as a list row's are, else its
 * channel's avatar for a thread with no agent, so the rows still line up. A Conductor thread wears the Conductor's face
 * as every surface does (conductorChannelLook): its agent's photo or icon, else the Conductor channel's saved look,
 * else its crew character. The row's status mark sits at its far end, never on the avatar (D8). Desktop and phone rows
 * draw it.
 */
export function ThreadAvatar({ role, channel, channelIcon, avatarBg, shows, size }: { role?: string | null; channel?: string; channelIcon?: string | null; avatarBg?: string | null; shows?: FaceShows; size: number }) {
  const agent = useAgent(role);
  const conductor = conductorChannelLook(agent, useChannel(CONDUCTOR_CHANNEL));
  if (conductor) return <Avatar name={conductor.name} channelIcon={conductor.icon} avatarBg={conductor.avatar_bg} omni size={size} />;
  if (agent) return <AgentAvatar agent={agent} size={size} shows={shows} placement="row" />;
  return <Avatar name={channel ?? '?'} channelIcon={channelIcon} avatarBg={avatarBg} omni={channel === CONDUCTOR_CHANNEL} size={size} />;
}
