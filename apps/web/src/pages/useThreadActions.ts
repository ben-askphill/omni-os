import { useEffect, useRef, useState } from 'react';
import { stepOf, type PRStep } from '@omni/shared/thread-glance.ts';
import { api, errorText, type SendMode, type Thread } from '../api.ts';
import { OPEN_PR_PROMPT } from '../components/thread/ThreadPR.tsx';
import { useApp } from '../store.tsx';

/**
 * The page's own actions on a thread: ask the agent for a branch step (open a PR, fix conflicts or checks), restore it
 * from the archive, mark it done. Failures land in `setActionError`.
 */
export function useThreadActions({
  id,
  thread,
  slotBusy,
  underway,
  applyThread,
  setActionError,
  pin,
}: {
  id: string;
  thread: Thread | null;
  slotBusy: boolean;
  /** The step the thread itself shows underway (`stepUnderway`), which takes over from `sending` once it catches up. */
  underway: PRStep | null;
  applyThread: (t: Thread, replace?: boolean) => void;
  setActionError: (e: string | null) => void;
  pin: () => void;
}) {
  const { reloadChannels, setDone } = useApp();
  // The step prompt sent from a button, so the button reads as working from the click to the end of the turn it starts.
  // The thread's own state (`underway`) blinks off in between: the POST returns before the stream has the message, and
  // the stream drops the pending row a frame before the recorded message arrives. So it holds until the thread has
  // shown the step and then gone idle.
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const seen = useRef(false);
  useEffect(() => {
    if (!sending) return;
    if (underway !== null && underway === stepOf(sending)) seen.current = true;
    else if (seen.current && !slotBusy) setSending(null);
  }, [sending, underway, slotBusy]);
  // In case the thread never shows it (another client cleared the queue, the turn ended between two renders).
  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => {
      if (!seen.current) setSending(null);
      setSent(false);
    }, 15_000);
    return () => clearTimeout(t);
  }, [sent]);
  const [restoring, setRestoring] = useState(false);

  const ask = async (prompt: string) => {
    seen.current = false;
    setSending(prompt);
    setSent(false);
    setActionError(null);
    try {
      // Mid-turn, wait for the work to finish instead of steering it to commit halfway.
      const mode: SendMode | undefined = slotBusy ? 'queue' : undefined;
      const t = await api.post<Thread>(`/threads/${encodeURIComponent(id)}/messages`, { prompt, mode });
      applyThread(t, true);
      pin();
      setSent(true);
    } catch (e) {
      setActionError(errorText(e));
      setSending(null);
    }
  };

  const openPR = () => ask(OPEN_PR_PROMPT);

  // An archived thread opened from its channel's Archived list or a search: put it back in the lists.
  const restore = async () => {
    setRestoring(true);
    setActionError(null);
    try {
      applyThread(await api.patch<Thread>(`/threads/${encodeURIComponent(id)}`, { archived: false }), true);
      await reloadChannels();
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setRestoring(false);
    }
  };

  // Done or not, from the header: out of Needs you at once, and the thread's copy follows the server's answer.
  const toggleDone = async () => {
    setActionError(null);
    try {
      applyThread(await setDone(thread!.id, !thread?.done_at), true);
    } catch (e) {
      setActionError(errorText(e));
    }
  };

  return { sending, restoring, ask, openPR, restore, toggleDone };
}
