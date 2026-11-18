import { EventEmitter } from 'node:events';
import type { FeedAlert } from '@omni/shared/attention.ts';

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
  /** The automations were loaded again: a file changed here, through the editor, or from another machine (sync). Clients refetch them. */
  | { type: 'automations' }
  /** A crew role was saved, reset, deleted, hidden or shown, here or on another machine (crew-store.ts, sync). Clients refetch GET /api/crew. */
  | { type: 'crew' }
  /** Show technical details or the Shopify add-on changed, here or on another machine (display.ts). Clients refetch GET /api/display. */
  | { type: 'display' }
  /** The update check or Update moved on (update.ts). Clients refetch GET /api/update. */
  | { type: 'update' }
  /** A claude.ai Artifacts refresh started or ended, or its schedule changed (claude-artifacts.ts). Clients refetch the list when it ends. */
  | { type: 'claude_artifacts'; state: unknown }
  /** Free disk space crossed a warning level (disk-space.ts). Clients refetch GET /api/disk. */
  | { type: 'disk'; level: string }
  /** A harness account changed on this machine, or another machine's record or an acknowledged switch synced in (harness-accounts.ts). Clients refetch GET /api/accounts. */
  | { type: 'accounts' }
  /** One account's plan usage was read here, or synced in from another machine (harness-accounts.ts). The Usage card updates that account's row. */
  | { type: 'account_usage'; usage: unknown }
  /** A thread's review notes changed, here or on another Mac (db/repos/review-notes.ts). Its open Changes panels refetch them. */
  | { type: 'review_notes'; thread_id: string }
  /** A machine's CPU and memory sample: this one's while a client watches, another's as sync brings it (machine-stats.ts). Id null is this machine with sync off. */
  | { type: 'machine_stats'; id: string | null; stats: unknown }
  /**
   * Something worth a notification that Needs you does not list: a crew report in the Conductor, a watched PR that
   * needs attention (push-sender.ts). Clients that notify post it; nothing else changes.
   */
  | { type: 'alert'; alert: FeedAlert };

export const publishFeed = (e: FeedEvent) => bus.emit('feed', e);
export const publishThread = (threadId: string, e: unknown) => bus.emit(`thread:${threadId}`, e);

/** A sub-agent's task row came in from another machine (sync/handlers/event.ts), so `delegating` may have changed. */
export const SYNCED_TASK = 'synced_task';

/** A batch of changes from another machine finished applying (sync/apply.ts). The payload is the changes that applied. */
export const SYNC_BATCH = 'sync_batch';
