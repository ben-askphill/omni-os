import type { NeedsYou, NeedsYouItem } from '@omni/client-core';

const counted = (items: NeedsYouItem[]): NeedsYou => ({
  items,
  unread: items.filter((i) => i.result).length,
  blocked: items.filter((i) => i.blockers.length).length,
});

/** The result an open thread shows, to mark read: the inbox's unread one for it, once the thread is not running. */
export function shownResult(all: NeedsYou | null, threadId: string, status: string | undefined): string | null {
  if (!status || status === 'running' || status === 'queued') return null;
  return all?.items.find((i) => i.thread.id === threadId)?.result?.uid ?? null;
}

/** The inbox once a result is read, before the server answers: the result goes, its blockers stay. */
export function withoutResult(all: NeedsYou, uid: string): NeedsYou {
  return counted(all.items.flatMap((i) => (i.result?.uid !== uid ? [i] : i.blockers.length ? [{ ...i, result: null }] : [])));
}
