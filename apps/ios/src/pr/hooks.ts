import type { PRDetail, Thread, ThreadPRs } from '@omni/client-core';
import { failedRunIds } from '@omni/shared/pr-rerun.ts';
import type { PRWatchView } from '@omni/shared/pr-watch.ts';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useLiveHub, useChannels } from '../live/react';
import { useEvery, useFetched, useOnChange } from '../review/useFetched';
import { mergePR, rerunChecks, setWatch, type MergeOutcome, type RerunOutcome } from './actions';
import { prPage, prTarget, type PRPage } from './model';

const PR_POLL_MS = 60_000;

/**
 * The PR to show and its detail: the thread branch's own, or a delegated thread's (`picked`, else the first ready one),
 * read and merged through the delegated thread's channel. A thread without a branch asks too, since a Conductor's crew
 * may have opened PRs.
 */
export function useThreadPR(thread: Thread | null, picked: string | null = null) {
  const { channels } = useChannels();
  const id = thread?.id ?? '';

  const prs = useFetched<ThreadPRs>(`prs:${id}`, thread ? (api) => api.threadPR(id) : null);
  const { number, from } = prTarget(prs.data, picked);
  const own = channels?.find((c) => c.id === thread?.channel_id);
  const channelId = from ? from.channel_id : (own?.id ?? null);
  const githubRepo = from ? from.repo : (own?.github_repo ?? null);
  const detail = useFetched<PRDetail>(`pr:${channelId}:${number}`, channelId && githubRepo && number ? (api) => api.pullRequest(channelId, number) : null);

  const refresh = useCallback(() => {
    prs.reload();
    detail.reload();
  }, [prs.reload, detail.reload]);
  useOnChange(thread?.status, refresh);
  useEvery(PR_POLL_MS, !!thread, refresh);

  const page: PRPage = prPage({ thread, githubRepo, prs, detail, picked });
  return { page, channelId, githubRepo, number, from, refresh, reloadList: prs.reload, reloadDetail: detail.reload, loading: prs.loading || detail.loading };
}

/** The thread's PR watch. Read when the thread has a PR, and again whenever `detail` is read again. A refused start leaves its reason in `error`. */
export function usePRWatch(threadId: string, hasPR: boolean, detail: PRDetail | null) {
  const hub = useLiveHub();
  const fetched = useFetched<PRWatchView | null>(`watch:${threadId}`, hasPR ? (api) => api.prWatch(threadId) : null);
  const [set, setLocal] = useState<{ watch: PRWatchView | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setLocal(null), [fetched.data]);
  useOnChange(detail, fetched.reload);

  const watch = set ? set.watch : fetched.data;
  const toggle = useCallback(
    async (on: boolean) => {
      setBusy(true);
      setError(null);
      const out = await setWatch(hub.request, threadId, on);
      if (out.kind === 'set') setLocal({ watch: out.watch });
      else setError(out.message);
      setBusy(false);
    },
    [hub, threadId],
  );
  return { watch, watching: watch?.state === 'watching', busy, error, start: () => toggle(true), stop: () => toggle(false) };
}

/** Squash-merges a PR from its slider. On a lost reply the PR is read again, since it may have merged. */
export function useMerge(channelId: string | null, number: number | null, reload: () => void) {
  const hub = useLiveHub();
  return useMemo(
    () => async (): Promise<MergeOutcome> => {
      if (!channelId || !number) return { kind: 'refused', failure: { kind: 'other', title: 'Merge failed', detail: 'No pull request to merge.' } };
      const out = await mergePR(hub.request, channelId, number);
      if (out.kind === 'merged' || out.kind === 'unknown') reload();
      return out;
    },
    [hub, channelId, number, reload],
  );
}

/**
 * Rerun failed checks: offered while the PR is open, a failing check is a GitHub Actions job, and no rerun of this PR has
 * started yet. The outcome stays until another PR is shown.
 */
export function useRerunChecks(channelId: string | null, number: number | null, detail: PRDetail | null) {
  const hub = useLiveHub();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RerunOutcome | null>(null);
  useEffect(() => setOutcome(null), [channelId, number]);
  const run = useCallback(async () => {
    if (!channelId || !number) return;
    setBusy(true);
    setOutcome(null);
    setOutcome(await rerunChecks(hub.request, channelId, number));
    setBusy(false);
  }, [hub, channelId, number]);
  const open = !!detail && (!detail.state || detail.state === 'OPEN');
  const can = open && failedRunIds(detail.checkRuns).length > 0 && outcome?.kind !== 'started';
  return { can, busy, outcome, run };
}
