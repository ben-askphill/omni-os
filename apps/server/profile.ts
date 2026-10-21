// Who uses this Omni: the name the greeting and the agent prompts call them by. One kv row, synced like any
// other setting, so the name follows the user to their other Macs. Empty until the first-run step sets it.
import { z } from 'zod';
import { kv } from './db.ts';

export interface Profile {
  /** Display name, trimmed. Empty when nobody has set it yet; both clients then show the onboarding step. */
  name: string;
}

const KEY = 'profile';
export const NAME_MAX = 60;

export const profileInput = z.object({ name: z.string().trim().min(1, 'Enter a name.').max(NAME_MAX, `Keep the name under ${NAME_MAX} characters.`) });

export function getProfile(): Profile {
  const stored = kv.get<Partial<Profile>>(KEY);
  return { name: typeof stored?.name === 'string' ? stored.name : '' };
}

/** Saves a name the route already validated with `profileInput`. Runs of whitespace inside it collapse to one space. */
export function setProfile(name: string): Profile {
  const next = { name: name.trim().replace(/\s+/g, ' ') };
  kv.set(KEY, next);
  return next;
}

/** How prompts refer to the person: their name, or "the user" until one is set. */
export const userName = () => getProfile().name || 'the user';

/** "Tijs's" or "the user's", for prompt text. */
export const userPossessive = () => `${userName()}'s`;
