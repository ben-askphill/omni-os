import { useCallback, useMemo, useRef, useState } from 'react';
import { api, type NeedsYou, type Thread } from '../api.ts';
import { coalesced, withoutResult, withoutThread } from '../needs-you.ts';

/** The unread results and blockers across every thread (GET /api/needs-you), and the two ways Ben clears one. */
export function useNeedsYou(reloadChannels: () => Promise<void>) {
  const [needsYou, setNeedsYou] = useState<NeedsYou | null>(null);
  /** Bumps on each read, so an inbox fetched before it cannot put the read result back. */
  const needsYouEpoch = useRef(0);

  const reloadNeedsYou = useCallback(() => {
    const epoch = needsYouEpoch.current;
    return api
      .get<NeedsYou>('/needs-you')
      .then((n) => void (epoch === needsYouEpoch.current && setNeedsYou(n)))
      .catch(() => {});
  }, []);
  /** On a `needs_you` event: a read or a result here, on another client or from the other Mac's sync, often in a burst. */
  const needsYouChanged = useMemo(() => coalesced(reloadNeedsYou), [reloadNeedsYou]);

  const readResult = useCallback(
    (uid: string) => {
      needsYouEpoch.current++;
      setNeedsYou((prev) => (prev ? withoutResult(prev, uid) : prev));
      // Whatever the answer, the server's inbox is the truth: a newer result may have come in meanwhile.
      api
        .post('/needs-you/read', { uid })
        .catch(() => {})
        .finally(reloadNeedsYou);
    },
    [reloadNeedsYou],
  );

  const setDone = useCallback(
    async (threadId: string, on: boolean) => {
      if (on) {
        needsYouEpoch.current++;
        setNeedsYou((prev) => (prev ? withoutThread(prev, threadId) : prev));
      }
      try {
        return await api.patch<Thread>(`/threads/${encodeURIComponent(threadId)}`, { done: on });
      } finally {
        // Refused or not, the server's inbox and lists are the truth.
        void reloadNeedsYou();
        void reloadChannels();
      }
    },
    [reloadNeedsYou, reloadChannels],
  );

  return { needsYou, reloadNeedsYou, needsYouChanged, readResult, setDone };
}
