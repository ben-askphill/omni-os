import { useMemo } from 'react';
import { agentFace, type FacePlacement, type FaceShows } from '@omni/shared/agent-avatar.ts';
import { eyesFor } from '@omni/shared/crew-eyes.ts';
import type { EyeState } from '@omni/shared/crew-shapes.ts';
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

/** The ring a photo or an icon wears for the eyes it has no room for (D8): Working while the agent works, Needs you when Ben has the ball. */
const RING: Partial<Record<EyeState, string>> = { thinking: 'avatar-ring-working', working: 'avatar-ring-working', needs: 'avatar-ring-needs' };

/**
 * An agent's avatar, drawn from the agent face (ADR 0021, D1): the image Ben uploaded, else its icon or emoji on its
 * color, else its crew character. `shows` is the status mark or member state behind it (nothing for idle eyes) and
 * `placement` where the avatar sits, as agentFace() takes them. A character shows it in its eyes; a photo or an icon,
 * which has none, in the Working or Needs you ring (D8). Nothing sits on the avatar. Every surface of the Web UI draws it.
 */
export function AgentAvatar({ agent, size = 24, shows, placement, className = '' }: { agent: AgentLook; size?: number; shows?: FaceShows; placement?: FacePlacement; className?: string }) {
  const face = agentFace(agent, { size, shows, placement });
  if (face.kind === 'character') return <CrewCharacter face={face} className={className} />;
  const ring = RING[eyesFor(shows, placement === 'focus')] ?? '';
  // The server names it under /api; a paired browser reads it on its own keyed path (api-base.ts).
  if (face.kind === 'image') return <img src={onApiBase(face.image)} alt="" aria-hidden="true" draggable={false} className={`shrink-0 rounded-full object-cover ${ring} ${className}`} style={{ width: size, height: size }} />;
  return <Avatar name={agent.name} channelIcon={face.icon} avatarBg={face.bg} size={size} className={`${ring} ${className}`} />;
}
