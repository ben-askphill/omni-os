import { useEffect, useRef } from 'react';
import type { MachinesView } from '@omni/shared/machines.ts';
import { useApi } from '../api.ts';
import { useFeed } from '../store.tsx';
import { useVisibleInterval } from '../visible.ts';

/** How long a burst of feed events settles before asking again, as the store's own running counts do. */
const SETTLE_MS = 500;
/** Tailscale's view of the other machines changes with no feed event: ask again this often. */
const POLL_MS = 15_000;

/**
 * GET /api/machines, kept current: again after the feed's thread, tasks and Needs you events (a synced machine's runs
 * raise them here too), and every 15 seconds for whether each machine is up. All of it stops while the page is hidden
 * or `shown` is false (a phone tab under another one), so the server stops sampling, and it asks once on return.
 */
export function useMachines(shown = true) {
  const machines = useApi<MachinesView>('/machines', { background: true });
  const { reload } = machines;
  const live = useVisibleInterval(reload, POLL_MS, shown);
  const liveRef = useRef(live);
  liveRef.current = live;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useFeed((e) => {
    if (e.type !== 'thread' && e.type !== 'tasks' && e.type !== 'needs_you') return;
    if (timer.current || !liveRef.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      if (liveRef.current) reload();
    }, SETTLE_MS);
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return machines;
}
