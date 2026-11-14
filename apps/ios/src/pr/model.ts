import type { CrewPR, PRDetail, ThreadPRs } from '@omni/client-core';
import { mergeNote, reviewLine, reviewSummary, type MergeRefusal, type ReviewSummary } from '@omni/shared/pr-merge.ts';
import { checkTone, prBadge, prLine, prNext, type PRNext, type PRTone, type StepPrompts } from '@omni/shared/thread-glance.ts';

import type { Fetched, ReviewFailure } from '../review/failure';

export interface PRPageInput {
  /** Null until the thread loads. */
  thread: { branch: string | null } | null;
  /** The repo of the channel the shown PR lives in: the thread's own, or the delegated thread's for a crew PR. */
  githubRepo: string | null | undefined;
  prs: Fetched<ThreadPRs>;
  detail: Fetched<PRDetail>;
  /** The URL of the delegated PR picked from the list, or null. */
  picked?: string | null;
}

export const NO_BRANCH = 'This thread works without a branch, so it has no pull request.';
export const NO_PR = 'No pull request from this branch yet.';
export const noRepo = (n: number) => `PR #${n} is open. Set this channel's GitHub repo on the desktop to read it here.`;

/** The PR the screen shows. `from` is set when it is a delegated thread's, and says where to read and merge it. */
export interface PRTarget {
  number: number | null;
  from: CrewPR | null;
}

/**
 * The delegated PR picked from the list, else the thread's own PR, else its first open, non-draft delegated PR. So a
 * Conductor thread, which has no branch, opens on the first of its delegates' PRs that is ready to merge.
 */
export function prTarget(prs: ThreadPRs | null, picked: string | null = null): PRTarget {
  const crew = prs?.crew ?? [];
  const from = crew.find((p) => p.url === picked) ?? (prs?.pr ? undefined : crew.find((p) => p.state === 'OPEN' && !p.isDraft));
  return { number: from?.number ?? prs?.pr?.number ?? null, from: from ?? null };
}

/** `crew`: the delegated threads' PRs, listed under the page. `text` is null when that list is all there is to show. */
export type PRPage =
  | { kind: 'loading' }
  | { kind: 'failed'; failure: ReviewFailure; of: 'list' | 'detail' }
  | { kind: 'empty'; text: string | null; canOpen: boolean; crew: CrewPR[] }
  | { kind: 'pr'; pr: PRDetail; from: CrewPR | null; crew: CrewPR[] };

export function prPage({ thread, githubRepo, prs, detail, picked = null }: PRPageInput): PRPage {
  if (!thread) return { kind: 'loading' };
  if (prs.failure && !prs.data) return { kind: 'failed', failure: prs.failure, of: 'list' };
  if (!prs.data) return { kind: 'loading' };
  const crew = prs.data.crew ?? [];
  const { number, from } = prTarget(prs.data, picked);
  if (!number) return { kind: 'empty', text: thread.branch ? NO_PR : crew.length ? null : NO_BRANCH, canOpen: !!thread.branch, crew };
  if (!githubRepo) return { kind: 'empty', text: noRepo(number), canOpen: false, crew };
  if (detail.data && detail.data.number === number) return { kind: 'pr', pr: detail.data, from, crew };
  if (detail.failure) return { kind: 'failed', failure: detail.failure, of: 'detail' };
  return { kind: 'loading' };
}

/** A row of the delegated PRs list. */
export interface CrewPRRow {
  key: string;
  title: string;
  /** `#4 · T-AB12 · Add the size guide`. */
  detail: string;
  badge: ReturnType<typeof prBadge>;
  pr: CrewPR;
}

export const crewRows = (crew: readonly CrewPR[]): CrewPRRow[] =>
  crew.map((p) => ({ key: p.url, title: p.title, detail: [`#${p.number}`, p.task_id, p.thread_title].filter(Boolean).join(' · '), badge: prBadge(p), pr: p }));

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

/** `prompts`: the channel's step prompts (`stepPrompts`), which the Fix conflicts and Fix checks buttons send. */
export function prContent(pr: PRDetail, prompts?: StepPrompts): PRContent {
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
    next: prNext(pr, true, prompts),
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
