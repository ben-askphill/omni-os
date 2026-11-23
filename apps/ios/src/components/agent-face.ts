import type { CrewRole } from '@omni/client-core';
import { agentColor as sharedColor, agentFace as sharedFace, type CharacterFace, type FaceOptions, type IconFace } from '@omni/shared/agent-avatar.ts';
import { eyesFor } from '@omni/shared/crew-eyes.ts';
import type { EyeState } from '@omni/shared/crew-shapes.ts';
import { crewRoleName } from '@omni/shared/crew-role.ts';

/** What an avatar reads of an agent. */
export type AgentLook = Pick<CrewRole, 'id' | 'name' | 'avatar'>;

/** The ring a photo or icon avatar gets while its agent works, or waits on the user. A character shows it in its eyes (D8). */
export type AvatarRing = 'working' | 'needs' | null;

/**
 * What an agent's avatar draws (ADR 0021, D1), the shared agent face's chain: the image the user uploaded, else its
 * icon or emoji on its color, else its crew character. The app only draws an image from the agent's own avatar path.
 */
export type AgentFace =
  /** `v`: the image's version, which `hub.avatarSource` reads from the agent's own avatar path. */
  | { kind: 'image'; agent: string; v: string; ring: AvatarRing }
  | (IconFace & { ring: AvatarRing })
  | CharacterFace;

const RING: Partial<Record<EyeState, AvatarRing>> = { thinking: 'working', working: 'working', needs: 'needs' };

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
export const agentLook = (id: string, agents: readonly AgentLook[]): AgentLook => agents.find((r) => r.id === id) ?? { id, name: crewRoleName(id, agents) };

export function agentFace(id: string, agents: readonly AgentLook[], size: number, opts: Omit<FaceOptions, 'size'> = {}): AgentFace {
  const look = agentLook(id, agents).avatar;
  const ring = RING[eyesFor(opts.shows, opts.placement === 'focus')] ?? null;
  const v = imageVersion(id, look?.image);
  if (v) return { kind: 'image', agent: id, v, ring };
  // An image from anywhere else is left out, so the chain goes on to the icon or the character.
  const face = sharedFace({ id, avatar: look && { ...look, image: null } }, { ...opts, size }) as IconFace | CharacterFace;
  return face.kind === 'icon' ? { ...face, ring } : face;
}

/** An agent's own color, for its mention pill (ADR 0021, D4 and D13): its avatar's background, else its shape's paired color. */
export const agentColor = (id: string, agents: readonly AgentLook[]) => sharedColor(agentLook(id, agents));
