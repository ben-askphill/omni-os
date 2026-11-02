import type { PRDetail, Thread, ThreadPRs } from '@omni/client-core';
import type { PRWatchView } from '@omni/shared/pr-watch.ts';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useLiveHub, useChannels } from '../live/react';
import { useEvery, useFetched, useOnChange } from '../review/useFetched';
import { mergePR, setWatch, type MergeOutcome } from './actions';
import { prPage, type PRPage } from './model';

const PR_POLL_MS = 60_000;

/** The thread branch's PR and, through the channel's GitHub repo, its detail. */
export function useThreadPR(thread: Thread | null) {
  const { channels } = useChannels();
  const channel = channels?.find((c) => c.id === thread?.channel_id);
  const githubRepo = channel?.github_repo ?? null;
  const hasBranch = !!thread?.branch;
  const id = thread?.id ?? '';

  const prs = useFetched<ThreadPRs>(`prs:${id}`, thread && hasBranch ? (api) => api.threadPR(id) : null);
  const number = prs.data?.pr?.number ?? null;
  const detail = useFetched<PRDetail>(`pr:${channel?.id}:${number}`, channel && githubRepo && number ? (api) => api.pullRequest(channel.id, number) : null);

  const refresh = useCallback(() => {
    prs.reload();
    detail.reload();
  }, [prs.reload, detail.reload]);
  useOnChange(thread?.status, refresh);
  useEvery(PR_POLL_MS, hasBranch, refresh);

  const page: PRPage = prPage({ thread, githubRepo, prs, detail });
  return { page, channelId: channel?.id ?? null, githubRepo, number, refresh, reloadList: prs.reload, reloadDetail: detail.reload, loading: prs.loading || detail.loading };
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
