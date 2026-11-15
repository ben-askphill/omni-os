import { useEffect } from 'react';
import { api, type Thread } from '../api.ts';
import { seesUnlisted } from '../needs-you.ts';

/**
 * Marks a delegated or team thread's newest result seen while it is on screen (seesUnlisted), once per turn it shows.
 * Shared by the desktop thread page and the phone thread screens.
 */
export function useSeenUnlisted(id: string, thread: Pick<Thread, 'status' | 'parent_id' | 'source'> | null, shown: string | null, visible: boolean) {
  const sees = seesUnlisted(thread, shown, visible);
  const status = thread?.status;
  useEffect(() => {
    if (sees) api.post('/needs-you/seen', { thread: id }).catch(() => {});
  }, [sees, id, status]);
}
