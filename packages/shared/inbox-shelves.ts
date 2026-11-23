// The Inbox's shelves, which the desktop sidebar's Inbox view, phone web's Activity tab and the iOS Activity screen all
// show: every thread in one list across channels, split by what it waits on, and how far each shelf is open. Each
// client fetches the candidates and draws the rows; which shelf a thread sits on is decided here once.
import { isWorking, type WorkState } from './delegate-count.ts';

/** The parts of a thread its shelf reads. */
export interface ShelfThread extends WorkState {
  id: string;
  created_at: string;
  updated_at?: string | null;
  done_at?: string | null;
  pinned_at?: string | null;
  source?: string | null;
  archived?: number | boolean | null;
}

/** The parts of a Needs you item a shelf reads: when the thread came back, and what holds it up. */
export interface ShelfNeed {
  thread: { id: string };
  at?: string | null;
  blockers: readonly unknown[];
}

/**
 * Pinned on top, then the inbox (threads waiting on Ben, the latest to come back first), then Working (running or
 * queued) and Done (marked done, T3's "settled"). Each thread sits on one shelf.
 */
export interface InboxLayout<T> {
  pinned: T[];
  inbox: T[];
  working: T[];
  done: T[];
}

/** Done shows this many rows, then pages by DONE_PAGE, as T3 pages its Settled shelf. */
export const DONE_INITIAL = 10;
export const DONE_PAGE = 25;

/** A shelf as a list shows it under its header. */
export interface ShelfView<T> {
  /** Every thread on the shelf, listed or not: the header's count. */
  count: number;
  /** Open: its first `limit` threads. Folded: none. Either way the open thread, so the highlight never vanishes into it. */
  rows: T[];
  /** How many threads Show more adds under the open shelf, at most DONE_PAGE. 0 once every thread is listed. */
  more: number;
}

/** Working lists every thread it holds; Done pages, `limit` growing from DONE_INITIAL by DONE_PAGE. */
export function shelfView<T extends { id: string }>(list: readonly T[], { open, openId = null, limit = Infinity }: { open: boolean; openId?: string | null; limit?: number }): ShelfView<T> {
  const isOpenThread = (t: T) => t.id === openId;
  return {
    count: list.length,
    rows: open ? [...list.slice(0, limit), ...list.slice(limit).filter(isOpenThread)] : list.filter(isOpenThread),
    more: open ? Math.min(DONE_PAGE, Math.max(0, list.length - limit)) : 0,
  };
}

/**
 * Every thread the Inbox could hold, in the order a later copy wins: the recent list, the pinned threads, what runs
 * in each channel and what Needs you holds. A thread may repeat.
 */
export function inboxCandidates<T>({
  recent,
  pinned,
  channels,
  needs,
}: {
  recent: readonly T[] | null | undefined;
  pinned: readonly T[];
  channels: readonly { active?: readonly T[] | null }[] | null | undefined;
  needs: readonly { thread: T }[];
}): T[] {
  return [...(recent ?? []), ...pinned, ...(channels ?? []).flatMap((c) => c.active ?? []), ...needs.map((n) => n.thread)];
}

const at = (t: ShelfThread) => t.updated_at ?? t.created_at;
/** Newest first; a tie goes to the lower id, so the order never flickers between reloads. */
const newest = <T extends ShelfThread>(key: (t: T) => string) => (a: T, b: T) => key(b).localeCompare(key(a)) || a.id.localeCompare(b.id);

export function inboxLayout<T extends ShelfThread>({
  threads,
  needs,
  delegated,
  open = null,
}: {
  /** Every candidate row (inboxCandidates). A thread may repeat: the later copy's fields go over the earlier. */
  threads: readonly T[];
  needs: readonly ShelfNeed[];
  /** Threads the Conductor delegated: their count on the job's row stands for them, as in the Projects view. */
  delegated: ReadonlySet<string>;
  /** The open thread's fresher copy, which wins over the listed one. */
  open?: Partial<T> & { id: string } | null;
}): InboxLayout<T> {
  const byId = new Map<string, T>();
  for (const t of threads) byId.set(t.id, { ...byId.get(t.id), ...t });
  if (open && byId.has(open.id)) byId.set(open.id, { ...byId.get(open.id)!, ...open });

  const needAt = new Map(needs.map((n) => [n.thread.id, n]));
  // A thread comes back when its turn ends or something holds it up. Needs you knows when; otherwise its last change.
  const returned = (t: T) => needAt.get(t.id)?.at ?? at(t);
  const blocked = (t: T) => (needAt.get(t.id)?.blockers.length ?? 0) > 0;

  const layout: InboxLayout<T> = { pinned: [], inbox: [], working: [], done: [] };
  for (const t of byId.values()) {
    if (t.archived || t.source === 'team' || delegated.has(t.id)) continue;
    if (t.done_at) layout.done.push(t);
    else if (t.pinned_at) layout.pinned.push(t);
    // A question holds a running thread up, so it waits in the inbox, as T3 keeps approvals out of Working.
    else if (isWorking(t) && !blocked(t)) layout.working.push(t);
    else layout.inbox.push(t);
  }
  layout.pinned.sort(newest((t) => t.pinned_at ?? ''));
  layout.inbox.sort(newest(returned));
  layout.working.sort(newest(at));
  layout.done.sort(newest((t) => t.done_at ?? ''));
  return layout;
}
