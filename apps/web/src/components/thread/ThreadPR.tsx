import { useCallback, useEffect, useState } from 'react';
import { api, type CrewPR, type PRSummary, type Thread } from '../../api.ts';

/** A thread's own PRs (none without a branch) and the PRs the threads it delegated to opened. */
export type ThreadPRData = { pr: PRSummary | null; prs: PRSummary[]; crew: CrewPR[] };

/**
 * A thread branch's PR and every PR from it, and the PRs its delegated threads opened, from GET /threads/:id/pr: again
 * when a turn ends (it may have opened the PR), and every minute to catch a merge. Undefined until the first answer.
 * A thread with no branch has no PR of its own, but a Conductor's crew may have opened some, so it asks too. `eager`
 * also asks once mid-turn, for a screen that has nothing else to show. The second value asks again now, as after a merge.
 */
export function useThreadPR(thread: Pick<Thread, 'id' | 'branch'> | null, slotBusy: boolean, eager = false) {
  const [data, setData] = useState<ThreadPRData | undefined>(undefined);
  const id = thread?.id ?? null;
  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api.get<{ pr: PRSummary | null; prs?: PRSummary[]; crew?: CrewPR[] }>(`/threads/${encodeURIComponent(id)}/pr`);
      setData({ pr: r.pr, prs: r.prs ?? (r.pr ? [r.pr] : []), crew: r.crew ?? [] });
    } catch {
      setData((prev) => prev ?? { pr: null, prs: [], crew: [] });
    }
  }, [id]);
  // GitHub works out `mergeable` and the checks a few seconds after a push, so the read at the turn's end can still say
  // CONFLICTING. Two more reads catch it instead of the minute-long tick.
  useEffect(() => {
    if (slotBusy) return;
    void load();
    const t = [5_000, 15_000].map((ms) => setTimeout(() => void load(), ms));
    return () => t.forEach(clearTimeout);
  }, [load, slotBusy, thread?.branch]);
  // Idle, the effect above already asked.
  useEffect(() => {
    if (eager && slotBusy) void load();
  }, [eager, load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    return () => clearInterval(tick);
  }, [load]);
  return [data, load] as const;
}
