import { AVATAR_SWATCHES, avatarInk } from './avatar-color.ts';
import { monogram } from './monogram.ts';

// An agent's face where it has no image or icon of its own: a colored disc with two letters (ADR 0019, How it looks).
// The web, the phone layout and the iOS app draw it. Pure.

const letters = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();

/**
 * Two letters per agent, unique across the agents given (Ben, 2026-11-20, Q48). An agent keeps its monogram while no
 * other agent's matches it. Agents whose monograms match each keep their first letter and take the first one where
 * their names part: Researcher RS and Reviewer RV, never both RE. One still taken after that takes the next letter of
 * its name that frees it, else a digit. The same set gives the same letters whatever order it comes in.
 */
export function agentInitials(agents: readonly { id: string; name: string }[]): Map<string, string> {
  const list = [...agents].sort((a, b) => a.id.localeCompare(b.id));
  const base = new Map(list.map((a) => [a.id, monogram(a.name)]));
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const a of list) {
    const own = letters(a.name);
    const rivals = list.filter((b) => b.id !== a.id && base.get(b.id) === base.get(a.id)).map((b) => letters(b.name));
    const parts = rivals.length ? [...own].findIndex((c, i) => i > 0 && rivals.every((r) => r[i] !== c)) : -1;
    let m = parts > 0 ? own[0] + own[parts] : base.get(a.id)!;
    if (taken.has(m)) m = [...own.slice(1), '2', '3', '4', '5', '6', '7', '8', '9'].map((c) => m[0] + c).find((c) => !taken.has(c)) ?? m;
    taken.add(m);
    out.set(a.id, m);
  }
  return out;
}

/** Below this size two letters do not read, so the disc shows its color only (Ben, 2026-11-20, Q49). */
export const INITIALS_MIN_PX = 18;

/** The pale swatches: an initials disc stays quiet beside an uploaded image. */
const DISC_SWATCHES = AVATAR_SWATCHES.slice(0, 6);

/** FNV-1a over the id: the same agent gets the same color on every client, and a rename keeps it. */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** An initials disc at `size` px: its color from the agent's id, its ink, and the letters, null below INITIALS_MIN_PX. */
export function agentDisc(id: string, initials: string, size: number): { bg: string; ink: string; letters: string | null } {
  const bg = DISC_SWATCHES[hash(id) % DISC_SWATCHES.length];
  return { bg, ink: avatarInk(bg), letters: size < INITIALS_MIN_PX ? null : initials };
}

/** The images an agent avatar upload takes (Q3, builder default). */
export const AVATAR_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AvatarImageType = (typeof AVATAR_IMAGE_TYPES)[number];
/** The most a picked file may weigh: Settings refuses a bigger one before it reads it. */
export const AVATAR_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
/** The side of the square Settings scales an upload to, and the most the server stores. */
export const AVATAR_PX = 256;
