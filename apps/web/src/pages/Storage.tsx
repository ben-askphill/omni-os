import { useEffect, useState } from 'react';
import { ELIGIBLE_LABEL, KIND_LABEL, PRUNE_NOTE, formatBytes, type InventorySummary, type WorktreeItem, type WorktreeScan, type WorktreeVerdict } from '@omni/shared/worktree-inventory.ts';
import {
  CLEANUP_BECAUSE_LABEL,
  CLEANUP_NOTE,
  type CleanupCandidate,
  type CleanupOutcome,
  type CleanupResult,
  type CleanupRun,
  type CleanupState,
  type RetentionPolicy,
} from '@omni/shared/worktree-cleanup.ts';
import { SLIM_DAYS, SLIM_NOTE, type SlimCandidate, type SlimOutcome, type SlimPolicy, type SlimResult, type SlimRun, type SlimState } from '@omni/shared/worktree-slim.ts';
import { relTime } from '@omni/shared/format.ts';
import { api, errorText, useApi } from '../api.ts';
import { Button, Chip, ConfirmDialog, ErrorNote, Loading, Picker, StatusDot } from '../components/ui.tsx';
import { plural } from '../format.ts';
import { href } from '../router.ts';
import { Card, Origin, SettingRow, SwitchRow } from './settings-parts.tsx';

// Settings, Worktrees: the worktrees Omni made in data/worktrees, what each uses on disk, why each must stay or may
// go, and the cleanups: removing the ones that may go and stripping the build output from idle ones, reviewed here
// or run daily by this machine's Automatic cleanup, one card with a labelled threshold for each. The scan, a cleanup
// and a strip run on the server; this section starts them and polls while any runs.

interface Inventory {
  scan: WorktreeScan | null;
  summary: InventorySummary | null;
  cleanup: CleanupState;
  slim: SlimState;
}

const OUTCOME_DOT: Record<CleanupOutcome, string> = { removed: 'done', kept: 'idle', failed: 'needs' };
const SLIM_DOT: Record<SlimOutcome, string> = { slimmed: 'done', skipped: 'idle', failed: 'needs' };
const SLIM_LABEL: Record<SlimOutcome, string> = { slimmed: 'Stripped', skipped: 'Skipped', failed: 'Failed' };
const DAY_CHOICES = [3, 7, 14, 30, 60, 90];

const DOT: Record<WorktreeVerdict, string> = { eligible: 'done', kept: 'idle', unknown: 'needs' };
const GROUPS: { verdict: WorktreeVerdict; title: string; note: string }[] = [
  { verdict: 'eligible', title: 'Eligible for cleanup', note: 'Nothing in these can be lost, and their threads are done with them.' },
  { verdict: 'kept', title: 'Kept', note: 'Each has at least one reason to stay.' },
  { verdict: 'unknown', title: 'Unknown', note: 'A check failed, so nothing is claimed. Scan again.' },
];

export function StorageSection() {
  const res = useApi<Inventory>('/worktrees/scan');
  const { reload } = res;
  const cleaning = !!res.data && [...Object.values(res.data.cleanup.runs), ...Object.values(res.data.slim.runs)].some((r) => r?.state === 'running');
  const running = res.data?.scan?.state === 'running' || cleaning;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(reload, 1000);
    return () => clearInterval(t);
  }, [running, reload]);

  const scan = res.data?.scan ?? null;
  if (res.error) return <ErrorNote onRetry={reload}>{res.error}</ErrorNote>;
  if (!res.data) return <Loading />;
  return (
    <>
      <ScanCard scan={scan} summary={res.data.summary} cleaning={cleaning} onChange={reload} />
      <CleanupCard cleanup={res.data.cleanup} scan={scan} onChange={reload} />
      <SlimCard slim={res.data.slim} scan={scan} onChange={reload} />
      <AutoCleanupCard cleanup={res.data.cleanup} slim={res.data.slim} scanning={scan?.state === 'running'} onChange={reload} />
      {scan && <Items scan={scan} />}
    </>
  );
}

function ScanCard({ scan, summary, cleaning, onChange }: { scan: WorktreeScan | null; summary: InventorySummary | null; cleaning: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = scan?.state === 'running';

  const act = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(path);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      onChange();
    }
  };

  const pct = scan && scan.total ? Math.round((scan.done / scan.total) * 100) : 0;
  return (
    <Card
      entry="worktree-storage"
      title="On disk"
      subtitle={
        <span role="status">
          {!scan && 'A scan measures each folder in data/worktrees and checks its git state. It takes a minute or two and does not slow running threads.'}
          {running && (scan!.phase === 'listing' ? 'Finding the folders' : `Checking ${scan!.done} of ${scan!.total}`)}
          {scan?.state === 'done' && `Scanned ${scan.finishedAt ? relTime(scan.finishedAt) : ''}.`}
          {scan?.state === 'cancelled' && `Cancelled after ${scan.done} of ${scan.total}. What was checked is below.`}
          {scan?.state === 'failed' && `The scan failed: ${scan.error ?? 'unknown error'}`}
        </span>
      }
      actions={
        running ? (
          <Button size="sm" icon="stop" busy={busy} onClick={() => act('/worktrees/scan/cancel')}>
            Cancel
          </Button>
        ) : (
          <Button variant={scan ? 'secondary' : 'primary'} size="sm" icon="refresh" busy={busy} disabled={cleaning} onClick={() => act('/worktrees/scan')}>
            {scan ? 'Scan again' : 'Scan'}
          </Button>
        )
      }
    >
      {running && <Progress pct={pct} />}
      {scan && summary && <Summary summary={summary} />}
      {error && <ErrorNote>{error}</ErrorNote>}
    </Card>
  );
}

function Progress({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="h-full rounded-full bg-fg transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Review what the last scan found eligible, then remove it. The server checks each again right before it goes. */
function CleanupCard({ cleanup, scan, onChange }: { cleanup: CleanupState; scan: WorktreeScan | null; onChange: () => void }) {
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = cleanup.runs.manual;
  const running = run?.state === 'running';
  const preview = cleanup.preview?.manual ?? null;
  const n = preview?.candidates.length ?? 0;

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/worktrees/cleanup', { ids: preview!.candidates.map((c) => c.id) });
      setReviewing(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      onChange();
    }
  };

  const note = running
    ? `Removing ${run.done} of ${run.total}. Each is checked again right before it goes.`
    : !scan
      ? 'Scan to see what can be removed.'
      : scan.state === 'running'
        ? 'Shown once the scan is done.'
        : n
          ? `${plural(n, 'worktree')} (${formatBytes(preview!.bytes)}) can be removed now. Each is checked again right before it goes.`
          : 'Nothing to clean up.';
  return (
    <Card
      title="Clean up now"
      subtitle={<span role="status">{note}</span>}
      actions={
        !running &&
        n > 0 && (
          <Button size="sm" variant="danger" icon="trash" onClick={() => (setError(null), setReviewing(true))}>
            Review and remove
          </Button>
        )
      }
    >
      {!running && n > 0 && <p className="text-[12.5px] text-fg-3">{CLEANUP_NOTE}</p>}
      {running && <Progress pct={run.total ? Math.round((run.done / run.total) * 100) : 0} />}
      {run && !running && <RunResult run={run} />}
      <ConfirmDialog
        open={reviewing}
        title={`Remove ${plural(n, 'worktree')}?`}
        confirmLabel={`Remove ${plural(n, 'worktree')}`}
        danger
        busy={busy}
        error={error}
        onConfirm={remove}
        onCancel={() => setReviewing(false)}
      >
        <p>{CLEANUP_NOTE}</p>
        <ul className="scroll-thin max-h-[45vh] divide-y divide-[var(--line)] overflow-y-auto rounded-[16px] bg-surface">
          {preview?.candidates.map((c) => <CandidateRow key={c.id} c={c} />)}
        </ul>
        <p className="text-[12.5px] text-fg-3">
          Frees about <span className="font-num">{formatBytes(preview?.bytes ?? 0)}</span>. One that changed since the scan is kept, with the reason.
        </p>
      </ConfirmDialog>
    </Card>
  );
}

function CandidateRow({ c }: { c: CleanupCandidate }) {
  const place = [c.channelName, c.branch].filter(Boolean).join(' · ');
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-fg">{c.threadTitle ?? c.id}</div>
        {place && <div className="truncate text-[12px] text-fg-3">{place}</div>}
        <div className="text-[12px] text-fg-2">{CLEANUP_BECAUSE_LABEL[c.because]}.</div>
      </div>
      <span className="font-num shrink-0 text-[12.5px] text-fg-2">{formatBytes(c.bytes)}</span>
    </li>
  );
}

/** What a run did: one line of totals, then each worktree with its outcome and why. */
function RunResult({ run }: { run: CleanupRun }) {
  const count = (o: CleanupOutcome) => run.items.filter((i) => i.outcome === o).length;
  const when = relTime(run.finishedAt ?? run.startedAt);
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-fg-2">
        {run.trigger === 'manual' ? 'Last cleanup' : 'Last pass'} {when}: removed {count('removed')} (<span className="font-num">{formatBytes(run.freedBytes)}</span> freed), kept{' '}
        {count('kept')}, failed {count('failed')}.{run.error && ` It stopped: ${run.error}`}
      </p>
      {run.items.length > 0 && (
        <ul className="divide-y divide-[var(--line)] rounded-[20px] bg-surface">
          {run.items.map((r) => (
            <ResultRow key={r.id} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultRow({ r }: { r: CleanupResult }) {
  const title = r.threadTitle ?? r.id;
  const place = [r.channelName, r.branch].filter(Boolean).join(' · ');
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <StatusDot status={OUTCOME_DOT[r.outcome]} size={8} className="mt-[6px]" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {r.threadId ? (
            <a href={href.thread(r.threadId)} className="min-w-0 truncate text-[13.5px] font-medium underline-offset-2 hover:underline">
              {title}
            </a>
          ) : (
            <span className="min-w-0 truncate text-[13.5px] font-medium">{title}</span>
          )}
          <Chip tone={r.outcome === 'removed' ? 'done' : r.outcome === 'failed' ? 'needs' : 'outline'}>{r.outcome === 'removed' ? 'Removed' : r.outcome === 'kept' ? 'Kept' : 'Failed'}</Chip>
        </div>
        {place && <div className="mt-0.5 truncate text-[12px] text-fg-3">{place}</div>}
        <ul className="mt-1.5 space-y-0.5 text-[12.5px] leading-snug break-words text-fg-2">
          {r.outcome === 'removed' && <li>{CLEANUP_BECAUSE_LABEL[r.because]}. Its branch stays.</li>}
          {r.reasons.map((x) => (
            <li key={x.code + x.message}>{x.message}</li>
          ))}
          {r.errors.map((e) => (
            <li key={e} className={r.outcome === 'failed' ? 'text-needs' : 'text-fg-3'}>
              {r.outcome === 'failed' ? e : `Could not check: ${e}`}
            </li>
          ))}
        </ul>
      </div>
      <span className="font-num shrink-0 text-[12.5px] text-fg-2">{formatBytes(r.bytes)}</span>
    </li>
  );
}

/** Strip caches now: review the idle worktrees with build output in them and delete it. The worktrees stay. */
function SlimCard({ slim, scan, onChange }: { slim: SlimState; scan: WorktreeScan | null; onChange: () => void }) {
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { policy } = slim;
  const manual = slim.runs.manual;
  const going = [manual, slim.runs.scheduled].find((r) => r?.state === 'running') ?? null;
  const last = [manual, slim.runs.scheduled].filter((r): r is SlimRun => !!r && r.state !== 'running').sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))[0];
  const preview = slim.preview;
  const n = preview?.candidates.length ?? 0;

  const strip = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/worktrees/slim', { ids: preview!.candidates.map((c) => c.id) });
      setReviewing(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      onChange();
    }
  };

  const note = going
    ? `Stripping ${going.done} of ${going.total}. Each is checked again right before.`
    : !scan
      ? 'Scan to see what caches the idle worktrees hold.'
      : scan.state === 'running'
        ? 'Shown once the scan is done.'
        : n
          ? `${plural(n, 'worktree')} idle at least ${plural(policy.idleDays, 'day')} ${n === 1 ? 'holds' : 'hold'} ${formatBytes(preview!.bytes)} of caches.`
          : `No worktree idle at least ${plural(policy.idleDays, 'day')} holds caches.`;
  return (
    <Card
      entry="worktree-slim"
      title="Strip caches now"
      subtitle={<span role="status">{note}</span>}
      actions={
        !going &&
        n > 0 && (
          <Button size="sm" variant="danger" icon="trash" onClick={() => (setError(null), setReviewing(true))}>
            Review and strip
          </Button>
        )
      }
    >
      {!going && n > 0 && <p className="text-[12.5px] text-fg-3">{SLIM_NOTE} A worktree in use (a turn, a terminal, an action) is skipped.</p>}
      {going && <Progress pct={going.total ? Math.round((going.done / going.total) * 100) : 0} />}
      {last && <SlimRunResult run={last} />}
      {error && !reviewing && <ErrorNote>{error}</ErrorNote>}
      <ConfirmDialog
        open={reviewing}
        title={`Strip caches from ${plural(n, 'worktree')}?`}
        confirmLabel={`Strip ${formatBytes(preview?.bytes ?? 0)}`}
        danger
        busy={busy}
        error={error}
        onConfirm={strip}
        onCancel={() => setReviewing(false)}
      >
        <p>{SLIM_NOTE}</p>
        <ul className="scroll-thin max-h-[45vh] divide-y divide-[var(--line)] overflow-y-auto rounded-[16px] bg-surface">
          {preview?.candidates.map((c) => <SlimRow key={c.id} c={c} />)}
        </ul>
      </ConfirmDialog>
    </Card>
  );
}

function SlimRow({ c }: { c: SlimCandidate }) {
  const place = [c.channelName, c.branch].filter(Boolean).join(' · ');
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-fg">{c.threadTitle ?? c.id}</div>
        {place && <div className="truncate text-[12px] text-fg-3">{place}</div>}
        <div className="text-[12px] text-fg-2">{c.lastActiveAt ? `Last active ${relTime(c.lastActiveAt)}.` : 'Its thread was deleted.'}</div>
      </div>
      <span className="font-num shrink-0 text-[12.5px] text-fg-2">{formatBytes(c.bytes)}</span>
    </li>
  );
}

/** What a strip did: one line of totals, then each worktree that was skipped or failed, with why. */
function SlimRunResult({ run }: { run: SlimRun }) {
  const count = (o: SlimOutcome) => run.items.filter((i) => i.outcome === o).length;
  const notable = run.items.filter((i) => i.outcome !== 'slimmed');
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-fg-2">
        {run.trigger === 'manual' ? 'Last strip' : 'Last daily strip'} {relTime(run.finishedAt ?? run.startedAt)}: stripped {count('slimmed')} (
        <span className="font-num">{formatBytes(run.freedBytes)}</span> freed), skipped {count('skipped')}, failed {count('failed')}.{run.error && ` It stopped: ${run.error}`}
      </p>
      {notable.length > 0 && (
        <ul className="divide-y divide-[var(--line)] rounded-[20px] bg-surface">
          {notable.map((r) => (
            <SlimResultRow key={r.id} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SlimResultRow({ r }: { r: SlimResult }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <StatusDot status={SLIM_DOT[r.outcome]} size={8} className="mt-[6px]" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-[13.5px] font-medium">{r.threadTitle ?? r.id}</span>
          <Chip tone={r.outcome === 'failed' ? 'needs' : 'outline'}>{SLIM_LABEL[r.outcome]}</Chip>
        </div>
        <ul className="mt-1.5 space-y-0.5 text-[12.5px] leading-snug break-words text-fg-2">
          {r.reasons.map((x) => (
            <li key={x.code + x.message}>{x.message}</li>
          ))}
          {r.errors.map((e) => (
            <li key={e} className={r.outcome === 'failed' ? 'text-needs' : 'text-fg-3'}>
              {e}
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

const dayOptions = (current: number, min = 1, max = Infinity) =>
  (DAY_CHOICES.includes(current) ? DAY_CHOICES : [...DAY_CHOICES, current].sort((a, b) => a - b))
    .filter((d) => d >= min && d <= max)
    .map((d) => ({ value: String(d), label: `${plural(d, 'day')} idle`, avatar: false as const }));

/**
 * This machine's automatic cleanup, off by default: one daily pass strips caches from idle worktrees, another removes
 * the worktrees that may go. Each has its own threshold, named for what it does. Not synced.
 */
function AutoCleanupCard({ cleanup, slim, scanning, onChange }: { cleanup: CleanupState; slim: SlimState; scanning: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retention = cleanup.policy;
  const run = cleanup.runs.retention;
  const p = cleanup.preview?.retention ?? null;
  const n = p?.candidates.length ?? 0;

  const save = async (path: string, patch: Partial<RetentionPolicy> | Partial<SlimPolicy>) => {
    setBusy(true);
    setError(null);
    try {
      await api.put(path, patch);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      onChange();
    }
  };

  const what = n ? `remove ${plural(n, 'worktree')} and free ${formatBytes(p!.bytes)}` : 'remove nothing';
  const line = scanning ? 'Shown once the scan is done.' : !p ? 'Scan to see what it would remove.' : retention.enabled ? `The next pass would ${what}.` : `If turned on, the next pass would ${what}.`;
  const names = p?.candidates.slice(0, 5).map((c) => c.threadTitle ?? c.id) ?? [];
  const here = <Origin of="machine" />;
  return (
    <Card entry="worktree-retention" title="Automatic cleanup" subtitle="Daily, on this machine only. Idle means no turn or message in the thread, open threads included.">
      <SwitchRow
        title="Strip caches"
        origin={here}
        detail={`${SLIM_NOTE} A worktree in use (a turn, a terminal, an action) is skipped.`}
        checked={slim.policy.enabled}
        onChange={(on) => void save('/worktrees/slim', { enabled: on })}
        disabled={busy}
      />
      <SettingRow
        label="Strip caches after"
        control={
          <Picker
            label="Strip caches after"
            size="field"
            className="w-40"
            value={String(slim.policy.idleDays)}
            options={dayOptions(slim.policy.idleDays, SLIM_DAYS.min, SLIM_DAYS.max)}
            onChange={(v) => void save('/worktrees/slim', { idleDays: Number(v) })}
            disabled={busy}
          />
        }
      />
      <div className="border-t border-line" />
      <SwitchRow
        title="Remove worktrees"
        origin={here}
        detail="Covers archived, merged or deleted threads with nothing unsaved. Runs a minute after Omni starts, then daily."
        checked={retention.enabled}
        onChange={(on) => void save('/worktrees/retention', { enabled: on })}
        disabled={busy}
      />
      <SettingRow
        label="Remove worktrees after"
        hint={
          <span role="status">
            {line}
            {names.length > 0 && ` ${names.join(', ')}${n > names.length ? `, and ${n - names.length} more` : ''}.`}
          </span>
        }
        control={
          <Picker
            label="Remove worktrees after"
            size="field"
            className="w-40"
            value={String(retention.idleDays)}
            options={dayOptions(retention.idleDays)}
            onChange={(v) => void save('/worktrees/retention', { idleDays: Number(v) })}
            disabled={busy}
          />
        }
      />
      {run?.state === 'running' && <Progress pct={run.total ? Math.round((run.done / run.total) * 100) : 0} />}
      {run && run.state !== 'running' && <RunResult run={run} />}
      {error && <ErrorNote>{error}</ErrorNote>}
    </Card>
  );
}

function Summary({ summary }: { summary: InventorySummary }) {
  const tiles = [
    { label: 'Can be removed', dot: 'done', t: summary.eligible },
    { label: 'Kept', dot: 'idle', t: summary.kept },
    { label: 'Could not check', dot: 'needs', t: summary.unknown },
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {tiles.map(({ label, dot, t }) => (
          <div key={label} className="rounded-[16px] bg-bg p-3.5">
            <div className="flex items-center gap-1.5 text-[12px] text-fg-3">
              <StatusDot status={dot} size={7} /> {label}
            </div>
            <div className="font-num mt-1 font-display text-[22px] leading-none">{t.count}</div>
            <div className="font-num mt-1 text-[12px] text-fg-3">{formatBytes(t.bytes)}</div>
          </div>
        ))}
      </div>
      <p className="text-[12.5px] text-fg-3">
        {plural(summary.folders, 'folder')} in data/worktrees use <span className="font-num">{formatBytes(summary.bytes)}</span>.{' '}
        {summary.stale > 0 && `${plural(summary.stale, 'stale registration')} ${summary.stale === 1 ? 'uses' : 'use'} no space.`} {PRUNE_NOTE}
      </p>
    </div>
  );
}

function Items({ scan }: { scan: WorktreeScan }) {
  const folders = scan.items.filter((i) => i.kind !== 'stale-registration');
  const stale = scan.items.filter((i) => i.kind === 'stale-registration');
  if (!scan.items.length) return scan.state === 'running' ? null : <p className="px-1 text-[13px] text-fg-3">No worktrees found in data/worktrees.</p>;
  return (
    <>
      {GROUPS.map((g) => {
        const rows = folders.filter((i) => i.verdict === g.verdict);
        return rows.length ? <Group key={g.verdict} title={g.title} note={g.note} rows={rows} /> : null;
      })}
      {stale.length > 0 && (
        <Group
          title="Stale registrations"
          note="Git lists these worktrees, but their folders are already gone. Pruning drops the entry and frees no space."
          rows={stale}
        />
      )}
    </>
  );
}

function Group({ title, note, rows }: { title: string; note: string; rows: WorktreeItem[] }) {
  return (
    <section>
      <h2 className="flex items-baseline gap-2 px-1 font-display text-[15px]">
        {title} <span className="font-num text-[12.5px] font-normal text-fg-3">{rows.length}</span>
      </h2>
      <p className="mt-0.5 mb-2 px-1 text-[12.5px] text-fg-3">{note}</p>
      <ul className="divide-y divide-[var(--line)] rounded-[20px] bg-surface">
        {rows.map((it) => (
          <ItemRow key={`${it.kind}:${it.id}`} it={it} />
        ))}
      </ul>
    </section>
  );
}

function ItemRow({ it }: { it: WorktreeItem }) {
  const title = it.threadTitle ?? it.id;
  const place = [it.channelName, it.branch].filter(Boolean).join(' · ');
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <StatusDot status={DOT[it.verdict]} size={8} className="mt-[6px]" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {it.threadId ? (
            <a href={href.thread(it.threadId)} className="min-w-0 truncate text-[13.5px] font-medium underline-offset-2 hover:underline">
              {title}
            </a>
          ) : (
            <span className="min-w-0 truncate text-[13.5px] font-medium">{title}</span>
          )}
          {it.kind !== 'managed' && <Chip tone="outline">{KIND_LABEL[it.kind]}</Chip>}
        </div>
        {place && <div className="mt-0.5 truncate text-[12px] text-fg-3">{place}</div>}
        <ul className="mt-1.5 space-y-0.5 text-[12.5px] leading-snug break-words text-fg-2">
          {it.verdict === 'eligible' && it.eligibleBecause && <li>{ELIGIBLE_LABEL[it.eligibleBecause]}.</li>}
          {!!it.cacheBytes && it.cacheBytes >= 1024 ** 2 && <li className="text-fg-3">{formatBytes(it.cacheBytes)} of it is build output and installs.</li>}
          {it.reasons.map((r) => (
            <li key={r.code + r.message}>{r.message}</li>
          ))}
          {it.errors.map((e) => (
            <li key={e} className="text-fg-3">
              Could not check: {e}
            </li>
          ))}
        </ul>
      </div>
      <span className="font-num shrink-0 text-[12.5px] text-fg-2">{it.kind === 'stale-registration' ? 'no folder' : formatBytes(it.bytes)}</span>
    </li>
  );
}
