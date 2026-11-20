import { useMemo } from 'react';
import { agentDisc, agentInitials } from '@omni/shared/agent-avatar.ts';
import { avatarInk } from '@omni/shared/avatar-color.ts';
import { crewRoleName } from '@omni/shared/crew-role.ts';
import type { CrewRole } from '../api.ts';
import { useCrewRoles } from '../store.tsx';
import { CrewMark, isCrewRole } from './brand.tsx';
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

/** The two letters each agent shows, unique across this machine's agents and the one being drawn (a draft's name). */
function useInitials(agent: AgentLook) {
  const crew = useCrewRoles();
  return useMemo(() => {
    const list = crew.some((r) => r.id === agent.id) ? crew.map((r) => (r.id === agent.id ? { id: r.id, name: agent.name } : r)) : [...crew, agent];
    return agentInitials(list).get(agent.id) ?? '';
  }, [crew, agent]);
}

/**
 * An agent's avatar (ADR 0019, How it looks): the image Ben uploaded, else its icon or emoji on its color, else a
 * built-in's mark, else a disc with two letters unique across agents, its color from the agent's id. Below 18px the
 * disc shows its color only. Settings > Agents, the pickers, the thread header, the quick-actions card and the author
 * line on each reply draw it.
 */
export function AgentAvatar({ agent, size = 24, className = '' }: { agent: AgentLook; size?: number; className?: string }) {
  const initials = useInitials(agent);
  const look = agent.avatar;
  const box = { width: size, height: size };
  if (look?.image) return <img src={look.image} alt="" aria-hidden="true" draggable={false} className={`shrink-0 rounded-full object-cover ${className}`} style={box} />;
  if (look?.icon) return <Avatar name={agent.name} channelIcon={look.icon} avatarBg={look.bg} size={size} className={className} />;
  if (!look?.bg && isCrewRole(agent.id))
    return (
      <span aria-hidden="true" className={`inline-grid shrink-0 place-items-center rounded-full bg-surface-2 text-fg-2 ${className}`} style={box}>
        <CrewMark role={agent.id} size={Math.round(size * 0.56)} title="" />
      </span>
    );
  const disc = agentDisc(agent.id, initials, size);
  const bg = look?.bg ?? disc.bg;
  return (
    <span
      aria-hidden="true"
      data-initials={initials}
      className={`inline-grid shrink-0 place-items-center rounded-full font-rounded font-medium leading-none ${className}`}
      style={{ ...box, fontSize: size * 0.4, backgroundColor: bg, color: look?.bg ? avatarInk(bg) : disc.ink }}
    >
      {disc.letters}
    </span>
  );
}
