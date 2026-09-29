import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The Supabase transport's Realtime side, against a stand-in for @supabase/supabase-js. Nothing here reaches
// the network: the client, its sign-in and its channels are all fakes.

type Status = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';
interface FakeChannel {
  name: string;
  filter: Record<string, string>;
  onInsert: (p: { new: Record<string, unknown> }) => void;
  onStatus: (s: Status) => void;
  removed: boolean;
}

const fake = vi.hoisted(() => ({
  channels: [] as FakeChannel[],
  signIns: 0,
  failSignIns: 0,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    const client = {
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        refreshSession: async () => {
          fake.signIns++;
          if (fake.failSignIns > 0) {
            fake.failSignIns--;
            return { data: { user: null, session: null }, error: { message: 'fetch failed' } };
          }
          return { data: { user: { id: 'user-1' }, session: { refresh_token: 'r0' } }, error: null };
        },
      },
      channel(name: string) {
        const ch = { name, removed: false } as FakeChannel;
        const api = {
          on(_type: string, filter: Record<string, string>, cb: FakeChannel['onInsert']) {
            ch.filter = filter;
            ch.onInsert = cb;
            return api;
          },
          subscribe(cb: FakeChannel['onStatus']) {
            ch.onStatus = cb;
            fake.channels.push(ch);
            return api;
          },
        };
        return api;
      },
      async removeChannel(api: unknown) {
        void api;
        fake.channels.at(-1)!.removed = true;
      },
    };
    return client;
  },
}));

const { createSupabaseTransport } = await import('../server/sync/transport.ts');
const transport = () =>
  createSupabaseTransport({ url: 'https://example.invalid', anonKey: 'anon', refreshToken: 'r0', onRefreshToken: () => {} });

beforeEach(() => {
  fake.channels.length = 0;
  fake.signIns = 0;
  fake.failSignIns = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the Supabase Realtime subscription', () => {
  it('listens for inserts from other machines, filtered on the relay and again here', async () => {
    const nudges = vi.fn();
    const off = transport().subscribe!('mac-a', nudges);
    await vi.waitFor(() => expect(fake.channels).toHaveLength(1));
    const ch = fake.channels[0];
    expect(ch.filter).toMatchObject({ event: 'INSERT', schema: 'public', table: 'changes', filter: 'machine_id=neq.mac-a' });
    ch.onInsert({ new: { machine_id: 'mac-b' } });
    ch.onInsert({ new: { machine_id: 'mac-a' } });
    expect(nudges).toHaveBeenCalledTimes(1);
    off();
    expect(ch.removed).toBe(true);
  });

  it('syncs each time the channel is joined: first, and again after a drop, since pushes in the gap sent no event', async () => {
    const nudges = vi.fn();
    const off = transport().subscribe!('mac-a', nudges);
    await vi.waitFor(() => expect(fake.channels).toHaveLength(1));
    const ch = fake.channels[0];
    ch.onStatus('SUBSCRIBED');
    expect(nudges).toHaveBeenCalledTimes(1);
    ch.onStatus('CHANNEL_ERROR');
    ch.onStatus('TIMED_OUT');
    expect(nudges).toHaveBeenCalledTimes(1);
    ch.onStatus('SUBSCRIBED');
    expect(nudges).toHaveBeenCalledTimes(2);
    off();
  });

  it('keeps trying to sign in when the server starts offline, then subscribes and syncs', async () => {
    vi.useFakeTimers();
    fake.failSignIns = 2;
    const nudges = vi.fn();
    const off = transport().subscribe!('mac-a', nudges);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.signIns).toBe(1);
    expect(fake.channels).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.signIns).toBe(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fake.signIns).toBe(3);
    expect(fake.channels).toHaveLength(1);
    fake.channels[0].onStatus('SUBSCRIBED');
    expect(nudges).toHaveBeenCalledTimes(1);
    off();
  });

  it('stops retrying once unsubscribed', async () => {
    vi.useFakeTimers();
    fake.failSignIns = 100;
    const off = transport().subscribe!('mac-a', () => {});
    await vi.advanceTimersByTimeAsync(0);
    off();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fake.signIns).toBe(1);
    expect(fake.channels).toHaveLength(0);
  });
});
