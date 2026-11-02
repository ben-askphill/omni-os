import {
  createHttpClient,
  createOmniApi,
  OmniHttpError,
  parseBaseUrl,
  type Fetch,
  type OmniApi,
} from '@omni/client-core';
import type { AppPushPreferences, AppPushPreferencesUpdate, AppPushTokenRequest } from '@omni/shared/app-pairing.ts';

import type { PushServer } from './registration';
import type { ThreadProbe } from './tap';

const TIMEOUT_MS = 10_000;

export interface PushServerApi {
  register(server: PushServer, body: AppPushTokenRequest): Promise<void>;
  probeThread(server: PushServer, threadId: string): Promise<ThreadProbe>;
  preferences(server: PushServer): Promise<AppPushPreferences>;
  setPreferences(server: PushServer, update: AppPushPreferencesUpdate): Promise<AppPushPreferences>;
}

export interface PushServerApiDeps {
  /** The server's session token from the vault, read for every request. */
  getToken(serverId: string): Promise<string | null>;
  fetch?: Fetch;
}

/** The push calls on any paired server, not only the active one: each request carries that server's own token. */
export function createPushServerApi(deps: PushServerApiDeps): PushServerApi {
  function apiFor(server: PushServer): OmniApi {
    const baseUrl = parseBaseUrl(server.origin);
    if (!baseUrl) throw new Error(`Not a server address: ${server.origin}`);
    return createOmniApi(
      createHttpClient({ baseUrl, token: () => deps.getToken(server.id).catch(() => null), fetch: deps.fetch, timeoutMs: TIMEOUT_MS }),
    );
  }

  return {
    async register(server, body) {
      await apiFor(server).registerPushToken(body);
    },
    async probeThread(server, threadId) {
      try {
        await apiFor(server).thread(threadId);
        return 'found';
      } catch (error) {
        return error instanceof OmniHttpError && error.failure.kind === 'http' && error.failure.status === 404 ? 'missing' : 'error';
      }
    },
    preferences: (server) => apiFor(server).pushPreferences(),
    setPreferences: (server, update) => apiFor(server).setPushPreferences(update),
  };
}

/** A sentence for a failed preferences call. */
export function describePushError(error: unknown): string {
  return error instanceof OmniHttpError ? error.message : 'Could not reach the server.';
}
