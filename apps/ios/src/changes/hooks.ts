import type { ThreadStatus } from '@omni/client-core';
import { changesView, turnChangesView } from '@omni/shared/changes-view.ts';
import { useMemo } from 'react';

import { useEvery, useFetched, useOnChange } from '../review/useFetched';

export const SETTLE_POLL_MS = 1500;

/** The worktree against its base commit. Loads when `on`, and again when a turn starts or ends. */
export function useBranchChanges(threadId: string, status: ThreadStatus, on: boolean) {
  const fetched = useFetched(`base:${threadId}`, on ? (api) => api.changes(threadId) : null);
  useOnChange(status, fetched.reload);
  const view = useMemo(() => (fetched.data ? changesView(fetched.data) : null), [fetched.data]);
  return { ...fetched, view };
}

/** What the newest turn changed. Loads when `on`, again when a turn starts or ends, and polls while its snapshot is saved. */
export function useTurnChanges(threadId: string, status: ThreadStatus, on: boolean) {
  const fetched = useFetched(`turn:${threadId}`, on ? (api) => api.turnChanges(threadId) : null);
  useOnChange(status, fetched.reload);
  const view = useMemo(() => (fetched.data ? turnChangesView(fetched.data) : null), [fetched.data]);
  useEvery(SETTLE_POLL_MS, on && view?.turn.state === 'capturing', fetched.reload);
  return { ...fetched, view };
}
