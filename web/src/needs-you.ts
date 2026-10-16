// Needs you (server/db/repos/needs-you.ts) from the Web UI's side: why each thread is there, and which result an
// open thread has shown. NeedsYou.swift is the Mac app's copy.
import type { NeedsYou, NeedsYouItem } from './api.ts';
import type { Glyph } from './components/ui.tsx';
import { resetLabel } from './limits.ts';

export interface Reason {
  glyph: Glyph;
  label: string;
  /** The line under it: why Setup failed, or the result's last words. */
  detail: string | null;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('#', String(n)));

/** What to say about an item. A blocker comes first: it waits on Ben whether he read the result or not. */
export function reasonOf(item: NeedsYouItem): Reason {
  const preview = item.thread.last_text ? item.thread.last_text.replace(/\s+/g, ' ').trim().slice(0, 240) : null;
  const b = item.blockers[0];
  if (b?.kind === 'setup') return { glyph: 'needs', label: 'Worktree could not be prepared', detail: b.detail };
  if (b?.kind === 'limited') {
    const at = b.resets_at ? resetLabel(b.resets_at) : null;
    return { glyph: 'needs', label: 'Usage limit reached', detail: at ? `${b.scheduled ? 'Resumes' : 'Resets'} at ${at}` : 'No reset time given' };
  }
  if (b?.kind === 'uncertain') return { glyph: 'needs', label: plural(b.count, 'A message may not have been sent', '# messages may not have been sent'), detail: preview };
  if (b?.kind === 'recovered') return { glyph: 'needs', label: plural(b.count, 'A message waits for Resume', '# messages wait for Resume'), detail: preview };
  switch (item.result?.status) {
    case 'failed':
      return { glyph: 'needs', label: 'Failed', detail: preview };
    case 'stopped':
      return { glyph: 'settled', label: 'Stopped', detail: preview };
    default:
      return { glyph: 'done', label: 'Finished', detail: preview };
  }
}

/** One channel's part of the inbox, with its own counts. */
export function inChannel(all: NeedsYou | null, channelId: string): NeedsYou | null {
  if (!all) return null;
  const items = all.items.filter((i) => i.thread.channel_id === channelId);
  return { items, unread: items.filter((i) => i.result).length, blocked: items.filter((i) => i.blockers.length).length };
}

/**
 * The result an open thread shows, to mark read: the inbox's unread one for it, once the thread is not running.
 * A running thread is still writing, so what Ben sees is not that result yet; the turn brings a newer one.
 */
export function shownResult(all: NeedsYou | null, threadId: string, status: string | undefined): string | null {
  if (!status || status === 'running' || status === 'queued') return null;
  return all?.items.find((i) => i.thread.id === threadId)?.result?.uid ?? null;
}

/** The inbox once a result is read, before the server answers: the result goes, its blockers stay. */
export function withoutResult(all: NeedsYou, uid: string): NeedsYou {
  const items = all.items.flatMap((i) => (i.result?.uid !== uid ? [i] : i.blockers.length ? [{ ...i, result: null }] : []));
  return { items, unread: items.filter((i) => i.result).length, blocked: items.filter((i) => i.blockers.length).length };
}

/**
 * A load that runs one at a time: a call while one is out runs it once more after, however many calls came. A sync
 * that applies many results and reads at once sends a `needs_you` event for each; the inbox loads twice, not once
 * per event, and the last load starts after the last event.
 */
export function coalesced(load: () => Promise<unknown>): () => void {
  let busy = false;
  let again = false;
  const run = () => {
    busy = true;
    again = false;
    load()
      .catch(() => {})
      .finally(() => (again ? run() : (busy = false)));
  };
  return () => {
    if (busy) again = true;
    else run();
  };
}
