// Who uses this Omni: the name the greeting and the agent prompts call them by, their pronouns, email and timezone.
// The `user` section of the user config (data/omni.config.json, apps/server/user-config.ts), so it stays on this
// machine and out of the repo. Empty until onboarding sets it.
import { z } from 'zod';
import { isOnboarded, isTimezone, NAME_MAX, resolved, updateUserConfig, userConfig } from './user-config.ts';

export { NAME_MAX, objectPronoun, userName, userPossessive } from './user-config.ts';

export interface Profile {
  /** Display name, trimmed. Empty when nobody has set it yet. */
  name: string;
  pronouns: string;
  email: string;
  /** The saved zone, or the resolved one (OMNI_TZ, else the system's) when none is saved. */
  timezone: string;
  /** False until onboarding finished: both clients then show the wizard. */
  onboarded: boolean;
}

export const profileInput = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(NAME_MAX, `Keep the name under ${NAME_MAX} characters.`).optional(),
  pronouns: z.string().trim().max(40, 'Keep pronouns under 40 characters.').optional(),
  email: z.union([z.literal(''), z.email('Enter a valid email, or leave it empty.')]).optional(),
  timezone: z
    .string()
    .trim()
    .refine((tz) => tz === '' || isTimezone(tz), 'Unknown timezone. Use an IANA name like Europe/Amsterdam.')
    .optional(),
});

export function getProfile(): Profile {
  const u = userConfig().user;
  return { name: u.name, pronouns: resolved.pronouns(), email: u.email, timezone: u.timezone || resolved.timezone(), onboarded: isOnboarded() };
}

/** Saves fields the route already validated with `profileInput`. Runs of whitespace inside the name collapse to one space. */
export function setProfile(p: z.infer<typeof profileInput>): Profile {
  const user: Partial<ReturnType<typeof userConfig>['user']> = { ...p };
  if (p.name !== undefined) user.name = p.name.trim().replace(/\s+/g, ' ');
  if (p.pronouns !== undefined) user.pronouns = p.pronouns || 'they/them';
  updateUserConfig({ user });
  return getProfile();
}
