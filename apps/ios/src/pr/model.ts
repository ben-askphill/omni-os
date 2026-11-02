import type { PRDetail, ThreadPRs } from '@omni/client-core';
import { mergeNote, reviewLine, reviewSummary, type MergeRefusal, type ReviewSummary } from '@omni/shared/pr-merge.ts';
import { checkTone, prBadge, prLine, prNext, type PRNext, type PRTone } from '@omni/shared/thread-glance.ts';

import type { Fetched, ReviewFailure } from '../review/failure';

export interface PRPageInput {
  /** Null until the thread loads. */
  thread: { branch: string | null } | null;
  githubRepo: string | null | undefined;
  prs: Fetched<ThreadPRs>;
  detail: Fetched<PRDetail>;
}

export const NO_BRANCH = 'This thread works without a branch, so it has no pull request.';
export const NO_PR = 'No pull request from this branch yet.';
export const noRepo = (n: number) => `PR #${n} is open. Set this channel's GitHub repo on the desktop to read it here.`;

export type PRPage =
  | { kind: 'loading' }
  | { kind: 'failed'; failure: ReviewFailure; of: 'list' | 'detail' }
  | { kind: 'empty'; text: string; canOpen: boolean }
  | { kind: 'pr'; pr: PRDetail };

export function prPage({ thread, githubRepo, prs, detail }: PRPageInput): PRPage {
  if (!thread) return { kind: 'loading' };
  if (!thread.branch) return { kind: 'empty', text: NO_BRANCH, canOpen: false };
  if (prs.failure && !prs.data) return { kind: 'failed', failure: prs.failure, of: 'list' };
  if (!prs.data) return { kind: 'loading' };
  const number = prs.data.pr?.number;
  if (!number) return { kind: 'empty', text: NO_PR, canOpen: true };
  if (!githubRepo) return { kind: 'empty', text: noRepo(number), canOpen: false };
  if (detail.data && detail.data.number === number) return { kind: 'pr', pr: detail.data };
  if (detail.failure) return { kind: 'failed', failure: detail.failure, of: 'detail' };
  return { kind: 'loading' };
}

export type CheckTone = ReturnType<typeof checkTone>;

export interface PRContent {
  number: number;
  title: string;
  url: string;
  open: boolean;
  badge: ReturnType<typeof prBadge>;
  /** The state line under the title: checks, conflicts, review. */
  status: { text: string; tone: PRTone };
  additions: number;
  deletions: number;
  files: PRDetail['files'];
  branches: string;
  checks: { key: string; name: string; state: string; tone: CheckTone }[];
  review: ReviewSummary;
  reviewLine: string | null;
  /** Why merging now may be a mistake. Empty when nothing is. */
  note: string;
  canMerge: boolean;
  next: PRNext;
}

const stateLabel = (state: string) => state.toLowerCase().replace(/_/g, ' ');

export function prContent(pr: PRDetail): PRContent {
  const open = !pr.state || pr.state === 'OPEN';
  const review = reviewSummary(pr);
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    open,
    badge: prBadge(pr),
    status: prLine(pr),
    additions: pr.additions,
    deletions: pr.deletions,
    files: pr.files,
    branches: `${pr.headRefName} → ${pr.baseRefName}`,
    checks: pr.checkRuns.map((c, i) => ({ key: `${c.name}:${i}`, name: c.name, state: stateLabel(c.state), tone: checkTone(c.state) })),
    review,
    reviewLine: reviewLine(review),
    note: mergeNote(pr),
    canMerge: open && !pr.isDraft,
    next: prNext(pr, true),
  };
}

/** What to do after GitHub refused a merge, by the kind of refusal. gh's own message goes beside it. */
export const MERGE_ADVICE: Record<MergeRefusal, string> = {
  conflict: 'Ask the agent to fix the conflicts, then slide again.',
  blocked: 'GitHub is holding this merge. A required check or review is missing.',
  draft: 'Mark the pull request ready for review on GitHub, then slide again.',
  closed: 'This pull request is no longer open.',
  other: 'Nothing was merged.',
};
