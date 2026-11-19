// Sync's state while a forwarded message waits. What the row says lives in @omni/shared/forwarded.ts, which iOS reads too.
import { syncTrouble } from '@omni/shared/forwarded.ts';
import { useApi, type SyncStatus } from './api.ts';
import { useVisibleInterval } from './visible.ts';

export { forwardedLabel, isForwarded } from '@omni/shared/forwarded.ts';

/**
 * Sync's state while a forwarded message waits, read again every 15 s while the page is on screen (and once on coming
 * back), so the row says when sync is the hold-up.
 */
export function useSyncTrouble(waiting: boolean): string | null {
  const { data, reload } = useApi<SyncStatus>(waiting ? '/sync/status' : null, { background: true });
  useVisibleInterval(reload, 15_000, waiting);
  return waiting ? syncTrouble(data) : null;
}
