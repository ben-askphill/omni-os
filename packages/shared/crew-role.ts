// Who an agent is, wherever it shows: its name and whether it is the Conductor. The one place for the built-in agents,
// the id-to-name lookup and the Conductor check, for the server, the Web UI, the desktop app and the iOS app alike.
import type { CrewShapeId } from './crew-shapes.ts';

/** A crew role as /api/crew lists it: its id and the name its charter gives it. */
export interface CrewName {
  id: string;
  name: string;
}

/** The Conductor's agent id. Its channel has the same id (channel-icon.ts CONDUCTOR_CHANNEL). */
export const CONDUCTOR_ROLE = 'conductor';

/**
 * Whether a thread, by the agent id it runs as, is the Conductor's. A thread in #conductor that runs as another agent
 * (a member's session, or one started as that agent) is not: ask about the channel separately.
 */
export const isConductor = (role: string | null | undefined) => role === CONDUCTOR_ROLE;

export interface BuiltInAgent {
  /** The name its charter gives it (crew/<id>.md), for a thread shown before the agent list loads. */
  name: string;
  /** The crew shape it takes when its file names none (ADR 0021, D2). Kept in code: an overlay replaces a file's whole avatar map. */
  shape: CrewShapeId;
}

/**
 * The built-in agents: every one Omni ships in crew/, plus Store ops and Hermes, which do not ship as a crew file. The
 * only list of them in code; apps/server/tests/crew-built-ins.test.ts holds the names to the shipped charters.
 */
export const BUILT_IN_AGENTS: Readonly<Record<string, BuiltInAgent>> = {
  conductor: { name: 'Conductor', shape: 'circle' },
  researcher: { name: 'Researcher', shape: 'droplet' },
  builder: { name: 'Builder', shape: 'squircle' },
  reviewer: { name: 'Reviewer', shape: 'pill-wide' },
  writer: { name: 'Writer', shape: 'arch' },
  inbox: { name: 'Admin', shape: 'tray' },
  'store-ops': { name: 'Store ops', shape: 'triangle' },
  'usage-scan': { name: 'Usage scan', shape: 'pill-tall' },
  hermes: { name: 'Hermes', shape: 'pebble' },
};

/** A built-in agent by its id, or undefined. Never a key of Object.prototype. */
export const builtInAgent = (id: string): BuiltInAgent | undefined => (Object.hasOwn(BUILT_IN_AGENTS, id) ? BUILT_IN_AGENTS[id] : undefined);

/** Where crewRoleName looks an agent up: the list /api/crew sends, or a lookup by id (the server's getCrew). */
export type CrewNames = readonly CrewName[] | ((id: string) => CrewName | undefined);

/**
 * The name an agent goes by, as thread headers, Details, author lines and the agents' own prompts say it: the name its
 * charter gives it (a user's own charter in data/crew included), else its built-in name, else the id as stored. Null
 * only when there is no agent (a thread not started as one).
 */
export function crewRoleName(role: string, crew?: CrewNames): string;
export function crewRoleName(role: string | null | undefined, crew?: CrewNames): string | null;
export function crewRoleName(role: string | null | undefined, crew: CrewNames = []): string | null {
  if (role === null || role === undefined) return null;
  const listed = (typeof crew === 'function' ? crew(role) : crew.find((r) => r.id === role))?.name?.trim();
  if (listed) return listed;
  return builtInAgent(role)?.name ?? role;
}

/**
 * Whether the thread header names the thread's crew role. The Conductor's own threads already say so with its avatar
 * and the #conductor crumb, so only those leave it out.
 */
export const headerShowsRole = (thread: { role?: string | null; channel_id: string }) => !!thread.role && !(isConductor(thread.role) && thread.channel_id === 'conductor');
