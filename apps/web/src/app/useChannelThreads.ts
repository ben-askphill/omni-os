import { useCallback, useEffect, useRef, useState } from 'react';
import { appendPage, channelThreadsPath, readChannelThreadsPage } from '@omni/shared/channel-threads.ts';
import { api, errorText, type Thread } from '../api.ts';
import { useFeed } from '../store.tsx';

const newestFirst = (a: Thread, b: Thread) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0);

/**
 * Every active thread in a channel, newest first, paged from the server (packages/shared/channel-threads.ts) and kept
 * current from /feed. `loadMore` adds the next older page; `more` says whether there is one. Unlike the sidebar's
 * previews, nothing drops out: an older thread is a page away and a running filed thread comes back with its folder.
 */
export function useChannelThreads(channelId: string, accept: (t: Thread) => boolean) {
  const [data, setData] = useState<Thread[] | undefined>(undefined);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  /** Bumps when the list starts over (another channel, a reload), so a page asked for before cannot land after. */
  const epoch = useRef(0);
  const lastChannel = useRef<string | null>(null);

  useEffect(() => {
    const mine = ++epoch.current;
    if (lastChannel.current !== channelId) {
      setData(undefined);
      setNext(null);
      lastChannel.current = channelId;
    }
    setLoading(true);
    setLoadingMore(false);
    api
      .get<unknown>(channelThreadsPath(channelId))
      .then((body) => {
        if (mine !== epoch.current) return;
        const page = readChannelThreadsPage<Thread>(body);
        setData(page.threads);
        setNext(page.next);
        setError(null);
      })
      .catch((e) => mine === epoch.current && setError(errorText(e)))
      .finally(() => mine === epoch.current && setLoading(false));
  }, [channelId, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const loadMore = useCallback(async () => {
    if (!next || loadingMore) return;
    const mine = epoch.current;
    setLoadingMore(true);
    try {
      const page = readChannelThreadsPage<Thread>(await api.get<unknown>(channelThreadsPath(channelId, next)));
      if (mine !== epoch.current) return;
      setData((prev) => appendPage(prev ?? [], page.threads));
      setNext(page.next);
      setError(null);
    } catch (e) {
      if (mine === epoch.current) setError(errorText(e));
    } finally {
      if (mine === epoch.current) setLoadingMore(false);
    }
  }, [channelId, next, loadingMore]);

  const acceptRef = useRef(accept);
  acceptRef.current = accept;
  useFeed((e) => {
    if (e.type === 'reconnect') return reload();
    if (e.type !== 'thread' || !acceptRef.current(e.thread)) return;
    setData((prev) => {
      if (!prev) return prev;
      const list = prev.filter((t) => t.id !== e.thread.id);
      // An archived thread leaves the list; a restored one comes back.
      if (!e.thread.archived) list.push(e.thread);
      return list.sort(newestFirst);
    });
  });

  return { data, loading, error, reload, more: next !== null, loadingMore, loadMore };
}
