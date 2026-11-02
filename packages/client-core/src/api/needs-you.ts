import { apiPath, type HttpClient } from '../http.ts';
import type { Thread } from './threads.ts';

/** How a turn ended: the thread's status when it did. */
export type CompletionStatus = 'done' | 'failed' | 'stopped';

/** The newest result of a thread that Ben has not seen. `uid` is what `markResultRead` takes. */
export interface NeedsYouResult {
  uid: string;
  status: CompletionStatus;
  event_uid: string | null;
  at: string;
}

/**
 * What holds a thread up until Ben acts: `question` (the agent asked and waits), `setup` (its worktree could not be
 * prepared), `recovered` (messages a restart kept for Resume), `uncertain` (a message a harness may have read before a
 * restart) or `limited` (its harness stopped the turn at the plan's usage limit). `count` is how many questions or messages.
 */
export interface NeedsYouBlocker {
  kind: 'question' | 'setup' | 'recovered' | 'uncertain' | 'limited';
  detail: string | null;
  count: number;
  /** limited: when the harness said the limit resets. Null when it did not say, so only a manual Resume works. */
  resets_at?: string | null;
  /** limited: scheduled for that time. Still a blocker: nothing runs until then. */
  scheduled?: boolean;
  /** limited: the turn stopped on the other Mac, which is the one that resumes it. */
  elsewhere?: boolean;
}

export interface NeedsYouItem {
  thread: Thread;
  /** Null when only a blocker brings the thread here. */
  result: NeedsYouResult | null;
  blockers: NeedsYouBlocker[];
  /** When it came to need Ben, newest first in the list. */
  at: string;
}

export interface NeedsYou {
  items: NeedsYouItem[];
  /** Unread results, and threads with a blocker. */
  unread: number;
  blocked: number;
}

/** `thread_id` and the thread's item as it is now, null when nothing about it needs Ben. */
export interface ResultRead {
  thread_id: string;
  item: NeedsYouItem | null;
}

export interface NeedsYouScope {
  channel?: string;
  thread?: string;
}

export function needsYouApi(http: HttpClient) {
  return {
    /** Unread results and blockers across every thread that is not archived or done, newest first. */
    needsYou: (scope: NeedsYouScope = {}) => http.request<NeedsYou>('GET', apiPath`/needs-you`, { query: { ...scope } }),
    /** Ben saw a result. Only that result and older ones count as read. A 404 for a uid this server does not have. */
    markResultRead: (uid: string) => http.request<ResultRead>('POST', apiPath`/needs-you/read`, { body: { uid } }),
  };
}
