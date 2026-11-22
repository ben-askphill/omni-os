/** A crew role as /api/crew lists it: its id and the name its charter gives it. */
export interface CrewName {
  id: string;
  name: string;
}

/** The names of the built-in agents, for a thread shown before the agent list loads. */
const BUILT_IN_NAMES: Readonly<Record<string, string>> = {
  conductor: 'Conductor',
  researcher: 'Researcher',
  builder: 'Builder',
  'store-ops': 'Store ops',
  inbox: 'Inbox',
};

/** A built-in agent's name, by its id. */
export const builtInName = (id: string): string | undefined => (Object.hasOwn(BUILT_IN_NAMES, id) ? BUILT_IN_NAMES[id] : undefined);

/**
 * The name a thread's crew role goes by, as the thread header and Details show it: the name its charter gives it (a
 * user's own charter in data/crew included), else its built-in name, else the id as stored. Null when the thread was
 * not started as a crew role.
 */
export function crewRoleName(role: string | null | undefined, crew: readonly CrewName[] = []): string | null {
  if (!role) return null;
  const listed = crew.find((r) => r.id === role)?.name?.trim();
  if (listed) return listed;
  return builtInName(role) ?? role;
}

/**
 * Whether the thread header names the thread's crew role. The Conductor's own threads already say so with its avatar
 * and the #conductor crumb, so only those leave it out.
 */
export const headerShowsRole = (thread: { role?: string | null; channel_id: string }) => !!thread.role && !(thread.role === 'conductor' && thread.channel_id === 'conductor');
