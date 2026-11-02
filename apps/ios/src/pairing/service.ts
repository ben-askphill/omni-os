import type { ServerCapabilities } from '@omni/shared/app-pairing.ts';

import { PairingApiError, type PairingApi } from './api';
import {
  defaultServerName,
  removeServer as withoutServer,
  setActive,
  upsertServer,
  type PairedServer,
  type ServerIndex,
} from './servers';
import type { CredentialVault } from './vault';

const DEFAULT_SIGN_OUT_CAP_MS = 5_000;

export interface PairingServiceDeps {
  api: PairingApi;
  vault: CredentialVault;
  now(): Date;
  newId(): string;
  signOutCapMs?: number;
}

export interface PairResult {
  server: PairedServer;
  capabilities: ServerCapabilities;
  index: ServerIndex;
}

export type CheckResult =
  | { kind: 'ready'; capabilities: ServerCapabilities }
  | { kind: 'unreachable' }
  | { kind: 'incompatible'; api?: number }
  /** The server no longer accepts this phone, and the local token and record are already gone. */
  | { kind: 'revoked'; name: string; index: ServerIndex }
  /** The server was removed or re-paired while the check ran, so its answer no longer applies. */
  | { kind: 'stale' };

export interface PairingService {
  loadIndex(): Promise<ServerIndex>;
  /** `name` is this phone's name as the server will list it, not the server's. */
  pairServer(input: { origin: string; code: string; name: string }): Promise<PairResult>;
  checkServer(id: string): Promise<CheckResult>;
  removeServer(id: string): Promise<ServerIndex>;
  selectServer(id: string): Promise<ServerIndex>;
}

export function createPairingService(deps: PairingServiceDeps): PairingService {
  const { api, vault } = deps;
  const signOutCapMs = deps.signOutCapMs ?? DEFAULT_SIGN_OUT_CAP_MS;

  // Every change reads the index, edits it and writes it back. Run them one at a time so two cannot interleave.
  let queue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  async function signOutBestEffort(origin: string, token: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The push token goes first: it needs the session that signing out ends. One cap covers both calls.
    const attempt = (async () => {
      await api.deletePushToken({ origin, token }).catch(() => undefined);
      await api.signOut({ origin, token });
    })().catch(() => undefined);
    const cap = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, signOutCapMs);
    });
    try {
      await Promise.race([attempt, cap]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Deletes the token and the record. With `onlyIfToken`, leaves a server alone whose token has changed since. */
  function forgetServer(
    id: string,
    options: { revoke: boolean; onlyIfToken?: string | null },
  ): Promise<{ index: ServerIndex; forgotten: PairedServer | null }> {
    return exclusive(async () => {
      const index = await vault.loadIndex();
      const server = index.servers.find((candidate) => candidate.id === id);
      if (!server) return { index, forgotten: null };

      const token = await vault.getToken(id).catch(() => null);
      if (options.onlyIfToken !== undefined && token !== options.onlyIfToken) {
        return { index, forgotten: null };
      }
      if (options.revoke && token !== null) await signOutBestEffort(server.origin, token);

      await vault.deleteToken(id);
      const next = withoutServer(index, id);
      await vault.saveIndex(next);
      return { index: next, forgotten: server };
    });
  }

  async function pairServer(input: {
    origin: string;
    code: string;
    name: string;
  }): Promise<PairResult> {
    const { token, sessionId } = await api.redeemPairingCode(input);

    let capabilities: ServerCapabilities;
    try {
      capabilities = await api.fetchCapabilities({ origin: input.origin, token });
    } catch (error) {
      await signOutBestEffort(input.origin, token);
      throw error;
    }

    let stored: { server: PairedServer; index: ServerIndex; replacedToken: string | null };
    try {
      stored = await exclusive(async () => {
        const index = await vault.loadIndex();
        const existing = index.servers.find((candidate) => candidate.origin === input.origin);
        const server: PairedServer = {
          id: existing?.id ?? deps.newId(),
          name: existing?.name ?? defaultServerName(input.origin),
          origin: input.origin,
          sessionId,
          pairedAt: deps.now().toISOString(),
        };
        const replacedToken = existing ? await vault.getToken(existing.id).catch(() => null) : null;

        await vault.setToken(server.id, token);
        try {
          const next = upsertServer(index, server);
          await vault.saveIndex(next);
          return { server, index: next, replacedToken };
        } catch (error) {
          if (!existing) await vault.deleteToken(server.id).catch(() => undefined);
          throw error;
        }
      });
    } catch (error) {
      await signOutBestEffort(input.origin, token);
      throw error;
    }
    if (stored.replacedToken !== null) await signOutBestEffort(input.origin, stored.replacedToken);
    return { server: stored.server, index: stored.index, capabilities };
  }

  async function checkServer(id: string): Promise<CheckResult> {
    const index = await vault.loadIndex();
    const server = index.servers.find((candidate) => candidate.id === id);
    if (!server) return { kind: 'stale' };

    const token = await vault.getToken(id);
    if (token === null) return revoked(id, null);

    try {
      const capabilities = await api.fetchCapabilities({ origin: server.origin, token });
      return { kind: 'ready', capabilities };
    } catch (error) {
      if (!(error instanceof PairingApiError)) throw error;
      switch (error.kind) {
        case 'unauthorized':
          return revoked(id, token);
        case 'incompatible':
          return { kind: 'incompatible', ...(error.api !== undefined && { api: error.api }) };
        default:
          return { kind: 'unreachable' };
      }
    }
  }

  async function revoked(id: string, usedToken: string | null): Promise<CheckResult> {
    const { index, forgotten } = await forgetServer(id, { revoke: false, onlyIfToken: usedToken });
    return forgotten ? { kind: 'revoked', name: forgotten.name, index } : { kind: 'stale' };
  }

  return {
    loadIndex: () => vault.loadIndex(),
    pairServer,
    checkServer,
    async removeServer(id) {
      return (await forgetServer(id, { revoke: true })).index;
    },
    selectServer(id) {
      return exclusive(async () => {
        const next = setActive(await vault.loadIndex(), id);
        await vault.saveIndex(next);
        return next;
      });
    },
  };
}
