import { type HistoryRow } from '@omni/shared/history.ts';
import { ThreadHistory, type ThreadDetail } from './history.ts';
import { decodeJSON, openSSE, type SSEClient, type SSEState, type SSETransport } from './sse.ts';

export interface ThreadLiveOptions<R extends HistoryRow, D extends ThreadDetail<R>> {
  load(): Promise<D>;
  streamUrl(after: number): string;
  token(): string | null | Promise<string | null>;
  transport: SSETransport;
  refreshAuth?: () => Promise<boolean>;
  onDetail(detail: D): void;
  onHistory(history: ThreadHistory<R>): void;
  onOther?(message: unknown): void;
  onState?(state: SSEState): void;
  /**
   * True while the user is at the newest rows. Past the retention limit, live rows then trim the oldest loaded ones.
   * Return false while the user reads older pages, so a new row does not trim what is on screen. Defaults to true.
   */
  follows?(): boolean;
}

/** Opens the bounded head before subscribing, then lets the server replay or send a fresh head. */
export async function openThreadLive<R extends HistoryRow, D extends ThreadDetail<R>>(options: ThreadLiveOptions<R, D>): Promise<{ history: ThreadHistory<R>; stream: SSEClient }> {
  const detail = await options.load();
  const history = new ThreadHistory<R>();
  history.open(detail);
  options.onDetail(detail);
  options.onHistory(history);
  const stream = openSSE({
    transport: options.transport,
    request: async () => {
      const token = await options.token();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      return { url: options.streamUrl(history.after), headers };
    },
    refreshAuth: options.refreshAuth,
    onState: options.onState,
    decode: decodeJSON,
    onMessage: (value) => {
      if (!value || typeof value !== 'object') return;
      const item = value as Record<string, unknown>;
      if (item.kind === 'sync' && item.thread) {
        const next = { ...item, events: Array.isArray(item.events) ? item.events : [] } as unknown as D;
        if (item.catch_up === 'snapshot' && item.history) {
          history.snapshot(next);
          options.onHistory(history);
        }
        options.onDetail(next);
      } else if (typeof item.id === 'number' && typeof item.kind === 'string' && typeof item.payload === 'string') {
        history.append([item as unknown as R], options.follows?.() ?? true);
        options.onHistory(history);
      } else options.onOther?.(value);
    },
  });
  return { history, stream };
}

/** The global feed has no replay. Refetch the caller's views whenever an open follows an earlier open. */
export function openFeed(options: {
  url: string;
  token(): string | null | Promise<string | null>;
  transport: SSETransport;
  refreshAuth?: () => Promise<boolean>;
  onMessage(message: unknown): void;
  onReconnect(): void;
  onState?(state: SSEState): void;
}): SSEClient {
  let opened = false;
  return openSSE({
    transport: options.transport,
    request: async () => {
      const token = await options.token();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      return { url: options.url, headers };
    },
    refreshAuth: options.refreshAuth,
    decode: decodeJSON,
    onMessage: options.onMessage,
    onState: state => {
      if (state.kind === 'open') {
        if (opened) options.onReconnect();
        opened = true;
      }
      options.onState?.(state);
    },
  });
}
