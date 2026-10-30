import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { appendLive, boundHistory, emptyHistory, tailId, type History, type HistoryPage } from '@omni/shared/history.ts';
import { api, type HistoryEvent, type ThreadOpen } from '../api.ts';
import { headOf, historyLoader, joinSnapshot, opening } from '../thread-history.ts';

/**
 * The rows the thread holds and the loads on them (#223). useThreadSession owns the rest of the detail. A thread
 * opens on its newest page; earlier pages, a search hit's page and a clipped row's whole copy load on demand.
 */
export function useThreadHistory(threadId: string) {
  const [history, setHistory] = useState<History<HistoryEvent>>(emptyHistory);
  const current = useRef(history);
  current.current = history;
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  /**
   * The stream's `after`: the newest row the first load or the stream brought. An older page never moves it. A snapshot
   * sets it to its page's newest row, which the server sends as the sync's id, so the stream resumes right after it.
   */
  const lastId = useRef(0);

  const update = useCallback((fn: (h: History<HistoryEvent>) => History<HistoryEvent>) => {
    setHistory((h) => {
      const next = fn(h);
      current.current = next;
      return next;
    });
  }, []);

  const path = `/threads/${encodeURIComponent(threadId)}`;
  const page = useCallback((query: string) => api.get<HistoryPage<HistoryEvent>>(`${path}/history?${query}`), [path]);
  const loader = useMemo(
    () => historyLoader<HistoryEvent>({ page, row: (id) => api.get<HistoryEvent>(`${path}/events/${id}`), get: () => current.current, update, changed: bump }),
    [page, path, update],
  );

  /** The first state for a detail fetched with ?history=recent, with the page holding `at` when given. */
  const prepare = useCallback((d: ThreadOpen, at?: number) => opening(d.events, headOf(d), at, page), [page]);
  /** Takes the first state. */
  const open = useCallback(
    (h: History<HistoryEvent>) => {
      lastId.current = Math.max(lastId.current, tailId(h));
      update(() => h);
    },
    [update],
  );
  /**
   * Whether the view follows the newest row. While it does, live rows past RETAIN drop the oldest held rows (#411);
   * while Ben reads older rows, only the hard limit does. The view sets it.
   */
  const follows = useRef<() => boolean>(() => true);
  const pending = useRef<HistoryEvent[]>([]);
  const frame = useRef<number | undefined>(undefined);
  /** Rows from the live stream. Streams arrive in bursts; they go in once per frame instead of once per row. */
  const append = useCallback(
    (rows: HistoryEvent[]) => {
      for (const r of rows) lastId.current = Math.max(lastId.current, r.id);
      pending.current.push(...rows);
      frame.current ??= requestAnimationFrame(() => {
        frame.current = undefined;
        const batch = pending.current;
        pending.current = [];
        update((h) => boundHistory(appendLive(h, batch), follows.current()));
      });
    },
    [update],
  );
  /** A sync with the newest page in place of a replay. Rows still waiting for their frame join the old head first. */
  const snapshot = useCallback(
    (d: ThreadOpen) => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
      const batch = pending.current;
      pending.current = [];
      lastId.current = tailId({ rows: d.events });
      update((h) => joinSnapshot(h, batch, d.events, headOf(d)));
    },
    [update],
  );
  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return useMemo(
    () => ({ history, lastId, follows, prepare, open, append, snapshot, ...loader }),
    // `version` re-renders the controls when a load starts, lands or fails.
    [history, version, prepare, open, append, snapshot, loader], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

export type ThreadHistory = ReturnType<typeof useThreadHistory>;
