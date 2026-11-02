import type { PRWatchView } from '@omni/shared/pr-watch.ts';
import { apiPath, type HttpClient } from '../http.ts';

export interface PRChecks {
  passed: number;
  failed: number;
  pending: number;
}

export interface PRSummary {
  number: number;
  title: string;
  author: { login: string } | null;
  headRefName: string;
  baseRefName: string;
  /** OPEN, MERGED or CLOSED. Absent means open. */
  state?: string;
  isDraft: boolean;
  updatedAt: string;
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED or null. */
  reviewDecision: string | null;
  url: string;
  additions: number;
  deletions: number;
  /** MERGEABLE, CONFLICTING or UNKNOWN. */
  mergeable: string;
  checks: PRChecks;
}

export interface PRDetail extends PRSummary {
  body: string;
  files: { path: string; additions: number; deletions: number }[];
  reviews: { author: { login: string } | null; state: string; body: string; submittedAt?: string }[];
  comments: { author: { login: string } | null; body: string; createdAt?: string }[];
  checkRuns: { name: string; state: string; url?: string }[];
  /** The whole PR as a unified diff, cut at 400 KB. */
  diff: string;
}

/** GET /threads/:id/pr: the PRs opened from the thread's branch, newest first, and the one to show. Both empty with no branch or no GitHub repo. */
export interface ThreadPRs {
  pr: PRSummary | null;
  prs: PRSummary[];
}

export type MergeMethod = 'squash' | 'merge' | 'rebase';

export interface MergeOptions {
  method?: MergeMethod;
  delete_branch?: boolean;
}

export interface MergeResult {
  ok: true;
  /** What gh printed. */
  output: string;
}

export function pullsApi(http: HttpClient) {
  return {
    threadPR: (id: string) => http.request<ThreadPRs>('GET', apiPath`/threads/${id}/pr`),
    /** A PR through its channel's GitHub repo. The server refuses with "channel has no GitHub repo set" when there is none. */
    pullRequest: (channelId: string, number: number) => http.request<PRDetail>('GET', apiPath`/channels/${channelId}/prs/${number}`),
    /**
     * Merges, squashing and deleting the branch unless told otherwise. The server needs `confirm: true` on every merge, so
     * this sends it: call it only after the person confirmed. A PR GitHub will not merge answers with gh's own message.
     */
    mergePullRequest: (channelId: string, number: number, options: MergeOptions = {}) =>
      http.request<MergeResult>('POST', apiPath`/channels/${channelId}/prs/${number}/merge`, {
        body: { method: options.method ?? 'squash', delete_branch: options.delete_branch ?? true, confirm: true },
      }),
    /** The thread's PR watch, or null when it never had one. */
    prWatch: (id: string) => http.request<PRWatchView | null>('GET', apiPath`/threads/${id}/pr-watch`),
    /** Watches the branch's open PR, or PR `number`. Starting a stopped watch again resets its wake budget. A 409 says why it cannot start. */
    watchPR: (id: string, number?: number) => http.request<PRWatchView>('PUT', apiPath`/threads/${id}/pr-watch`, { body: number === undefined ? {} : { number } }),
    stopPRWatch: (id: string) => http.request<PRWatchView | null>('DELETE', apiPath`/threads/${id}/pr-watch`),
  };
}
