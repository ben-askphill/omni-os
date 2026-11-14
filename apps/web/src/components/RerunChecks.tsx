import { useEffect, useState } from 'react';
import { failedRunIds, rerunText, type RerunCheck, type RerunResult } from '@omni/shared/pr-rerun.ts';
import { api, errorText } from '../api.ts';
import { ErrorNote, StatusDot } from './ui.tsx';

type Outcome = { ok: true; text: string } | { ok: false; text: string };

/**
 * Rerun failed checks on a PR page (desktop) and the phone PR screen: `gh run rerun --failed` for each failing workflow
 * run, with no agent turn. `can` holds while the PR is open and a failing check is a GitHub Actions job and no rerun of
 * this PR has started yet. The outcome stays until another PR is shown.
 */
export function useRerunFailedChecks(channelId: string | undefined, n: number | undefined, checks: readonly RerunCheck[] | undefined, open: boolean) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  useEffect(() => setOutcome(null), [channelId, n]);

  const run = async () => {
    if (!channelId || !n) return;
    setBusy(true);
    setOutcome(null);
    try {
      const r = await api.post<RerunResult>(`/channels/${encodeURIComponent(channelId)}/prs/${n}/rerun-failed`, {});
      setOutcome({ ok: true, text: rerunText(r) });
    } catch (e) {
      setOutcome({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  const can = open && !!checks && failedRunIds(checks).length > 0 && !outcome?.ok;
  return { can, busy, outcome, run };
}

/** What the rerun answered, in place: the runs that started again, or why none did. */
export function RerunNote({ outcome, className = '' }: { outcome: Outcome | null; className?: string }) {
  if (!outcome) return null;
  if (!outcome.ok) return <ErrorNote className={className}>{outcome.text}</ErrorNote>;
  return (
    <div role="status" className={`pop-in flex items-start gap-2.5 rounded-[var(--r-xl)] bg-surface px-4 py-3 text-[length:var(--fs-ui)] text-fg ${className}`}>
      <StatusDot status="running" size={9} className="mt-1 shrink-0" />
      <span>{outcome.text}</span>
    </div>
  );
}
