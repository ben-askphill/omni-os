import { EventEmitter } from 'node:events';

// In-process pub/sub. SSE endpoints subscribe; runner, watcher and scheduler publish.
export const bus = new EventEmitter();
bus.setMaxListeners(0);

export type FeedEvent =
  | { type: 'thread'; thread: unknown }
  | { type: 'usage'; harness?: string; usage: unknown }
  | { type: 'artifact'; artifact: unknown }
  | { type: 'tasks'; tasks: unknown[] }
  /** Every mod status line pinned now, across all threads, whenever one is set or cleared. */
  | { type: 'mods'; mods: unknown[] }
  /** A channel changed on another Mac (sync). Clients refetch the channel list. */
  | { type: 'channel'; id: string };

export const publishFeed = (e: FeedEvent) => bus.emit('feed', e);
export const publishThread = (threadId: string, e: unknown) => bus.emit(`thread:${threadId}`, e);
