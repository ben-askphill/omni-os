// The sidebar's Inbox view, T3 Code's default thread list: every thread in one list across channels, split into
// shelves by what it waits on. Pure, so the rules are tested on their own (apps/web/tests/inbox.test.ts).
import type { NeedsYouBlocker, NeedsYouItem, ThreadStub } from './api.ts';
import type { Glyph } from './components/ui.tsx';

export type InboxThread = ThreadStub & { pinned_at?: string | null; source?: string; archived?: number | boolean };

/**
 * Pinned on top, then the inbox (threads waiting on Ben, the latest to come back first), then Working (running or
 * queued) and Done (marked done, T3's "settled"). Each thread sits on one shelf.
 */
export interface InboxLayout {
  pinned: InboxThread[];
  inbox: InboxThread[];
  working: InboxThread[];
  done: InboxThread[];
}

/** Done shows this many rows, then pages by DONE_PAGE, as T3 pages its Settled shelf. */
export const DONE_INITIAL = 10;
export const DONE_PAGE = 25;

/** What a card says on its right in place of the time, T3's status label. Null: nothing to say, so it shows the time. */
export interface RowStatus {
  glyph: Glyph;
  label: string;
}

const BLOCKER_LABEL: Record<NeedsYouBlocker['kind'], string> = {
  question: 'Input',
  setup: 'Setup failed',
  limited: 'Limited',
  uncertain: 'Resume',
  recovered: 'Resume',
};

/** A blocker first, as T3 puts approvals and input ahead of work; then work in progress; then an unread result. */
export function rowStatus(t: ThreadStub, need: NeedsYouItem | undefined, agents = 0): RowStatus | null {
  const b = need?.blockers[0];
  if (b) return { glyph: 'needs', label: BLOCKER_LABEL[b.kind] };
  if (t.status === 'queued') return { glyph: 'queued', label: 'Queued' };
  if (t.status === 'running' || agents > 0) return { glyph: 'running', label: 'Working' };
  switch (need?.result?.status) {
    case 'failed':
      return { glyph: 'needs', label: 'Failed' };
    case 'done':
      return { glyph: 'done', label: 'Finished' };
    case 'stopped':
      return { glyph: 'settled', label: 'Stopped' };
  }
  return null;
}

const at = (t: InboxThread) => t.updated_at ?? t.created_at;
const newest = (key: (t: InboxThread) => string) => (a: InboxThread, b: InboxThread) => key(b).localeCompare(key(a)) || a.id.localeCompare(b.id);
const isBusy = (t: InboxThread) => t.status === 'running' || t.status === 'queued';

export function inboxLayout({
  threads,
  needs,
  delegated,
  open,
}: {
  /** Every candidate row: recent threads, pinned ones, and the threads in Needs you and Running. A thread may repeat. */
  threads: InboxThread[];
  needs: NeedsYouItem[];
  /** Threads the Conductor delegated: their count on the job's row stands for them, as in the Projects view. */
  delegated: ReadonlySet<string>;
  /** The open thread's fresher copy, which wins over the listed one. */
  open: ThreadStub | null;
}): InboxLayout {
  const byId = new Map<string, InboxThread>();
  for (const t of threads) byId.set(t.id, { ...byId.get(t.id), ...t });
  if (open && byId.has(open.id)) byId.set(open.id, { ...byId.get(open.id)!, ...open });

  const needAt = new Map(needs.map((n) => [n.thread.id, n]));
  // A thread comes back when its turn ends or something holds it up. Needs you knows when; otherwise its last change.
  const returned = (t: InboxThread) => needAt.get(t.id)?.at ?? at(t);
  const blocked = (t: InboxThread) => (needAt.get(t.id)?.blockers.length ?? 0) > 0;

  const layout: InboxLayout = { pinned: [], inbox: [], working: [], done: [] };
  for (const t of byId.values()) {
    if (t.archived || t.source === 'team' || delegated.has(t.id)) continue;
    if (t.done_at) layout.done.push(t);
    else if (t.pinned_at) layout.pinned.push(t);
    // A question holds a running thread up, so it waits in the inbox, as T3 keeps approvals out of Working.
    else if (isBusy(t) && !blocked(t)) layout.working.push(t);
    else layout.inbox.push(t);
  }
  layout.pinned.sort(newest((t) => t.pinned_at ?? ''));
  layout.inbox.sort(newest(returned));
  layout.working.sort(newest(at));
  layout.done.sort(newest((t) => t.done_at ?? ''));
  return layout;
}
