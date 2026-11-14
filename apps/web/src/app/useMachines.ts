import { useEffect, useRef } from 'react';
import type { MachinesView } from '@omni/shared/machines.ts';
import { useApi } from '../api.ts';
import { useFeed } from '../store.tsx';

/** How long a burst of feed events settles before asking again, as the store's own running counts do. */
const SETTLE_MS = 500;
/** Tailscale's view of the other machines changes with no feed event: ask again this often. */
const POLL_MS = 15_000;

/**
 * GET /api/machines, kept current: again after the feed's thread, tasks and Needs you events (a synced machine's runs
 * raise them here too), and every 15 seconds for whether each machine is up.
 */
export function useMachines() {
  const machines = useApi<MachinesView>('/machines');
  const { reload } = machines;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useFeed((e) => {
    if (e.type !== 'thread' && e.type !== 'tasks' && e.type !== 'needs_you') return;
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      reload();
    }, SETTLE_MS);
  });
  useEffect(() => {
    const t = setInterval(reload, POLL_MS);
    return () => {
      clearInterval(t);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [reload]);
  return machines;
}
