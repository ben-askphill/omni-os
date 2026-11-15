import type { NeedsYou, NeedsYouItem } from '@omni/client-core';
import { unreadResultOf, withoutRead } from '@omni/shared/needs-read.ts';

const counted = (items: NeedsYouItem[]): NeedsYou => ({
  items,
  unread: items.filter((i) => i.result).length,
  blocked: items.filter((i) => i.blockers.length).length,
});

/**
 * The result an open thread shows, to mark read: the inbox's unread one for it, once the thread is not running. A
 * failed thread under a job has its result on the job's blocker instead.
 */
export function shownResult(all: NeedsYou | null, threadId: string, status: string | undefined): string | null {
  if (!all || !status || status === 'running' || status === 'queued') return null;
  return unreadResultOf(all.items, threadId);
}

/** The inbox once a result is read, before the server answers: the result goes, its blockers stay, a failed child leaves its job's. */
export function withoutResult(all: NeedsYou, uid: string): NeedsYou {
  return counted(withoutRead(all.items, uid));
}
