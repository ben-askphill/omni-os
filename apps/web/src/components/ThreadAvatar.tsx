import type { FaceShows } from '@omni/shared/agent-avatar.ts';
import { CONDUCTOR_CHANNEL, hasOwnLook } from '@omni/shared/channel-icon.ts';
import { AgentAvatar, useAgent } from './AgentAvatar.tsx';
import { Avatar } from './ui.tsx';

/**
 * What a thread row leads with (ADR 0021, D23): its agent's avatar, its eyes on `shows` as a list row's are, else its
 * channel's avatar for a thread with no agent, so the rows still line up. A Conductor thread wears the Conductor's
 * saved icon and background once it has them, as on the iPhone; its crew character is only the default. The row's
 * status mark sits at its far end, never on the avatar (D8). Desktop and phone rows draw it.
 */
export function ThreadAvatar({ role, channel, channelIcon, avatarBg, shows, size }: { role?: string | null; channel?: string; channelIcon?: string | null; avatarBg?: string | null; shows?: FaceShows; size: number }) {
  const agent = useAgent(role === 'conductor' && hasOwnLook({ icon: channelIcon, avatar_bg: avatarBg }) ? null : role);
  if (agent) return <AgentAvatar agent={agent} size={size} shows={shows} placement="row" />;
  return <Avatar name={channel ?? '?'} channelIcon={channelIcon} avatarBg={avatarBg} omni={channel === CONDUCTOR_CHANNEL} size={size} />;
}
