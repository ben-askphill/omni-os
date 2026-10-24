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
  /** Channel settings changed here or on another Mac (sync). Clients refetch the channel list. */
  | { type: 'channel'; id: string }
  /** Ben read a thread's result (db/repos/needs-you.ts). Clients refetch Needs you; nothing else about the thread changed. */
  | { type: 'needs_you'; thread_id: string }
  /** An event automation's delivery was saved or moved on (automation-triggers.ts). Clients refetch the automations. */
  | { type: 'automation_delivery'; automation: string };

export const publishFeed = (e: FeedEvent) => bus.emit('feed', e);
export const publishThread = (threadId: string, e: unknown) => bus.emit(`thread:${threadId}`, e);
