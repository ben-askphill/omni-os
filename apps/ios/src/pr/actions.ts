import { OmniHttpError, type OmniApi } from '@omni/client-core';
import { classifyMergeFailure, type MergeFailure } from '@omni/shared/pr-merge.ts';
import type { PRWatchView } from '@omni/shared/pr-watch.ts';
import { rerunText } from '@omni/shared/pr-rerun.ts';

import { describeFailure } from '../review/failure';

export type MergeApi = Pick<OmniApi, 'mergePullRequest'>;
export type WatchApi = Pick<OmniApi, 'watchPR' | 'stopPRWatch'>;
export type RerunApi = Pick<OmniApi, 'rerunFailedChecks'>;

export type MergeOutcome =
  | { kind: 'merged' }
  /** GitHub or gh said no, and said which rule. Nothing merged. */
  | { kind: 'refused'; failure: MergeFailure }
  /** The reply never arrived, so the merge may have happened. */
  | { kind: 'unknown'; message: string }
  | { kind: 'signed-out'; message: string };

const unknownMessage = (n: number) => `Lost the connection while merging. Check whether #${n} merged before you try again.`;

/**
 * Squash-merges and deletes the branch. A 4xx or 5xx that carries gh's own message is a refusal, so nothing merged. A failure with no answer from the server is not: the request may have gone through.
 */
export async function mergePR(call: <T>(fn: (api: MergeApi) => Promise<T>) => Promise<T>, channelId: string, number: number): Promise<MergeOutcome> {
  try {
    await call((api) => api.mergePullRequest(channelId, number, { method: 'squash', delete_branch: true }));
    return { kind: 'merged' };
  } catch (e) {
    if (e instanceof OmniHttpError && e.failure.kind === 'http') {
      if (e.failure.status === 401) return { kind: 'signed-out', message: describeFailure(e).message };
      return { kind: 'refused', failure: classifyMergeFailure(e.failure.message) };
    }
    const failure = describeFailure(e);
    return failure.kind === 'signed-out' ? { kind: 'signed-out', message: failure.message } : { kind: 'unknown', message: unknownMessage(number) };
  }
}

export type WatchOutcome = { kind: 'set'; watch: PRWatchView | null } | { kind: 'failed'; message: string };

/** Starts the thread's PR watch, or stops it. A refused start (no open PR, no GitHub) comes back with the server's reason. */
export async function setWatch(call: <T>(fn: (api: WatchApi) => Promise<T>) => Promise<T>, threadId: string, on: boolean): Promise<WatchOutcome> {
  try {
    return { kind: 'set', watch: await call((api) => (on ? api.watchPR(threadId) : api.stopPRWatch(threadId))) };
  } catch (e) {
    return { kind: 'failed', message: describeFailure(e).message };
  }
}

export type RerunOutcome = { kind: 'started'; text: string } | { kind: 'failed'; message: string };

/** `gh run rerun --failed` for each failing workflow run, through the server. A refusal comes back with the server's or gh's reason. */
export async function rerunChecks(call: <T>(fn: (api: RerunApi) => Promise<T>) => Promise<T>, channelId: string, number: number): Promise<RerunOutcome> {
  try {
    return { kind: 'started', text: rerunText(await call((api) => api.rerunFailedChecks(channelId, number))) };
  } catch (e) {
    return { kind: 'failed', message: describeFailure(e).message };
  }
}
