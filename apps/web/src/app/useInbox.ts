// The Inbox that the sidebar's Inbox view and the phone's Activity tab both show, so the two never drift: which threads,
// on which shelf, with what status, and how far each shelf is open. The rules are apps/web/src/inbox.ts.
import { useMemo, useState } from 'react';
import { delegatedIds, delegatesByParent } from '@omni/shared/delegate-count.ts';
import { taskHost, type ThreadStub } from '../api.ts';
import { DONE_INITIAL, DONE_PAGE, inboxLayout, rowStatus, shelfView, type InboxThread, type RowStatus, type ShelfView } from '../inbox.ts';
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
  working: InboxShelf;
  done: InboxShelf & { showMore: () => void };
  /** The recent list has come, so an empty inbox means nothing waits. */
  loaded: boolean;
  /** The thread on screen, if any. */
  openId: string | null;
  status: (t: InboxThread) => RowStatus | null;
  /** A Conductor thread's delegated threads, by its id: their count on its row stands for them. */
  delegates: Map<string, readonly ThreadStub[]>;
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
  const { channels, pinned, needsYou, openThread, tasks } = useApp();
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
        threads: [...(recent.data ?? []), ...pinned, ...channels.flatMap((c) => c.active ?? []), ...needs.map((n) => n.thread)],
        needs,
        delegated: delegatedIds(handoffs),
        open: openCopy,
      }),
    [recent.data, pinned, channels, needs, handoffs, openCopy],
  );
  const needOf = useMemo(() => new Map(needs.map((n) => [n.thread.id, n])), [needs]);

  return {
    pinned: layout.pinned,
    inbox: layout.inbox,
    working: { ...shelfView(layout.working, { open: workingOpen, openId }), open: workingOpen, toggle: toggleWorking },
    done: {
      ...shelfView(layout.done, { open: doneOpen, openId, limit: doneLimit }),
      open: doneOpen,
      toggle: toggleDone,
      showMore: () => setDoneLimit((n) => n + DONE_PAGE),
    },
    loaded: !!recent.data,
    openId,
    status: (t) => rowStatus(t, needOf.get(t.id), tasks.filter((k) => taskHost(k) === t.id).length),
    delegates: delegatesByParent(handoffs),
  };
}
