import type { Fetch, SSEConnection, SSESink, SSETransport } from '@omni/client-core';
import type { ServerCapabilities } from '@omni/shared/app-pairing.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLiveHub } from '../live/hub';
import { PairingApiError, type PairingApi } from '../pairing/api';
import { createPairingService } from '../pairing/service';
import { emptyIndex, parseServerIndex, type ServerIndex } from '../pairing/servers';
import type { CredentialVault } from '../pairing/vault';
import { pairedSession } from './paired-session';

const ORIGIN = 'https://omni.example.com';

const capabilities: ServerCapabilities = {
  api: 1,
  auth: { via: 'session', method: 'pairing', sessionId: 's1' },
  pairing: { app: true, codeTtlSeconds: 300 },
  push: { registration: true, delivery: false },
  streams: { sse: true, closeOnRevoke: true },
};

/** The pairing service, the vault and a server that can revoke this phone, wired to a live hub as the app wires them. */
async function pairedApp() {
  let index: ServerIndex = emptyIndex;
  const tokens = new Map<string, string>();
  const vault: CredentialVault = {
    loadIndex: async () => parseServerIndex(JSON.parse(JSON.stringify(index))),
    saveIndex: async (next) => {
      index = next;
    },
    getToken: async (id) => tokens.get(id) ?? null,
    setToken: async (id, token) => {
      tokens.set(id, token);
    },
    deleteToken: async (id) => {
      tokens.delete(id);
    },
  };

  const server = { revoked: false };
  const api: PairingApi = {
    redeemPairingCode: async () => ({ token: 'tok', sessionId: 'sess' }),
    fetchCapabilities: async () => {
      if (server.revoked) throw new PairingApiError('unauthorized', { origin: ORIGIN, status: 401 });
      return capabilities;
    },
    signOut: async () => {},
    deletePushToken: async () => {},
  };
  const service = createPairingService({ api, vault, now: () => new Date(), newId: () => 'srv1' });
  const { server: paired } = await service.pairServer({ origin: ORIGIN, code: 'abc', name: 'iPhone' });

  const session = pairedSession(paired, {
    getToken: (id) => vault.getToken(id),
    confirmSignedIn: async (id) => (await service.checkServer(id)).kind === 'ready',
  });

  const requests: { path: string; authorization: string | undefined }[] = [];
  const fetch: Fetch = async (url, init) => {
    const path = new URL(url).pathname;
    requests.push({ path, authorization: init.headers.authorization });
    const status = server.revoked ? 401 : 200;
    return {
      status,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
      text: async () => JSON.stringify(status === 401 ? { error: 'Unauthorized' } : []),
    };
  };

  const sinks: SSESink[] = [];
  const transport: SSETransport = (_request, sink): SSEConnection => {
    sinks.push(sink);
    return { close() {} };
  };

  const hub = createLiveHub({ session, transport, fetch });
  return { hub, server, sinks, requests, stored: () => index, tokens };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('a server that revokes this phone', () => {
  it('sends the app back to Connect when an HTTP request gets a 401', async () => {
    const app = await pairedApp();
    await vi.advanceTimersByTimeAsync(0);
    expect(app.stored().servers).toHaveLength(1);
    expect(app.requests[0]).toEqual({ path: '/api/channels', authorization: 'Bearer tok' });

    app.server.revoked = true;
    await app.hub.refreshChannels();
    await vi.advanceTimersByTimeAsync(0);

    expect(app.stored()).toEqual(emptyIndex);
    expect(app.tokens.size).toBe(0);
    app.hub.close();
  });

  it('sends the app back to Connect when the event stream gets a 401', async () => {
    const app = await pairedApp();
    await vi.advanceTimersByTimeAsync(0);
    expect(app.sinks).toHaveLength(1);

    app.server.revoked = true;
    app.sinks[0]?.error({ status: 401 });
    await vi.advanceTimersByTimeAsync(0);

    expect(app.stored()).toEqual(emptyIndex);
    expect(app.tokens.size).toBe(0);
    app.hub.close();
  });

  it('keeps the server when a 401 turns out to be a one-off', async () => {
    const app = await pairedApp();
    await vi.advanceTimersByTimeAsync(0);

    app.sinks[0]?.error({ status: 401 });
    await vi.advanceTimersByTimeAsync(0);

    expect(app.stored().servers).toHaveLength(1);
    expect(app.tokens.get('srv1')).toBe('tok');
    app.hub.close();
  });
});
