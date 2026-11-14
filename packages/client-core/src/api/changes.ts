import type { BranchChanges, TurnChanges } from '@omni/shared/changes.ts';
import type { DiffSelection } from '@omni/shared/message-context-diff.ts';
import type { ReviewNote, ReviewNotesList, ReviewNotesSent } from '@omni/shared/review-notes.ts';
import { apiPath, type HttpClient } from '../http.ts';

export type { BranchChanges, ChangeBase, ChangeGroup, ChangeKind, ChangedFile, TurnChanges, TurnView } from '@omni/shared/changes.ts';
export type { ReviewNote, ReviewNotesList, ReviewNotesSent } from '@omni/shared/review-notes.ts';

export function changesApi(http: HttpClient) {
  return {
    /**
     * What a thread's worktree changed since its base commit. A thread without a worktree answers 200 with `available: false`
     * and the reason, not an error.
     */
    changes: (id: string) => http.request<BranchChanges>('GET', apiPath`/threads/${id}/changes`),
    /** What one turn changed: the newest turn, or the one `turn` names. 404 for a turn the thread does not have. */
    turnChanges: (id: string, turn?: string) => http.request<TurnChanges>('GET', apiPath`/threads/${id}/turns`, { query: { turn } }),
    /** The thread's review notes on its Changes diff, oldest first (packages/shared/review-notes.ts). */
    reviewNotes: (id: string) => http.request<ReviewNotesList>('GET', apiPath`/threads/${id}/review-notes`),
    /** Pins a note to lines: `anchor` is the diff_selection body `selectRows` made. */
    addReviewNote: (id: string, anchor: DiffSelection, body: string) =>
      http.request<{ note: ReviewNote }>('POST', apiPath`/threads/${id}/review-notes`, { body: { anchor, body } }),
    /** A new body reopens a sent note; `resolved` resolves or reopens it. */
    updateReviewNote: (id: string, note: string, change: { body?: string; resolved?: boolean }) =>
      http.request<{ note: ReviewNote }>('PATCH', apiPath`/threads/${id}/review-notes/${note}`, { body: change }),
    deleteReviewNote: (id: string, note: string) => http.request<{ ok: true }>('DELETE', apiPath`/threads/${id}/review-notes/${note}`),
    /** Send open notes: one message with every open note on it. `target` is the thread it goes to, this one when left out. */
    sendReviewNotes: (id: string, opts: { target?: string } = {}) => http.request<ReviewNotesSent>('POST', apiPath`/threads/${id}/review-notes/send`, { body: opts }),
  };
}
