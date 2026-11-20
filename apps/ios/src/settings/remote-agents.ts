import type { CrewRole } from '@omni/client-core';
import { serverStatus } from '@omni/shared/remote-agent.ts';

/** A remote agent as Settings lists it on the phone: read-only until the app has an Agents section (crew plan S8). */
export interface RemoteAgentRow {
  id: string;
  name: string;
  ok: boolean;
  /** "Connected", or why not, with Show technical details off too (Q30). */
  status: string;
  /** Its address, kind and cap, only with Show technical details on. */
  server: string | null;
}

const KIND: Record<string, string> = { 'runs-api': 'Runs API', eve: 'eve' };

/**
 * Remote agents (ADR 0020): Hermes and the servers the user connected, each an agent with a name and an avatar. They
 * left the harness lists, so Settings shows them here, each with whether it is connected.
 */
export function remoteAgentRows(agents: readonly CrewRole[], technical: boolean): RemoteAgentRow[] {
  return agents.flatMap((a) => {
    const s = a.server;
    if (!s || a.hidden) return [];
    const server = technical ? [s.host || 'No address on this machine', KIND[s.kind] ?? s.kind, `${s.cap} ${s.cap === 1 ? 'turn' : 'turns'} at once`].join(' · ') : null;
    return [{ id: a.id, name: a.name, ok: s.available, status: serverStatus(s), server }];
  });
}
