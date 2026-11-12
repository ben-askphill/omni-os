import type { OmniApi, SyncStatus } from '@omni/client-core';
import { syncTrouble } from '@omni/shared/forwarded.ts';

import { useEvery, useFetched } from '../review/useFetched';

const SYNC_POLL_MS = 15_000;
const loadSync = (api: OmniApi) => api.syncStatus();

/** Why sync holds up a message forwarded to another machine, read every 15 s while one waits. Null while sync works. */
export function useSyncTrouble(waiting: boolean): string | null {
  const sync = useFetched<SyncStatus>('sync-status', waiting ? loadSync : null);
  useEvery(SYNC_POLL_MS, waiting, sync.reload);
  return waiting ? syncTrouble(sync.data) : null;
}
