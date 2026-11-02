// It delivers every message, replays included: an EventSource cannot tell a repeated id from one kept over from an
// earlier event, so the history layer dedupes rows by row id. The connection comes from an injected transport.

/** One event as the stream sent it. `event` is `message` when it had no `event:` field; the server names only `ping`. */
export interface SSEMessage {
  event: string;
  data: string;
  /** The stream's last event id when this event arrived, kept across events that set none. Undefined before any. */
  id?: string;
}

export interface SSERequest {
  url: string;
  headers: Record<string, string>;
}

/** What a connection reports. Calls after `error`, or after the connection was closed, are ignored. */
export interface SSESink {
  open(): void;
  message(m: SSEMessage): void;
  /** The connection failed or ended. `status` is the HTTP status when the transport knows it. */
  error(e: { status?: number }): void;
}

export interface SSEConnection {
  close(): void;
}

/** Opens one connection. It must not reconnect by itself: the client decides when to try again. */
export type SSETransport = (request: SSERequest, sink: SSESink) => SSEConnection;

export type SSEState =
  | { kind: 'connecting' }
  | { kind: 'open' }
  /** The last `attempt` connections in a row failed, and the next one starts after `delayMs`. */
  | { kind: 'reconnecting'; attempt: number; delayMs: number }
  | { kind: 'paused' }
  /** The server refused the credentials and a refresh did not help. Waits for `resume()`. */
  | { kind: 'unauthorized' }
  | { kind: 'closed' };

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SSEOptions<T> {
  transport: SSETransport;
  /** Builds each connection's request from the last id seen, null when none. Read the current token here. */
  request: (lastEventId: string | null) => SSERequest | Promise<SSERequest>;
  /** Turns an event into what `onMessage` gets. Undefined drops it. */
  decode: (m: SSEMessage) => T | undefined;
  onMessage: (message: T) => void;
  onState?: (state: SSEState) => void;
  /** Called once on a 401. Resolve true when the credentials changed, and the client reconnects at once. */
  refreshAuth?: () => Promise<boolean>;
  /** Where to resume from, passed to `request` until the stream sends an id. */
  lastEventId?: string | null;
  timers?: Timers;
}

export interface SSEClient {
  readonly state: SSEState;
  /** The last new id the stream sent, the cursor for the next connection. */
  readonly lastEventId: string | null;
  /** Drops the connection and stops retrying, as when the app goes to the background. */
  pause(): void;
  /**
   * Connects now with a fresh backoff from paused, unauthorized or a reconnect wait, as when the app comes to the
   * front or the network changes. Leaves an open or connecting stream alone.
   */
  resume(): void;
  close(): void;
}

export const BACKOFF_MIN_MS = 1_000;
export const BACKOFF_MAX_MS = 15_000;
export const WATCHDOG_MS = 50_000;

/** The JSON body of an unnamed event. Pings, empty data and data that does not parse are dropped. */
export function decodeJSON(m: SSEMessage): unknown {
  if (m.event !== 'message' || !m.data) return undefined;
  try {
    return JSON.parse(m.data);
  } catch {
    return undefined;
  }
}

type Phase = 'connecting' | 'open' | 'waiting' | 'refreshing' | 'paused' | 'unauthorized' | 'closed';

export function openSSE<T>(options: SSEOptions<T>): SSEClient {
  const timers = options.timers ?? (globalThis as unknown as Timers);
  let phase: Phase = 'connecting';
  let state: SSEState = { kind: 'connecting' };
  let cursor = options.lastEventId ?? null;
  let generation = 0;
  let connection: SSEConnection | null = null;
  let retryTimer: unknown;
  let watchdog: unknown;
  let failures = 0;
  let refreshed = false;

  const publish = (next: SSEState) => {
    state = next;
    options.onState?.(next);
  };

  const drop = () => {
    generation++;
    const c = connection;
    connection = null;
    timers.clearTimeout(watchdog);
    timers.clearTimeout(retryTimer);
    c?.close();
  };

  const retry = () => {
    failures++;
    const delayMs = Math.min(BACKOFF_MIN_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
    phase = 'waiting';
    publish({ kind: 'reconnecting', attempt: failures, delayMs });
    retryTimer = timers.setTimeout(connect, delayMs);
  };

  const beat = (gen: number) => {
    timers.clearTimeout(watchdog);
    watchdog = timers.setTimeout(() => {
      if (gen !== generation) return;
      drop();
      retry();
    }, WATCHDOG_MS);
  };

  const unauthorized = async () => {
    if (options.refreshAuth && !refreshed) {
      refreshed = true;
      const gen = generation;
      // A refresh that never settles must not trap the client: resume() reconnects from this phase.
      phase = 'refreshing';
      publish({ kind: 'connecting' });
      const changed = await options.refreshAuth().catch(() => false);
      if (gen !== generation) return;
      if (changed) return connect();
    }
    phase = 'unauthorized';
    publish({ kind: 'unauthorized' });
  };

  const deliver = (m: SSEMessage) => {
    if (m.id) cursor = m.id;
    const message = options.decode(m);
    if (message !== undefined) options.onMessage(message);
  };

  async function connect() {
    drop();
    const gen = generation;
    phase = 'connecting';
    publish({ kind: 'connecting' });
    let request: SSERequest;
    try {
      request = await options.request(cursor);
    } catch {
      if (gen === generation) retry();
      return;
    }
    if (gen !== generation) return;
    const live = () => gen === generation;
    const sink: SSESink = {
      open() {
        if (!live() || phase !== 'connecting') return;
        phase = 'open';
        failures = 0;
        refreshed = false;
        beat(gen);
        publish({ kind: 'open' });
      },
      message(m) {
        if (!live()) return;
        beat(gen);
        deliver(m);
      },
      error(e) {
        if (!live()) return;
        drop();
        if (e.status === 401) void unauthorized();
        else retry();
      },
    };
    beat(gen);
    let opened: SSEConnection;
    try {
      opened = options.transport(request, sink);
    } catch {
      if (live()) retry();
      return;
    }
    if (live()) connection = opened;
    else opened.close();
  }

  void connect();

  return {
    get state() {
      return state;
    },
    get lastEventId() {
      return cursor;
    },
    pause() {
      if (phase === 'paused' || phase === 'closed') return;
      drop();
      phase = 'paused';
      publish({ kind: 'paused' });
    },
    resume() {
      if (phase !== 'paused' && phase !== 'unauthorized' && phase !== 'waiting' && phase !== 'refreshing') return;
      failures = 0;
      refreshed = false;
      void connect();
    },
    close() {
      if (phase === 'closed') return;
      drop();
      phase = 'closed';
      publish({ kind: 'closed' });
    },
  };
}

/** The parts of an EventSource the client uses: the browser's, `react-native-sse`'s, or another with that shape. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: EventSourceEvent) => void): void;
  close(): void;
}

export interface EventSourceEvent {
  data?: string | null;
  lastEventId?: string | null;
  /** Where the HTTP status of a failed connection lives: `react-native-sse`, a fetch-based EventSource. */
  xhrStatus?: number;
  status?: number;
  code?: number;
}

export type EventSourceConstructor = new (
  url: string,
  init: { headers: Record<string, string>; pollingInterval: number; timeoutBeforeConnection: number },
) => { close(): void };

interface PollingSource {
  status?: number;
  CLOSED?: number;
  _pollAgain?(time: number, allowZero?: boolean): void;
  dispatch?(type: string, data: unknown): void;
}

/**
 * `react-native-sse` 1.2.1 ends quietly when the server closes a stream and `pollingInterval` is 0: it neither
 * reconnects nor emits an error, so the client would wait for its 50s watchdog. Its `_pollAgain(time, false)` runs
 * exactly when a request finishes, so a subclass reports that as an error. The constructor calls the same method with
 * `allowZero` to schedule the first connection, and that call goes through. Another implementation has no such hook
 * and is used as given.
 */
function endsLoudly(Impl: EventSourceConstructor): EventSourceConstructor {
  const proto = Impl.prototype as PollingSource;
  if (typeof proto._pollAgain !== 'function' || typeof proto.dispatch !== 'function') return Impl;
  return class extends (Impl as new (...args: never[]) => object) {
    _pollAgain(time: number, allowZero?: boolean) {
      const self = this as unknown as PollingSource;
      if (allowZero) proto._pollAgain?.call(self, time, allowZero);
      else if (self.status !== self.CLOSED) self.dispatch?.('error', { type: 'error', message: 'stream ended' });
    }
  } as unknown as EventSourceConstructor;
}

const NAMED_EVENTS = ['ping'];

/**
 * A transport over an EventSource implementation. It closes the source on its first error so the implementation
 * never reconnects by itself. `pollingInterval: 0` turns off react-native-sse's own reconnect.
 */
export function eventSourceTransport(EventSourceBase: EventSourceConstructor): SSETransport {
  const EventSourceImpl = endsLoudly(EventSourceBase);
  return (request, sink) => {
    const source = new EventSourceImpl(request.url, { headers: request.headers, pollingInterval: 0, timeoutBeforeConnection: 0 }) as EventSourceLike;
    const forward = (event: string) => (e: EventSourceEvent) => sink.message({ event, data: e.data ?? '', id: e.lastEventId || undefined });
    source.addEventListener('open', () => sink.open());
    source.addEventListener('message', forward('message'));
    for (const name of NAMED_EVENTS) source.addEventListener(name, forward(name));
    source.addEventListener('error', (e) => {
      source.close();
      const status = [e.xhrStatus, e.status, e.code].find((s) => typeof s === 'number' && s > 0);
      sink.error({ status });
    });
    return { close: () => source.close() };
  };
}
