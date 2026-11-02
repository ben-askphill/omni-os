import type { BranchChanges, TurnChanges } from '@omni/shared/changes.ts';
import { apiPath, type HttpClient } from '../http.ts';

export type { BranchChanges, ChangeBase, ChangeGroup, ChangeKind, ChangedFile, TurnChanges, TurnView } from '@omni/shared/changes.ts';

export function changesApi(http: HttpClient) {
  return {
    /**
     * What a thread's worktree changed since its base commit. A thread without a worktree answers 200 with `available: false`
     * and the reason, not an error.
     */
    changes: (id: string) => http.request<BranchChanges>('GET', apiPath`/threads/${id}/changes`),
    /** What one turn changed: the newest turn, or the one `turn` names. 404 for a turn the thread does not have. */
    turnChanges: (id: string, turn?: string) => http.request<TurnChanges>('GET', apiPath`/threads/${id}/turns`, { query: { turn } }),
  };
}
