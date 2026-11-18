import { CREW } from './brand.ts';

/** A crew role as /api/crew lists it: its id and the name its charter gives it. */
export interface CrewName {
  id: string;
  name: string;
}

/**
 * The name a thread's crew role goes by, as the thread header and Details show it: the name its charter gives it (a
 * user's own charter in data/crew included), else the built-in mark's label, else the id as stored. Null when the
 * thread was not started as a crew role.
 */
export function crewRoleName(role: string | null | undefined, crew: readonly CrewName[] = []): string | null {
  if (!role) return null;
  const listed = crew.find((r) => r.id === role)?.name?.trim();
  if (listed) return listed;
  return Object.hasOwn(CREW, role) ? CREW[role as keyof typeof CREW].label : role;
}

/**
 * Whether the thread header names the thread's crew role. The Conductor's own threads already say so with its avatar
 * and the #conductor crumb, so only those leave it out.
 */
export const headerShowsRole = (thread: { role?: string | null; channel_id: string }) => !!thread.role && !(thread.role === 'conductor' && thread.channel_id === 'conductor');
