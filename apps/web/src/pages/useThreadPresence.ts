import { useEffect } from 'react';
import type { Thread } from '../api.ts';
import { shownResult } from '../needs-you.ts';
import { useApp, usePageVisible } from '../store.tsx';

/** What the app knows about the thread on screen: the sidebar lists it, and its newest result counts as read. */
export function useThreadPresence(id: string, thread: Thread | null) {
  const { setOpenThread, needsYou, readResult } = useApp();

  // The sidebar keeps this thread listed under its channel, with live title and status, even once it stops.
  useEffect(() => {
    if (thread) setOpenThread({ id: thread.id, channel_id: thread.channel_id, title: thread.title, status: thread.status, created_at: thread.created_at, done_at: thread.done_at });
  }, [thread?.id, thread?.channel_id, thread?.title, thread?.status, thread?.created_at, thread?.done_at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setOpenThread(null), [setOpenThread]);

  // On screen, the thread's newest result is read: exactly the one Needs you listed, so a turn that ends after it
  // stays unread until the inbox lists it and this shows it too. A hidden tab reads nothing.
  const visible = usePageVisible();
  const shown = shownResult(needsYou, id, thread?.status);
  useEffect(() => {
    if (shown && visible) readResult(shown);
  }, [shown, visible, readResult]);
}
