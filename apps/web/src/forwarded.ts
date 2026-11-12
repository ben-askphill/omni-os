// Sync's state while a forwarded message waits. What the row says lives in @omni/shared/forwarded.ts, which iOS reads too.
import { useEffect } from 'react';
import { syncTrouble } from '@omni/shared/forwarded.ts';
import { useApi, type SyncStatus } from './api.ts';

export { forwardedLabel, isForwarded } from '@omni/shared/forwarded.ts';

/** Sync's state while a forwarded message waits, read again every 15 s, so the row says when sync is the hold-up. */
export function useSyncTrouble(waiting: boolean): string | null {
  const { data, reload } = useApi<SyncStatus>(waiting ? '/sync/status' : null);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, [waiting, reload]);
  return waiting ? syncTrouble(data) : null;
}
