import type { OmniSession } from '../live/session';

export interface PairedSessionDeps {
  /** The server's token from the vault. Null once the record is gone. */
  getToken(serverId: string): Promise<string | null>;
  /** Asks the server whether it still accepts this phone. A server that does not has been forgotten by the time this resolves false. */
  confirmSignedIn(serverId: string): Promise<boolean>;
}

/**
 * The live layer's view of one paired server. The token is read from the vault for every request, so a revoked
 * server's token is gone from the next request on. A 401 anywhere (a request or a stream) ends in `confirmSignedIn`,
 * which is where a revoked server is forgotten and the app goes back to Connect.
 */
export function pairedSession(server: { id: string; origin: string }, deps: PairedSessionDeps): OmniSession {
  return {
    serverUrl: server.origin,
    token: () => deps.getToken(server.id).catch(() => null),
    refreshAuth: () => deps.confirmSignedIn(server.id).catch(() => false),
  };
}
