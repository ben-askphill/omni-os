import { describe, expect, it, vi } from 'vitest';
import { openFeed, openThreadLive } from '../src/live.ts';
import type { SSESink, SSETransport } from '../src/sse.ts';

const row = (id: number) => ({ id, kind: 'message', payload: '{}', created_at: '' });
const frame = (value: unknown, id?: string) => ({ event: 'message', data: JSON.stringify(value), id });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('live state', () => {
  it('opens a bounded head, replays rows and keeps a pageable snapshot gap', async () => {
    let sink!: SSESink;
    const urls: string[] = [];
    const transport: SSETransport = (request, next) => { urls.push(request.url); sink = next; return { close() {} }; };
    const details = vi.fn();
    const states = vi.fn();
    const live = await openThreadLive({
      load: async () => ({ thread: { id: 't' }, events: [row(10)], history: { from: 10, to: null, results_below: 0 } }),
      streamUrl: after => `stream?after=${after}`,
      token: () => 'token', transport, onDetail: details, onHistory: states,
    });
    await flush();
    expect(urls).toEqual(['stream?after=10']);
    sink.open();
    sink.message(frame(row(12), '12'));
    sink.message(frame(row(12), '12'));
    sink.message(frame({ kind: 'sync', catch_up: 'replay', thread: { id: 't' } }));
    expect(live.history.history.rows.map(r => r.id)).toEqual([10, 12]);
    expect(details).toHaveBeenCalledTimes(2);
    live.stream.pause();
    live.stream.resume();
    await flush();
    expect(urls).toEqual(['stream?after=10', 'stream?after=12']);
    sink.open();
    sink.message(frame({ kind: 'sync', catch_up: 'snapshot', thread: { id: 't' }, events: [row(30)], history: { from: 30, to: null, results_below: 0 } }, '30'));
    expect(live.history.history.spans).toEqual([{ from: 10, to: 13 }, { from: 30, to: null }]);
    expect(live.history.after).toBe(30);
    live.stream.close();
  });

  it('keeps older pages a user is reading when live rows pass the retention limit', async () => {
    const open = async (follows?: () => boolean) => {
      let sink!: SSESink;
      const rows = Array.from({ length: 2000 }, (_, i) => row(i + 1));
      const live = await openThreadLive({
        load: async () => ({ thread: { id: 't' }, events: rows, history: { from: 1, to: null, results_below: 0 } }),
        streamUrl: after => `stream?after=${after}`,
        token: () => null,
        transport: (_request, next) => { sink = next; return { close() {} }; },
        onDetail: vi.fn(), onHistory: vi.fn(), follows,
      });
      await flush();
      sink.open();
      sink.message(frame(row(2001), '2001'));
      live.stream.close();
      return live.history.history.rows.length;
    };
    expect(await open()).toBeLessThan(2001);
    expect(await open(() => false)).toBe(2001);
  });

  it('notifies a feed consumer to refetch after a reconnect', async () => {
    let sink!: SSESink;
    const onReconnect = vi.fn();
    const stream = openFeed({ url: '/feed', token: () => null, transport: (_request, next) => { sink = next; return { close() {} }; }, onMessage: vi.fn(), onReconnect });
    await flush();
    sink.open();
    expect(onReconnect).not.toHaveBeenCalled();
    stream.pause();
    stream.resume();
    await flush();
    sink.open();
    expect(onReconnect).toHaveBeenCalledOnce();
    stream.close();
  });
});
