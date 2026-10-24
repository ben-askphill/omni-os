import { useEffect, useState } from 'react';
import { ELIGIBLE_LABEL, KIND_LABEL, PRUNE_NOTE, formatBytes, type InventorySummary, type WorktreeItem, type WorktreeScan, type WorktreeVerdict } from '@omni/shared/worktree-inventory.ts';
import { api, errorText, useApi } from '../api.ts';
import { Button, Chip, ErrorNote, Icon, Loading, PageHeader, StatusDot } from '../components/ui.tsx';
import { plural, relTime } from '../format.ts';
import { href } from '../router.ts';

// Settings, Storage: the worktrees Omni made in data/worktrees, what each uses on disk, and why each must stay or may
// go. Read-only: nothing here deletes. The scan runs on the server; this page starts it, polls it and can cancel it.
// The Mac app's Storage tab (apps/mac/Omni/StorageSettingsView.swift) shows the same.

interface Inventory {
  scan: WorktreeScan | null;
  summary: InventorySummary | null;
}

const DOT: Record<WorktreeVerdict, string> = { eligible: 'done', kept: 'idle', unknown: 'needs' };
const GROUPS: { verdict: WorktreeVerdict; title: string; note: string }[] = [
  { verdict: 'eligible', title: 'Eligible for cleanup', note: 'Nothing in these can be lost, and their threads are done with them.' },
  { verdict: 'kept', title: 'Kept', note: 'Each has at least one reason to stay.' },
  { verdict: 'unknown', title: 'Unknown', note: 'A check failed, so nothing is claimed. Scan again.' },
];

export function StoragePage() {
  const res = useApi<Inventory>('/worktrees/scan');
  const { reload } = res;
  const running = res.data?.scan?.state === 'running';

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
            This is a read-only inventory of <code>data/worktrees</code>. Nothing is deleted from here. {PRUNE_NOTE}
          </div>
        </div>

        {res.error ? (
          <ErrorNote onRetry={reload}>{res.error}</ErrorNote>
        ) : !res.data ? (
          <Loading />
        ) : (
          <>
            <ScanCard scan={scan} onChange={reload} />
            {scan && res.data.summary && <Summary summary={res.data.summary} />}
            {scan && <Items scan={scan} />}
          </>
        )}
      </div>
    </div>
  );
}

function ScanCard({ scan, onChange }: { scan: WorktreeScan | null; onChange: () => void }) {
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
    <section className="space-y-3 rounded-[24px] p-5 shadow-[inset_0_0_0_1px_var(--line)]">
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
          <Button variant="primary" size="sm" icon="refresh" busy={busy} onClick={() => act('/worktrees/scan')}>
            {scan ? 'Scan again' : 'Scan'}
          </Button>
        )}
      </div>
      {running && (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-full rounded-full bg-fg transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}
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
