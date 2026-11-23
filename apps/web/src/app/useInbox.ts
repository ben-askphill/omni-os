// The Inbox that the sidebar's Inbox view and the phone's Activity tab both show, so the two never drift: which threads,
// on which shelf, with what status, and how far each shelf is open. The rules are @omni/shared/inbox-shelves.ts.
import { useMemo, useState } from 'react';
import { delegatedIds } from '@omni/shared/delegate-count.ts';
import { asksForYou, inboxStatus, type RowStatus } from '@omni/shared/status.ts';
import { reasonOf } from '../needs-you.ts';
import { DONE_INITIAL, DONE_PAGE, inboxCandidates, inboxLayout, shelfView, type InboxThread, type ShelfView } from '../inbox.ts';
import { useLiveThreads } from '../components/ThreadList.tsx';
import { useRoute } from '../router.ts';
import { readPref, useApp, writePref } from '../store.tsx';

/** Enough recent threads to fill the inbox; Needs you, Running and Pinned add any older thread they hold. */
const RECENT_LIMIT = 200;
const acceptAll = () => true;

export interface InboxShelf extends ShelfView {
  open: boolean;
  toggle: () => void;
}

export interface Inbox {
  pinned: InboxThread[];
  /** The threads waiting on Ben, the latest back first. */
  inbox: InboxThread[];
  /** The part of `inbox` Ben has to act on: a question, a failure or a usage limit. */
  needs: InboxThread[];
  /** The rest of `inbox`: turns that ended, bold while unread. */
  finished: InboxThread[];
  /** `threads`: every thread on the Working shelf, folded or not, so Overview lists what the shelf counts. */
  working: InboxShelf & { threads: InboxThread[] };
  done: InboxShelf & { showMore: () => void };
  /** The recent list has come, so an empty inbox means nothing waits. */
  loaded: boolean;
  /** The thread on screen, if any. */
  openId: string | null;
  /** What a card says in place of the time, as Home says it (inboxStatus). */
  status: (t: InboxThread) => RowStatus | null;
}

/** A shelf's open state on this device. Every shelf starts folded, as T3's do. */
function useShelf(pref: string): [open: boolean, toggle: () => void] {
  const [open, setOpen] = useState(() => readPref<boolean>(pref, false));
  const toggle = () =>
    setOpen((prev) => {
      writePref(pref, !prev);
      return !prev;
    });
  return [open, toggle];
}

export function useInbox(): Inbox {
  const route = useRoute();
  const { channels, pinned, needsYou, openThread } = useApp();
  const recent = useLiveThreads(`/recent?limit=${RECENT_LIMIT}`, acceptAll, RECENT_LIMIT);
  const [workingOpen, toggleWorking] = useShelf('sidebar.inbox.workingOpen');
  const [doneOpen, toggleDone] = useShelf('sidebar.inbox.doneOpen');
  const [doneLimit, setDoneLimit] = useState(DONE_INITIAL);

  const openId = route.name === 'thread' ? route.id : null;
  const openCopy = openThread && openThread.id === openId ? openThread : null;
  const handoffs = channels.find((c) => c.id === 'conductor')?.handoffs;
  const needs = needsYou?.items ?? [];
  const layout = useMemo(
    () =>
      inboxLayout({
        threads: inboxCandidates<InboxThread>({ recent: recent.data, pinned, channels, needs }),
        needs,
        delegated: delegatedIds(handoffs),
        open: openCopy,
      }),
    [recent.data, pinned, channels, needs, handoffs, openCopy],
  );
  const needOf = useMemo(() => new Map(needs.map((n) => [n.thread.id, n])), [needs]);
  const asks = (t: InboxThread) => {
    const item = needOf.get(t.id);
    return !!item && asksForYou(reasonOf(item).glyph);
  };

  return {
    pinned: layout.pinned,
    inbox: layout.inbox,
    needs: layout.inbox.filter(asks),
    finished: layout.inbox.filter((t) => !asks(t)),
    working: { ...shelfView(layout.working, { open: workingOpen, openId }), open: workingOpen, toggle: toggleWorking, threads: layout.working },
    done: {
      ...shelfView(layout.done, { open: doneOpen, openId, limit: doneLimit }),
      open: doneOpen,
      toggle: toggleDone,
      showMore: () => setDoneLimit((n) => n + DONE_PAGE),
    },
    loaded: !!recent.data,
    openId,
    status: (t) => inboxStatus(t, needOf.get(t.id)),
  };
}
