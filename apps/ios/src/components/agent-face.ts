import type { CrewRole } from '@omni/client-core';
import { agentDisc, agentInitials } from '@omni/shared/agent-avatar.ts';
import { avatarInk } from '@omni/shared/avatar-color.ts';
import { CREW, type CrewRole as BuiltIn } from '@omni/shared/brand.ts';
import { crewRoleName } from '@omni/shared/crew-role.ts';

/** What an avatar reads of an agent. */
export type AgentLook = Pick<CrewRole, 'id' | 'name' | 'avatar'>;

/**
 * What an agent's avatar draws (ADR 0019, How it looks), in the Web UI's order (AgentAvatar): the image the user
 * uploaded, else its icon or emoji on its color, else a built-in's mark, else a disc with two letters unique across
 * the agents, its color from the agent's id. Below 18px the disc shows its color only.
 */
export type AgentFace =
  /** `v`: the image's version, which `hub.avatarSource` reads from the agent's own avatar path. */
  | { kind: 'image'; agent: string; v: string }
  | { kind: 'icon'; icon: string; bg: string | null }
  | { kind: 'mark'; role: BuiltIn }
  | { kind: 'disc'; bg: string; ink: string; letters: string | null };

const isBuiltIn = (id: string): id is BuiltIn => Object.hasOwn(CREW, id);

/**
 * The version of an uploaded image, when `image` is the agent's own avatar path (`/api/crew/<id>/avatar?v=<hex>`, as
 * the server's roleView names it). Anything else is not drawn: the token only ever goes to that path.
 */
function imageVersion(id: string, image: string | undefined): string | null {
  const m = image ? /^\/api\/crew\/([^/?#]+)\/avatar\?v=([0-9a-f]{6,64})$/.exec(image) : null;
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]) === id ? m[2] : null;
  } catch {
    return null;
  }
}

/** An agent by id among `agents`; one not listed (a deleted agent, or the list still loading) by its built-in name or id. */
export const agentLook = (id: string, agents: readonly AgentLook[]): AgentLook => agents.find((r) => r.id === id) ?? { id, name: agentName(id, agents) };

export const agentName = (id: string, agents: readonly Pick<CrewRole, 'id' | 'name'>[]) => crewRoleName(id, agents) ?? id;

export function agentFace(id: string, agents: readonly AgentLook[], size: number): AgentFace {
  const agent = agentLook(id, agents);
  const look = agent.avatar;
  const v = imageVersion(id, look?.image);
  if (v) return { kind: 'image', agent: id, v };
  if (look?.icon) return { kind: 'icon', icon: look.icon, bg: look.bg ?? null };
  if (!look?.bg && isBuiltIn(id)) return { kind: 'mark', role: id };
  // Unique across this machine's agents and the one drawn, which may not be listed yet.
  const list = agents.some((r) => r.id === id) ? agents : [...agents, agent];
  const disc = agentDisc(id, agentInitials(list).get(id) ?? '', size);
  return look?.bg ? { kind: 'disc', bg: look.bg, ink: avatarInk(look.bg), letters: disc.letters } : { kind: 'disc', ...disc };
}

/**
 * An agent's own color, for its mention pill (ADR 0019): its avatar's background, else its initials disc's color, as
 * the Web UI's agentColor reads it.
 */
export const agentColor = (id: string, agents: readonly AgentLook[]) => agentLook(id, agents).avatar?.bg ?? agentDisc(id, '', 24).bg;
