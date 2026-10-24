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
import { api, errorText, useApi } from '../api.ts';
import { Button, Chip, ConfirmDialog, ErrorNote, Icon, Loading, PageHeader, Picker, StatusDot, Toggle } from '../components/ui.tsx';
import { plural, relTime } from '../format.ts';
import { href } from '../router.ts';

// Settings, Storage: the worktrees Omni made in data/worktrees, what each uses on disk, why each must stay or may go,
// and the cleanup that removes the ones that may: reviewed here, or on a schedule with this Mac's retention policy.
// The scan and a cleanup run on the server; this page starts them and polls while either runs.
// The Mac app's Storage tab (apps/mac/Omni/StorageSettingsView.swift) shows the same.

interface Inventory {
  scan: WorktreeScan | null;
  summary: InventorySummary | null;
  cleanup: CleanupState;
}

const OUTCOME_DOT: Record<CleanupOutcome, string> = { removed: 'done', kept: 'idle', failed: 'needs' };
const DAY_CHOICES = [3, 7, 14, 30, 60, 90];

const DOT: Record<WorktreeVerdict, string> = { eligible: 'done', kept: 'idle', unknown: 'needs' };
const GROUPS: { verdict: WorktreeVerdict; title: string; note: string }[] = [
  { verdict: 'eligible', title: 'Eligible for cleanup', note: 'Nothing in these can be lost, and their threads are done with them.' },
  { verdict: 'kept', title: 'Kept', note: 'Each has at least one reason to stay.' },
  { verdict: 'unknown', title: 'Unknown', note: 'A check failed, so nothing is claimed. Scan again.' },
];

export function StoragePage() {
  const res = useApi<Inventory>('/worktrees/scan');
  const { reload } = res;
  const cleaning = !!res.data && Object.values(res.data.cleanup.runs).some((r) => r?.state === 'running');
  const running = res.data?.scan?.state === 'running' || cleaning;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(reload, 1000);
    return () => clearInterval(t);
  }, [running, reload]);

  const scan = res.data?.scan ?? null;
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader width="max-w-2xl" title="Storage" subtitle="The worktrees Omni made for threads, what they use, and which are safe to clean up." />
      <div className="mx-auto max-w-2xl space-y-5 px-4 pt-5 pb-16 md:px-8">
        <div className="flex gap-3 rounded-[20px] bg-surface p-4 text-[12.5px] leading-relaxed text-fg-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg text-fg-3">
            <Icon name="archive" size={15} />
          </span>
          <div>
            The worktrees in <code>data/worktrees</code>, and a cleanup for the ones that are safe to remove. {CLEANUP_NOTE} {PRUNE_NOTE}
          </div>
        </div>

        {res.error ? (
          <ErrorNote onRetry={reload}>{res.error}</ErrorNote>
        ) : !res.data ? (
          <Loading />
        ) : (
          <>
            <ScanCard scan={scan} cleaning={cleaning} onChange={reload} />
            <CleanupCard cleanup={res.data.cleanup} scan={scan} onChange={reload} />
            <RetentionCard cleanup={res.data.cleanup} scanning={scan?.state === 'running'} onChange={reload} />
            {scan && res.data.summary && <Summary summary={res.data.summary} />}
            {scan && <Items scan={scan} />}
          </>
        )}
      </div>
    </div>
  );
}

function ScanCard({ scan, cleaning, onChange }: { scan: WorktreeScan | null; cleaning: boolean; onChange: () => void }) {
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
    <section className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[16px]">{running ? 'Scanning' : scan ? 'Last scan' : 'Not scanned yet'}</h2>
          <p className="mt-0.5 text-[12.5px] text-fg-3" role="status">
            {!scan && 'A scan measures each folder and checks its git state. It takes a minute or two and does not slow running threads.'}
            {running && (scan!.phase === 'listing' ? 'Finding the folders' : `Checking ${scan!.done} of ${scan!.total}`)}
            {scan?.state === 'done' && `Scanned ${scan.finishedAt ? relTime(scan.finishedAt) : ''}`}
            {scan?.state === 'cancelled' && `Cancelled after ${scan.done} of ${scan.total}. What was checked is below.`}
            {scan?.state === 'failed' && `The scan failed: ${scan.error ?? 'unknown error'}`}
          </p>
        </div>
        {running ? (
          <Button size="sm" icon="stop" busy={busy} onClick={() => act('/worktrees/scan/cancel')}>
            Cancel
          </Button>
        ) : (
          <Button variant="primary" size="sm" icon="refresh" busy={busy} disabled={cleaning} onClick={() => act('/worktrees/scan')}>
            {scan ? 'Scan again' : 'Scan'}
          </Button>
        )}
      </div>
      {running && <Progress pct={pct} />}
      {error && <ErrorNote>{error}</ErrorNote>}
    </section>
  );
}

function Progress({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="h-full rounded-full bg-fg transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

const CARD = 'space-y-3 rounded-[24px] p-5 shadow-[inset_0_0_0_1px_var(--line)]';

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
    <section className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[16px]">Clean up</h2>
          <p className="mt-0.5 text-[12.5px] text-fg-3" role="status">
            {note}
          </p>
        </div>
        {!running && n > 0 && (
          <Button size="sm" variant="primary" icon="trash" onClick={() => (setError(null), setReviewing(true))}>
            Review
          </Button>
        )}
      </div>
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
    </section>
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

/** This Mac's policy: off by default; on, a pass a minute after startup and daily removes what it covers. */
function RetentionCard({ cleanup, scanning, onChange }: { cleanup: CleanupState; scanning: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { policy } = cleanup;
  const run = cleanup.runs.retention;
  const p = cleanup.preview?.retention ?? null;
  const n = p?.candidates.length ?? 0;

  const save = async (patch: Partial<RetentionPolicy>) => {
    setBusy(true);
    setError(null);
    try {
      await api.put('/worktrees/retention', patch);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      onChange();
    }
  };

  const days = DAY_CHOICES.includes(policy.idleDays) ? DAY_CHOICES : [...DAY_CHOICES, policy.idleDays].sort((a, b) => a - b);
  const what = n ? `remove ${plural(n, 'worktree')} (${formatBytes(p!.bytes)})` : 'remove nothing';
  const line = scanning ? 'Shown once the scan is done.' : !p ? 'Scan to see what it would remove.' : policy.enabled ? `The next pass would ${what}.` : `If turned on, the next pass would ${what}.`;
  const names = p?.candidates.slice(0, 5).map((c) => c.threadTitle ?? c.id) ?? [];
  return (
    <section className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[16px]">Retention on this Mac</h2>
          <p className="mt-0.5 text-[12.5px] text-fg-3">Remove idle worktrees on a schedule.</p>
        </div>
        <Toggle checked={policy.enabled} onChange={(on) => save({ enabled: on })} disabled={busy} label="Remove idle worktrees on a schedule" />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-2">
        After
        <Picker
          label="Days idle"
          value={String(policy.idleDays)}
          options={days.map((d) => ({ value: String(d), label: plural(d, 'day'), avatar: false as const }))}
          onChange={(v) => save({ idleDays: Number(v) })}
          disabled={busy}
        />
        without a turn or message
      </div>
      <p className="text-[12.5px] leading-relaxed text-fg-3">
        Only this Mac: the setting is not synced. It covers worktrees of archived, merged or deleted threads with nothing unsaved, idle at least that long. It runs a
        minute after Omni starts, then daily.
      </p>
      <p className="text-[12.5px] text-fg-2" role="status">
        {line}
        {names.length > 0 && ` ${names.join(', ')}${n > names.length ? `, and ${n - names.length} more` : ''}.`}
      </p>
      {run?.state === 'running' && <Progress pct={run.total ? Math.round((run.done / run.total) * 100) : 0} />}
      {run && run.state !== 'running' && <RunResult run={run} />}
      {error && <ErrorNote>{error}</ErrorNote>}
    </section>
  );
}

function Summary({ summary }: { summary: InventorySummary }) {
  const tiles = [
    { label: 'Eligible', dot: 'done', t: summary.eligible },
    { label: 'Kept', dot: 'idle', t: summary.kept },
    { label: 'Unknown', dot: 'needs', t: summary.unknown },
  ];
  return (
    <section className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {tiles.map(({ label, dot, t }) => (
          <div key={label} className="rounded-[20px] bg-surface p-3.5">
            <div className="flex items-center gap-1.5 text-[12px] text-fg-3">
              <StatusDot status={dot} size={7} /> {label}
            </div>
            <div className="font-num mt-1 font-display text-[22px] leading-none">{t.count}</div>
            <div className="font-num mt-1 text-[12px] text-fg-3">{formatBytes(t.bytes)}</div>
          </div>
        ))}
      </div>
      <p className="px-1 text-[12.5px] text-fg-3">
        {plural(summary.folders, 'folder')} on disk using <span className="font-num">{formatBytes(summary.bytes)}</span>.{' '}
        {summary.stale > 0 && `${plural(summary.stale, 'stale registration')} ${summary.stale === 1 ? 'uses' : 'use'} no space.`}
      </p>
    </section>
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
