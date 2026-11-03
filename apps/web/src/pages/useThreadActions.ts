import { useState } from 'react';
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
  applyThread,
  setActionError,
  pin,
}: {
  id: string;
  thread: Thread | null;
  slotBusy: boolean;
  applyThread: (t: Thread, replace?: boolean) => void;
  setActionError: (e: string | null) => void;
  pin: () => void;
}) {
  const { reloadChannels, setDone } = useApp();
  // The step prompt being sent, so its button turns to working at the click, before the thread shows the message.
  const [sending, setSending] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const ask = async (prompt: string) => {
    setSending(prompt);
    setActionError(null);
    try {
      // Mid-turn, wait for the work to finish instead of steering it to commit halfway.
      const mode: SendMode | undefined = slotBusy ? 'queue' : undefined;
      const t = await api.post<Thread>(`/threads/${encodeURIComponent(id)}/messages`, { prompt, mode });
      applyThread(t, true);
      pin();
    } catch (e) {
      setActionError(errorText(e));
    } finally {
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
