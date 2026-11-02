import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeJSON,
  eventSourceTransport,
  openSSE,
  type EventSourceEvent,
  type SSEOptions,
  type SSERequest,
  type SSESink,
  type SSEState,
  type SSETransport,
} from '../src/sse.ts';

interface FakeConnection {
  request: SSERequest;
  sink: SSESink;
  closed: boolean;
  close(): void;
  send(data: unknown, id?: string): void;
  ping(): void;
}

function setup(overrides: Partial<SSEOptions<unknown>> = {}) {
  const connections: FakeConnection[] = [];
  const transport: SSETransport = (request, sink) => {
    const c: FakeConnection = {
      request,
      sink,
      closed: false,
      close: () => (c.closed = true),
      send: (data, id) => sink.message({ event: 'message', data: JSON.stringify(data), id }),
      ping: () => sink.message({ event: 'ping', data: '' }),
    };
    connections.push(c);
    return c;
  };
  const states: SSEState[] = [];
  const messages: unknown[] = [];
  const cursors: (string | null)[] = [];
  const client = openSSE({
    transport,
    request: (cursor) => {
      cursors.push(cursor);
      return { url: `/api/threads/t1/stream?after=${cursor ?? 0}`, headers: { Authorization: 'Bearer old' } };
    },
    decode: decodeJSON,
    onMessage: (m) => messages.push(m),
    onState: (s) => states.push(s),
    ...overrides,
  });
  return {
    client,
    connections,
    states,
    messages,
    cursors,
    get last() {
      return connections[connections.length - 1];
    },
    kinds: () => states.map((s) => s.kind),
    delays: () => states.flatMap((s) => (s.kind === 'reconnecting' ? [s.delayMs] : [])),
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('openSSE', () => {
  it('opens a connection and delivers decoded messages, dropping pings and data that does not parse', async () => {
    const t = setup();
    await flush();
    expect(t.connections).toHaveLength(1);
    t.last.sink.open();
    t.last.ping();
    t.last.send({ kind: 'thread' });
    t.last.sink.message({ event: 'message', data: '{not json' });
    t.last.sink.message({ event: 'message', data: '' });
    expect(t.messages).toEqual([{ kind: 'thread' }]);
    expect(t.kinds()).toEqual(['connecting', 'open']);
    expect(t.client.state).toEqual({ kind: 'open' });
  });

  it('reconnects with backoff doubling from 1s to 15s, and an open resets it', async () => {
    const t = setup();
    await flush();
    for (let i = 0; i < 6; i++) {
      t.last.sink.error({});
      const delay = t.delays().at(-1)!;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(t.connections).toHaveLength(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.connections).toHaveLength(i + 2);
    }
    expect(t.delays()).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
    expect(t.states.filter((s) => s.kind === 'reconnecting').map((s) => s.kind === 'reconnecting' && s.attempt)).toEqual([1, 2, 3, 4, 5, 6]);

    t.last.sink.open();
    t.last.sink.error({});
    expect(t.delays().at(-1)).toBe(1000);
  });

  it('resumes from the last id it saw and delivers every message, a replayed row included', async () => {
    const t = setup({ lastEventId: '4' });
    await flush();
    t.last.sink.open();
    t.last.send({ id: 5 }, '5');
    t.last.send({ kind: 'context' }, '5');
    t.last.send({ id: 6 }, '6');
    expect(t.client.lastEventId).toBe('6');

    t.last.sink.error({});
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.cursors).toEqual(['4', '6']);
    expect(t.last.request.url).toBe('/api/threads/t1/stream?after=6');

    t.last.sink.open();
    t.last.send({ id: 6 }, '6');
    t.last.send({ kind: 'sync' }, '6');
    t.last.send({ id: 7 }, '7');
    expect(t.messages).toEqual([{ id: 5 }, { kind: 'context' }, { id: 6 }, { id: 6 }, { kind: 'sync' }, { id: 7 }]);
    expect(t.client.lastEventId).toBe('7');
  });

  it('drops a connection that goes 50s without an event and reconnects; pings keep it alive', async () => {
    const t = setup();
    await flush();
    t.last.sink.open();
    await vi.advanceTimersByTimeAsync(40_000);
    t.last.ping();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(t.last.closed).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.connections[0].closed).toBe(true);
    expect(t.kinds().at(-1)).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.connections).toHaveLength(2);
  });

  it('gives up on a connection that never opens after 50s', async () => {
    const t = setup();
    await flush();
    await vi.advanceTimersByTimeAsync(50_000);
    expect(t.connections[0].closed).toBe(true);
    expect(t.kinds()).toEqual(['connecting', 'reconnecting']);
  });

  it('refreshes credentials once on a 401 and reconnects at once with the new ones', async () => {
    let token = 'old';
    const refreshAuth = vi.fn(async () => {
      token = 'new';
      return true;
    });
    const t = setup({ refreshAuth, request: () => ({ url: '/api/feed', headers: { Authorization: `Bearer ${token}` } }) });
    await flush();
    t.last.sink.error({ status: 401 });
    await flush();
    expect(refreshAuth).toHaveBeenCalledOnce();
    expect(t.connections).toHaveLength(2);
    expect(t.last.request.headers.Authorization).toBe('Bearer new');
    expect(t.kinds()).not.toContain('reconnecting');
  });

  it('stops at unauthorized when a refresh does not help, until resume', async () => {
    const refreshAuth = vi.fn(async () => true);
    const t = setup({ refreshAuth });
    await flush();
    t.last.sink.error({ status: 401 });
    await flush();
    t.last.sink.error({ status: 401 });
    await flush();
    expect(refreshAuth).toHaveBeenCalledOnce();
    expect(t.client.state).toEqual({ kind: 'unauthorized' });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.connections).toHaveLength(2);

    t.client.resume();
    await flush();
    expect(t.connections).toHaveLength(3);
    t.last.sink.error({ status: 401 });
    await flush();
    expect(refreshAuth).toHaveBeenCalledTimes(2);
  });

  it('resume reconnects while a refresh never settles, and the late answer is ignored', async () => {
    let answer: (changed: boolean) => void = () => {};
    const refreshAuth = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const t = setup({ refreshAuth });
    await flush();
    t.last.sink.error({ status: 401 });
    await flush();
    expect(t.client.state).toEqual({ kind: 'connecting' });

    t.client.resume();
    await flush();
    expect(t.connections).toHaveLength(2);

    answer(true);
    await flush();
    expect(t.connections).toHaveLength(2);
  });

  it('stops at unauthorized when the refresh fails or there is none', async () => {
    const rejected = setup({ refreshAuth: async () => Promise.reject(new Error('keychain locked')) });
    await flush();
    rejected.last.sink.error({ status: 401 });
    await flush();
    expect(rejected.client.state).toEqual({ kind: 'unauthorized' });

    const none = setup();
    await flush();
    none.last.sink.error({ status: 401 });
    await flush();
    expect(none.client.state).toEqual({ kind: 'unauthorized' });
  });

  it('pause drops the connection and stays down; resume connects at once with a fresh backoff', async () => {
    const t = setup();
    await flush();
    t.last.sink.error({});
    await vi.advanceTimersByTimeAsync(1000);
    t.last.sink.error({});
    expect(t.delays().at(-1)).toBe(2000);
    await vi.advanceTimersByTimeAsync(2000);

    t.client.pause();
    expect(t.last.closed).toBe(true);
    expect(t.client.state).toEqual({ kind: 'paused' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.connections).toHaveLength(3);

    t.client.resume();
    await flush();
    expect(t.connections).toHaveLength(4);
    t.last.sink.error({});
    expect(t.delays().at(-1)).toBe(1000);
  });

  it('resume skips a reconnect wait and leaves a live connection alone', async () => {
    const t = setup();
    await flush();
    t.last.sink.error({});
    t.client.resume();
    await flush();
    expect(t.connections).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.connections).toHaveLength(2);

    t.last.sink.open();
    t.client.resume();
    await flush();
    expect(t.connections).toHaveLength(2);
    expect(t.last.closed).toBe(false);
  });

  it('pause while the request is still being built opens nothing', async () => {
    let release!: (r: SSERequest) => void;
    const t = setup({ request: () => new Promise<SSERequest>((r) => (release = r)) });
    t.client.pause();
    release({ url: '/api/feed', headers: {} });
    await flush();
    expect(t.connections).toHaveLength(0);
  });

  it('backs off when building the request throws', async () => {
    const t = setup({ request: () => Promise.reject(new Error('no token yet')) });
    await flush();
    expect(t.connections).toHaveLength(0);
    expect(t.kinds()).toEqual(['connecting', 'reconnecting']);
  });

  it('ignores a connection that fails before the transport returns it', async () => {
    const opened: { closed: boolean }[] = [];
    setup({
      transport: (_req, sink) => {
        const c = { closed: false, close: () => (c.closed = true) };
        opened.push(c);
        if (opened.length === 1) sink.error({});
        return c;
      },
    });
    await flush();
    expect(opened[0].closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(opened).toHaveLength(2);
    expect(opened[1].closed).toBe(false);
  });

  it('close ends everything, and late events from old connections are ignored', async () => {
    const t = setup();
    await flush();
    const first = t.last;
    first.sink.open();
    first.sink.error({});
    await vi.advanceTimersByTimeAsync(1000);
    first.send({ late: true }, '9');
    expect(t.messages).toEqual([]);

    t.client.close();
    expect(t.last.closed).toBe(true);
    const before = t.states.length;
    t.last.send({ after: 'close' });
    t.last.sink.error({});
    t.client.resume();
    t.client.pause();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.messages).toEqual([]);
    expect(t.states.slice(before - 1)).toEqual([{ kind: 'closed' }]);
    expect(t.connections).toHaveLength(2);
  });
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, ((e: EventSourceEvent) => void)[]>();
  closed = false;
  constructor(
    public url: string,
    public init: { headers: Record<string, string>; pollingInterval: number; timeoutBeforeConnection: number },
  ) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (e: EventSourceEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, e: EventSourceEvent = {}) {
    for (const l of this.listeners.get(type) ?? []) l(e);
  }
}

describe('eventSourceTransport', () => {
  beforeEach(() => (FakeEventSource.instances = []));

  const start = (overrides: Partial<SSEOptions<unknown>> = {}) => {
    const messages: unknown[] = [];
    const client = openSSE({
      transport: eventSourceTransport(FakeEventSource),
      request: (cursor) => ({ url: `/api/threads/t1/stream?after=${cursor ?? 0}`, headers: { Authorization: 'Bearer tok' } }),
      decode: decodeJSON,
      onMessage: (m) => messages.push(m),
      ...overrides,
    });
    return { client, messages, source: () => FakeEventSource.instances[FakeEventSource.instances.length - 1] };
  };

  it('opens the source with the headers and its own reconnect turned off', async () => {
    const t = start();
    await flush();
    expect(t.source().url).toBe('/api/threads/t1/stream?after=0');
    expect(t.source().init).toEqual({ headers: { Authorization: 'Bearer tok' }, pollingInterval: 0, timeoutBeforeConnection: 0 });
  });

  it('still lets react-native-sse make its first connection', async () => {
    const instances: ScheduledEventSource[] = [];
    // Mirrors react-native-sse 1.2.1: the constructor asks _pollAgain(timeoutBeforeConnection, true) to schedule open().
    class ScheduledEventSource extends FakeEventSource {
      CLOSED = 2;
      status = 0;
      opens = 0;
      constructor(url: string, init: FakeEventSource['init']) {
        super(url, init);
        instances.push(this);
        this._pollAgain(init.timeoutBeforeConnection, true);
      }
      _pollAgain(time: number, allowZero?: boolean) {
        if (time > 0 || allowZero) setTimeout(() => (this.opens += 1), time);
      }
      dispatch(type: string, data: EventSourceEvent) {
        this.emit(type, data);
      }
    }
    openSSE({
      transport: eventSourceTransport(ScheduledEventSource),
      request: () => ({ url: '/s', headers: {} }),
      decode: decodeJSON,
      onMessage: () => {},
    });
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(instances[0].opens).toBe(1);
  });

  it('reconnects when react-native-sse ends a stream quietly, without waiting for the watchdog', async () => {
    const instances: PollingEventSource[] = [];
    // Mirrors react-native-sse 1.2.1: a finished request calls _pollAgain(interval, false), which does nothing at 0.
    class PollingEventSource extends FakeEventSource {
      CLOSED = 2;
      status = 1;
      _pollAgain(_time: number, _allowZero?: boolean) {}
      dispatch(type: string, data: EventSourceEvent) {
        this.emit(type, data);
      }
      finish() {
        this._pollAgain(0, false);
      }
      override close() {
        super.close();
        this.status = this.CLOSED;
      }
      constructor(url: string, init: FakeEventSource['init']) {
        super(url, init);
        instances.push(this);
      }
    }
    const states: SSEState[] = [];
    openSSE({
      transport: eventSourceTransport(PollingEventSource),
      request: () => ({ url: '/s', headers: {} }),
      decode: decodeJSON,
      onMessage: () => {},
      onState: (s) => states.push(s),
    });
    await flush();
    instances[0].emit('open');
    instances[0].finish();
    expect(instances[0].closed).toBe(true);
    expect(states.at(-1)).toEqual({ kind: 'reconnecting', attempt: 1, delayMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(instances).toHaveLength(2);

    instances[1].emit('error', { xhrStatus: 500 });
    instances[1].finish();
    expect(states.at(-1)).toEqual({ kind: 'reconnecting', attempt: 2, delayMs: 2000 });
  });

  it('delivers events whose lastEventId carried over, and resumes from the last one', async () => {
    const t = start();
    await flush();
    const s = t.source();
    s.emit('open');
    s.emit('message', { data: '{"kind":"sync"}', lastEventId: '' });
    s.emit('message', { data: '{"id":5}', lastEventId: '5' });
    s.emit('message', { data: '{"kind":"context"}', lastEventId: '5' });
    s.emit('message', { data: '{"id":6}', lastEventId: '6' });
    s.emit('message', { data: '{"kind":"thread"}', lastEventId: '6' });
    expect(t.messages).toEqual([{ kind: 'sync' }, { id: 5 }, { kind: 'context' }, { id: 6 }, { kind: 'thread' }]);
    expect(t.client.lastEventId).toBe('6');

    s.emit('error', {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.source().url).toBe('/api/threads/t1/stream?after=6');
  });

  it('keeps the connection alive on named pings', async () => {
    const t = start();
    await flush();
    t.source().emit('open');
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(20_000);
      t.source().emit('ping', { data: '' });
    }
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(t.source().closed).toBe(false);
    expect(t.messages).toEqual([]);
  });

  it('closes the source on error and reports a 401 so the client refreshes', async () => {
    const refreshAuth = vi.fn(async () => true);
    const t = start({ refreshAuth });
    await flush();
    const first = t.source();
    first.emit('error', { xhrStatus: 401 });
    await flush();
    expect(first.closed).toBe(true);
    expect(refreshAuth).toHaveBeenCalledOnce();
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('treats an error without a status as a failure to back off from', async () => {
    const refreshAuth = vi.fn(async () => true);
    const t = start({ refreshAuth });
    await flush();
    t.source().emit('error', { xhrStatus: 0 });
    await flush();
    expect(refreshAuth).not.toHaveBeenCalled();
    expect(t.client.state).toEqual({ kind: 'reconnecting', attempt: 1, delayMs: 1000 });
  });
});
