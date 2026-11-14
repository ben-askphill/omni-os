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
  | { type: 'automation_delivery'; automation: string }
  /** The update check or Update moved on (update.ts). Clients refetch GET /api/update. */
  | { type: 'update' }
  /** A claude.ai Artifacts refresh started or ended, or its schedule changed (claude-artifacts.ts). Clients refetch the list when it ends. */
  | { type: 'claude_artifacts'; state: unknown }
  /** Free disk space crossed a warning level (disk-space.ts). Clients refetch GET /api/disk. */
  | { type: 'disk'; level: string }
  /** A harness account changed on this machine, or another machine's record or an acknowledged switch synced in (harness-accounts.ts). Clients refetch GET /api/accounts. */
  | { type: 'accounts' }
  /** A thread's review notes changed, here or on another Mac (db/repos/review-notes.ts). Its open Changes panels refetch them. */
  | { type: 'review_notes'; thread_id: string }
  /** A machine's CPU and memory sample: this one's while a client watches, another's as sync brings it (machine-stats.ts). Id null is this machine with sync off. */
  | { type: 'machine_stats'; id: string | null; stats: unknown };

export const publishFeed = (e: FeedEvent) => bus.emit('feed', e);
export const publishThread = (threadId: string, e: unknown) => bus.emit(`thread:${threadId}`, e);
