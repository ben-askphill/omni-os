import type { CrewRole } from '@omni/client-core';
import { agentColor as sharedColor, agentFace as sharedFace, agentLook, type AvatarRing, type CharacterFace, type FaceAgent, type FaceOptions, type IconFace } from '@omni/shared/agent-avatar.ts';

/** What an avatar reads of an agent. */
export type AgentLook = Pick<CrewRole, 'id' | 'name' | 'avatar'>;

/**
 * What an agent's avatar draws (ADR 0021, D1): the shared agent face, ring included, except that the app only draws an
 * image from the agent's own avatar path.
 */
export type AgentFace =
  /** `v`: the image's version, which `hub.avatarSource` reads from the agent's own avatar path. */
  | { kind: 'image'; agent: string; v: string; ring: AvatarRing }
  | IconFace
  | CharacterFace;

/**
 * The version of an uploaded image, when `image` is the agent's own avatar path (`/api/crew/<id>/avatar?v=<hex>`, as
 * the server's roleView names it). Anything else is not drawn: the token only ever goes to that path.
 */
function imageVersion(id: string, image: string | null | undefined): string | null {
  const m = image ? /^\/api\/crew\/([^/?#]+)\/avatar\?v=([0-9a-f]{6,64})$/.exec(image) : null;
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]) === id ? m[2] : null;
  } catch {
    return null;
  }
}

/** The agent as the shared face reads it, and its image's version: an image from anywhere but its own path is left out, so the chain goes on to the icon or the character. */
function served(id: string, agents: readonly AgentLook[]): { agent: FaceAgent; v: string | null } {
  const look: FaceAgent = agentLook(id, agents);
  const v = imageVersion(id, look.avatar?.image);
  return { agent: look.avatar?.image && !v ? { ...look, avatar: { ...look.avatar, image: null } } : look, v };
}

/** The agent a moving character (useCrewMotion) hands the shared face. */
export const faceAgent = (id: string, agents: readonly AgentLook[]) => served(id, agents).agent;

export function agentFace(id: string, agents: readonly AgentLook[], size: number, opts: Omit<FaceOptions, 'size'> = {}): AgentFace {
  const { agent, v } = served(id, agents);
  const face = sharedFace(agent, { ...opts, size });
  return face.kind === 'image' && v ? { kind: 'image', agent: id, v, ring: face.ring } : (face as IconFace | CharacterFace);
}

/** An agent's own color, for its mention pill (ADR 0021, D4 and D13): its avatar's background, else its shape's paired color. */
export const agentColor = (id: string, agents: readonly AgentLook[]) => sharedColor(agentLook(id, agents));
