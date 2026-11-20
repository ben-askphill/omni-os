// The wire protocols a remote harness speaks, behind one client shape the adapter (hermes/adapter.ts), the test turn
// (agent-connect.ts) and the availability probe (catalog-service.ts) share: the Runs API (Hermes, and a server that
// serves it) and an eve agent's own API (eve/client.ts, ADR 0018).
import { EveClient, probeEve } from './eve/client.ts';
import { HermesClient, probeRunsApi, type RunsApiProbe } from './hermes/client.ts';

export type RemoteKind = 'runs-api' | 'eve';

/** The calls a remote turn makes. */
export type RemoteClient = Pick<HermesClient, 'createRun' | 'events' | 'getRun' | 'steer' | 'stop' | 'toolResult'>;

export const remoteClient = (kind: RemoteKind, url: string, key: string): RemoteClient => (kind === 'eve' ? new EveClient(url, key) : new HermesClient(url, key));

/** The signed-in probe a kind answers, for messages: "answered HTTP 404 to GET /eve/v1/info". */
export const probeRoute = (kind: RemoteKind) => (kind === 'eve' ? 'GET /eve/v1/info' : 'GET /v1/capabilities');

/** A signed-in probe: up, the key refused, another status, or no answer. An eve agent's also names its model. */
export async function probeRemote(kind: RemoteKind, url: string, key: string): Promise<RunsApiProbe & { model?: string }> {
  return kind === 'eve' ? probeEve(url, key) : probeRunsApi(url, key);
}
