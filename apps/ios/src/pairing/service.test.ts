import type { ServerCapabilities } from '@omni/shared/app-pairing.ts';
import { describe, expect, it } from 'vitest';

import { PairingApiError, type PairingApi } from './api';
import { createPairingService } from './service';
import { emptyIndex, parseServerIndex, type ServerIndex } from './servers';
import type { CredentialVault } from './vault';

const ORIGIN = 'https://omni.example.com';
const OTHER_ORIGIN = 'https://studio.example.com';

const capabilities: ServerCapabilities = {
  api: 1,
  auth: { via: 'session', method: 'pairing', sessionId: 's1' },
  pairing: { app: true, codeTtlSeconds: 300 },
  push: { registration: true, delivery: false },
  streams: { sse: true, closeOnRevoke: true },
};

function memoryVault(initial: ServerIndex = emptyIndex) {
  let index = initial;
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
  return { vault, tokens, index: () => index };
}

interface FakeApi extends PairingApi {
  signedOut: { origin: string; token: string }[];
  /** Every call that ended the session or its push token, in order. */
  calls: string[];
}

function fakeApi(overrides: Partial<PairingApi> = {}): FakeApi {
  const signedOut: { origin: string; token: string }[] = [];
  const calls: string[] = [];
  let issued = 0;
  return {
    signedOut,
    calls,
    redeemPairingCode: async () => {
      issued += 1;
      return { token: `token-${issued}`, sessionId: `session-${issued}` };
    },
    fetchCapabilities: async () => capabilities,
    signOut: async (input) => {
      calls.push('signOut');
      signedOut.push(input);
    },
    deletePushToken: async () => {
      calls.push('deletePushToken');
    },
    ...overrides,
  };
}

function setup(apiOverrides: Partial<PairingApi> = {}, signOutCapMs = 5000) {
  const store = memoryVault();
  const api = fakeApi(apiOverrides);
  let ids = 0;
  const service = createPairingService({
    api,
    vault: store.vault,
    now: () => new Date('2026-11-02T10:00:00.000Z'),
    newId: () => `id${(ids += 1)}`,
    signOutCapMs,
  });
  return { service, store, api };
}

const pairInput = { origin: ORIGIN, code: 'abc', name: 'iPhone' };

describe('pairServer', () => {
  it('stores the token, records the server and makes it active', async () => {
    const { service, store } = setup();

    const result = await service.pairServer(pairInput);

    expect(result.server).toMatchObject({ origin: ORIGIN, name: 'omni.example.com', sessionId: 'session-1' });
    expect(result.capabilities).toEqual(capabilities);
    expect(store.tokens.get(result.server.id)).toBe('token-1');
    expect(store.index().activeId).toBe(result.server.id);
    expect(store.index().servers).toHaveLength(1);
  });

  it('signs the new session out and stores nothing when the server is incompatible', async () => {
    const { service, store, api } = setup({
      fetchCapabilities: async () => {
        throw new PairingApiError('incompatible', { origin: ORIGIN, api: 2 });
      },
    });

    await expect(service.pairServer(pairInput)).rejects.toMatchObject({ kind: 'incompatible' });

    expect(api.signedOut).toEqual([{ origin: ORIGIN, token: 'token-1' }]);
    expect(store.tokens.size).toBe(0);
    expect(store.index()).toEqual(emptyIndex);
  });

  it('signs the new session out when the server is unreachable for the capability check', async () => {
    const { service, store, api } = setup({
      fetchCapabilities: async () => {
        throw new PairingApiError('unreachable', { origin: ORIGIN });
      },
    });

    await expect(service.pairServer(pairInput)).rejects.toMatchObject({ kind: 'unreachable' });

    expect(api.signedOut).toHaveLength(1);
    expect(store.tokens.size).toBe(0);
  });

  it('keeps one record when the same server is paired again, and signs the old session out', async () => {
    const { service, store, api } = setup();
    const first = await service.pairServer(pairInput);

    const second = await service.pairServer(pairInput);

    expect(second.server.id).toBe(first.server.id);
    expect(store.index().servers).toHaveLength(1);
    expect(store.tokens.get(first.server.id)).toBe('token-2');
    expect(api.signedOut).toEqual([{ origin: ORIGIN, token: 'token-1' }]);
  });

  it('keeps several servers and activates the newest', async () => {
    const { service, store } = setup();
    const a = await service.pairServer(pairInput);
    const b = await service.pairServer({ ...pairInput, origin: OTHER_ORIGIN });

    expect(store.index().servers.map((s) => s.id)).toEqual([a.server.id, b.server.id]);
    expect(store.index().activeId).toBe(b.server.id);
    expect(store.tokens.get(a.server.id)).toBe('token-1');
    expect(store.tokens.get(b.server.id)).toBe('token-2');
  });
});

describe('checkServer', () => {
  it('reports ready when the server answers', async () => {
    const { service } = setup();
    const { server } = await service.pairServer(pairInput);
    await expect(service.checkServer(server.id)).resolves.toEqual({ kind: 'ready', capabilities });
  });

  it('forgets the token and record on a 401 and says which server was revoked', async () => {
    let revoked = false;
    const { service, store, api } = setup({
      fetchCapabilities: async () => {
        if (revoked) throw new PairingApiError('unauthorized', { origin: ORIGIN, status: 401 });
        return capabilities;
      },
    });
    const { server } = await service.pairServer(pairInput);
    revoked = true;

    const result = await service.checkServer(server.id);

    expect(result).toMatchObject({ kind: 'revoked', name: 'omni.example.com' });
    expect(store.tokens.size).toBe(0);
    expect(store.index()).toEqual(emptyIndex);
    expect(api.signedOut).toEqual([]);
  });

  it('keeps the record when the server is unreachable', async () => {
    let down = false;
    const { service, store } = setup({
      fetchCapabilities: async () => {
        if (down) throw new PairingApiError('unreachable', { origin: ORIGIN });
        return capabilities;
      },
    });
    const { server } = await service.pairServer(pairInput);
    down = true;

    await expect(service.checkServer(server.id)).resolves.toEqual({ kind: 'unreachable' });

    expect(store.tokens.get(server.id)).toBe('token-1');
    expect(store.index().servers).toHaveLength(1);
  });

  it('reports the unsupported api version and keeps the record', async () => {
    let upgraded = false;
    const { service, store } = setup({
      fetchCapabilities: async () => {
        if (upgraded) throw new PairingApiError('incompatible', { origin: ORIGIN, api: 2 });
        return capabilities;
      },
    });
    const { server } = await service.pairServer(pairInput);
    upgraded = true;

    await expect(service.checkServer(server.id)).resolves.toEqual({ kind: 'incompatible', api: 2 });
    expect(store.index().servers).toHaveLength(1);
  });

  it('treats a record whose token is gone as revoked', async () => {
    const { service, store } = setup();
    const { server } = await service.pairServer(pairInput);
    store.tokens.delete(server.id);

    await expect(service.checkServer(server.id)).resolves.toMatchObject({ kind: 'revoked' });
    expect(store.index()).toEqual(emptyIndex);
  });

  it('does not delete a server that was paired again while the check was in flight', async () => {
    let calls = 0;
    let entered: () => void = () => undefined;
    const inFlight = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release: () => void = () => undefined;
    const { service, store } = setup({
      fetchCapabilities: async () => {
        calls += 1;
        if (calls !== 2) return capabilities;
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        throw new PairingApiError('unauthorized', { origin: ORIGIN, status: 401 });
      },
    });
    const { server } = await service.pairServer(pairInput);

    const pending = service.checkServer(server.id);
    await inFlight;
    await service.pairServer(pairInput);
    release();

    await expect(pending).resolves.toEqual({ kind: 'stale' });
    expect(store.tokens.get(server.id)).toBe('token-2');
    expect(store.index().servers).toHaveLength(1);
  });
});

describe('removeServer', () => {
  it('signs the session out and deletes the token and record', async () => {
    const { service, store, api } = setup();
    const { server } = await service.pairServer(pairInput);

    const index = await service.removeServer(server.id);

    expect(api.signedOut).toEqual([{ origin: ORIGIN, token: 'token-1' }]);
    expect(store.tokens.size).toBe(0);
    expect(index).toEqual(emptyIndex);
  });

  it('takes the push token off the server before the session ends', async () => {
    const { service, api } = setup();
    const { server } = await service.pairServer(pairInput);

    await service.removeServer(server.id);

    expect(api.calls).toEqual(['deletePushToken', 'signOut']);
  });

  it('signs out even when the push token cannot be deleted', async () => {
    const { service, api } = setup({
      deletePushToken: async () => {
        throw new PairingApiError('unreachable', { origin: ORIGIN });
      },
    });
    const { server } = await service.pairServer(pairInput);

    await service.removeServer(server.id);

    expect(api.signedOut).toEqual([{ origin: ORIGIN, token: 'token-1' }]);
  });

  it('still deletes locally when signing out fails', async () => {
    const { service, store } = setup({
      signOut: async () => {
        throw new PairingApiError('unreachable', { origin: ORIGIN });
      },
    });
    const { server } = await service.pairServer(pairInput);

    await expect(service.removeServer(server.id)).resolves.toEqual(emptyIndex);
    expect(store.tokens.size).toBe(0);
    expect(store.index()).toEqual(emptyIndex);
  });

  it('does not wait on a sign-out that never answers', async () => {
    const { service, store } = setup({ signOut: () => new Promise<void>(() => undefined) }, 20);
    const { server } = await service.pairServer(pairInput);

    await service.removeServer(server.id);

    expect(store.tokens.size).toBe(0);
  });

  it('activates the remaining server when the active one is removed', async () => {
    const { service } = setup();
    const a = await service.pairServer(pairInput);
    const b = await service.pairServer({ ...pairInput, origin: OTHER_ORIGIN });

    const index = await service.removeServer(b.server.id);

    expect(index.activeId).toBe(a.server.id);
  });
});

describe('selectServer', () => {
  it('makes another server active', async () => {
    const { service, store } = setup();
    const a = await service.pairServer(pairInput);
    await service.pairServer({ ...pairInput, origin: OTHER_ORIGIN });

    await service.selectServer(a.server.id);

    expect(store.index().activeId).toBe(a.server.id);
  });
});
