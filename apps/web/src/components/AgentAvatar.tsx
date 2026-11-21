import { useMemo } from 'react';
import { agentFace, type FacePlacement, type FaceShows } from '@omni/shared/agent-avatar.ts';
import { crewRoleName } from '@omni/shared/crew-role.ts';
import type { CrewRole } from '../api.ts';
import { onApiBase } from '../api-base.ts';
import { useCrewRoles } from '../store.tsx';
import { CrewCharacter } from './CrewCharacter.tsx';
import { Avatar } from './ui.tsx';

/** What an avatar reads of an agent. */
export type AgentLook = Pick<CrewRole, 'id' | 'name' | 'avatar'>;

/** An agent by id among `agents`; one not listed (a deleted agent, or the list still loading) by its built-in name or id. */
export const agentLook = (id: string, agents: readonly AgentLook[]): AgentLook => agents.find((r) => r.id === id) ?? { id, name: crewRoleName(id) ?? id };

/** An agent by id, from the agents this machine lists (agentLook). */
export function useAgent(id: string | null | undefined): AgentLook | null {
  const crew = useCrewRoles();
  return useMemo(() => (id ? agentLook(id, crew) : null), [crew, id]);
}

/**
 * An agent's avatar, drawn from the agent face (ADR 0021, D1): the image Ben uploaded, else its icon or emoji on its
 * color, else its crew character. `shows` is what the eyes read (a status mark, a member state; nothing for idle eyes)
 * and `placement` where the avatar sits, as agentFace() takes them. Every surface of the Web UI draws it.
 */
export function AgentAvatar({ agent, size = 24, shows, placement, className = '' }: { agent: AgentLook; size?: number; shows?: FaceShows; placement?: FacePlacement; className?: string }) {
  const face = agentFace(agent, { size, shows, placement });
  // The server names it under /api; a paired browser reads it on its own keyed path (api-base.ts).
  if (face.kind === 'image') return <img src={onApiBase(face.image)} alt="" aria-hidden="true" draggable={false} className={`shrink-0 rounded-full object-cover ${className}`} style={{ width: size, height: size }} />;
  if (face.kind === 'icon') return <Avatar name={agent.name} channelIcon={face.icon} avatarBg={face.bg} size={size} className={className} />;
  return <CrewCharacter face={face} className={className} />;
}
