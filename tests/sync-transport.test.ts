import { describe, it, expect, vi } from 'vitest';
import { createSupabaseTransport, isSignedOut } from '../server/sync/transport.ts';

// The Supabase transport's token handling, against a stand-in for supabase-js. Nothing reaches the network.

type Reply = { data?: unknown; error: { message: string; code?: string; status?: number; name?: string } | null };

/** A fake supabase-js client. Each refresh rotates the token; rpc answers come from a queue. */
function fakeSupabase() {
  const listeners: ((event: string, s: { refresh_token: string } | null) => void)[] = [];
  const refreshes: string[] = [];
  const rpcs: Reply[] = [];
  const refreshReplies: Reply[] = [];
  let rotation = 0;
  let clients = 0;
  const create = () => {
    clients++;
    return {
      auth: {
        onAuthStateChange: (fn: (typeof listeners)[number]) => {
          listeners.push(fn);
          return { data: { subscription: { unsubscribe() {} } } };
        },
        refreshSession: async ({ refresh_token }: { refresh_token: string }) => {
          refreshes.push(refresh_token);
          const r = refreshReplies.shift();
          if (r?.error) return { data: { user: null, session: null }, error: r.error };
          const next = `rt-${++rotation}`;
          return { data: { user: { id: 'user-1' }, session: { refresh_token: next, access_token: 'at' } }, error: null };
        },
        stopAutoRefresh: async () => {},
      },
      rpc: async () => rpcs.shift() ?? { data: null, error: null },
    } as never;
  };
  return {
    create,
    refreshes,
    rpcs,
    refreshReplies,
    get clients() {
      return clients;
    },
    /** What supabase-js does when its own timer refreshes or gives up. */
    emit: (event: string, token?: string) => listeners.at(-1)!(event, token ? { refresh_token: token } : null),
  };
}

const transport = (fake: ReturnType<typeof fakeSupabase>, stored: string[]) =>
  createSupabaseTransport({
    url: 'https://example.supabase.co',
    anonKey: 'anon',
    refreshToken: 'rt-0',
    onRefreshToken: (t) => void stored.push(t),
    createClient: fake.create,
  });

describe('supabase transport tokens', () => {
  it('signs in lazily and stores each rotated refresh token', async () => {
    const fake = fakeSupabase();
    const stored: string[] = [];
    const t = transport(fake, stored);
    expect(fake.clients).toBe(0);
    await t.push([]);
    await t.push([]);
    expect(fake.refreshes).toEqual(['rt-0']);
    expect(stored).toEqual(['rt-1']);
    fake.emit('TOKEN_REFRESHED', 'rt-9');
    fake.emit('TOKEN_REFRESHED', 'rt-9');
    // Stores run one after another, so the new one lands a tick later.
    await new Promise((r) => setTimeout(r, 0));
    expect(stored).toEqual(['rt-1', 'rt-9']);
  });

  it('signs in again with the newest token and retries once when the access token expired', async () => {
    const fake = fakeSupabase();
    const stored: string[] = [];
    const t = transport(fake, stored);
    fake.rpcs.push({ error: { message: 'JWT expired', code: 'PGRST303' } }, { error: null });
    await t.push([]);
    expect(fake.refreshes).toEqual(['rt-0', 'rt-1']);
    expect(stored).toEqual(['rt-1', 'rt-2']);
    // A second refusal in a row is an error, not a loop.
    fake.rpcs.push({ error: { message: 'JWT expired' } }, { error: { message: 'JWT expired' } });
    await expect(t.push([])).rejects.toThrow('push failed: JWT expired');
  });

  it('reports a refused refresh token as signed out, and tries again on the next call', async () => {
    const fake = fakeSupabase();
    const t = transport(fake, []);
    fake.refreshReplies.push({ error: { message: 'Invalid Refresh Token: Already Used', code: 'refresh_token_already_used', status: 400 } });
    const err = await t.push([]).catch((e) => e);
    expect(isSignedOut(err)).toBe(true);
    expect(err.message).toMatch(/sign in again/);
    await t.push([]);
    expect(fake.refreshes).toEqual(['rt-0', 'rt-0']);
  });

  it('treats a network failure while signing in as retryable, not signed out', async () => {
    const fake = fakeSupabase();
    const t = transport(fake, []);
    fake.refreshReplies.push({ error: { message: 'fetch failed', name: 'AuthRetryableFetchError', status: 0 } });
    const err = await t.push([]).catch((e) => e);
    expect(isSignedOut(err)).toBe(false);
    expect(err.message).toBe('sign-in failed: fetch failed');
  });

  it('starts over after supabase-js signs itself out', async () => {
    const fake = fakeSupabase();
    const t = transport(fake, []);
    await t.push([]);
    fake.emit('SIGNED_OUT');
    await t.push([]);
    expect(fake.clients).toBe(2);
    expect(fake.refreshes).toEqual(['rt-0', 'rt-1']);
  });

  it('never logs a token', async () => {
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    const fake = fakeSupabase();
    const t = createSupabaseTransport({
      url: 'https://example.supabase.co',
      anonKey: 'anon',
      refreshToken: 'rt-0',
      onRefreshToken: () => Promise.reject(new Error('keychain locked')),
      createClient: fake.create,
    });
    await t.push([]);
    await new Promise((r) => setTimeout(r, 0));
    const printed = [...log.mock.calls, ...error.mock.calls].flat().join(' ');
    expect(printed).toContain('keychain locked');
    expect(printed).not.toMatch(/rt-\d/);
    log.mockRestore();
    error.mockRestore();
  });
});

describe('supabase transport token storage', () => {
  it('stores rotated refresh tokens in the order they came, however long each store takes', async () => {
    const fake = fakeSupabase();
    const stored: string[] = [];
    const t = createSupabaseTransport({
      url: 'https://example.supabase.co',
      anonKey: 'anon',
      refreshToken: 'rt-0',
      // The first store is slow (a Keychain prompt, a busy `security`), the next one quick.
      onRefreshToken: (tok) => new Promise<void>((r) => setTimeout(() => (stored.push(tok), r()), tok === 'rt-a' ? 40 : 1)),
      createClient: fake.create,
    });
    await t.push([]);
    fake.emit('TOKEN_REFRESHED', 'rt-a');
    fake.emit('TOKEN_REFRESHED', 'rt-b');
    await new Promise((r) => setTimeout(r, 80));
    expect(stored.at(-1)).toBe('rt-b');
    expect(stored).toEqual(['rt-1', 'rt-a', 'rt-b']);
  });
});
