import { useState } from 'react';
import { type HarnessId, type MonthlyUsage, type Usage, type UsageWindow } from '../../api.ts';
import { monthlyTitle, untilLabel, windowPct } from '../../format.ts';
import { readPref, useApp, useNow, writePref } from '../../store.tsx';
import { HARNESS_ROWS, HarnessLogo, SLOT_ROWS } from '../brand.tsx';
import { Icon, Ticks } from '../ui.tsx';

/** One window's tick bar and percentage, with the reset time on hover. */
function WindowCell({ w, label }: { w?: UsageWindow; label: string }) {
  const pct = windowPct(w);
  if (pct === null) return <span className="flex-1 text-center font-num text-[10px] text-fg-4">—</span>;
  const tone = pct >= 0.9 ? 'needs' : undefined;
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1.5"
      title={`${label}: ${Math.round(pct * 100)}% used, resets ${new Date(w!.resetsAt * 1000).toLocaleString('en-GB')} (${untilLabel(w!.resetsAt)})`}
    >
      <Ticks responsive value={pct} count={10} height={10} tone={tone} className="min-w-0 flex-1" label={`${label} usage`} />
      <span className="w-[26px] shrink-0 text-right font-num text-[10px] text-fg-2 tabular-nums">{Math.round(pct * 100)}%</span>
    </div>
  );
}

/** A monthly cycle across both columns: one tick bar, the percent, and "mo". */
function MonthCell({ m, name }: { m: MonthlyUsage; name: string }) {
  const pct = windowPct(m)!;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5" title={monthlyTitle(name, m)}>
      <Ticks responsive value={pct} count={20} height={10} tone={pct >= 0.9 ? 'needs' : undefined} className="min-w-0 flex-1" label={`${name} month usage`} />
      <span className="w-[26px] shrink-0 text-right font-num text-[10px] text-fg-2 tabular-nums">{Math.round(pct * 100)}%</span>
      <span className="text-[10px] text-fg-4">mo</span>
    </div>
  );
}

/** One plan's row: the 5-hour and weekly windows, a monthly cycle (Cursor), or "no data" for a harness that reports none. */
function HarnessUsageRow({ id, name, usage }: { id: HarnessId; name: string; usage?: Usage | null }) {
  useNow(60_000);
  const windows = !!usage && (!!usage.five_hour || !!usage.seven_day);
  const noData = !windows && !usage?.monthly;
  return (
    <div className="flex items-center gap-2">
      <span className="caption inline-flex w-[66px] shrink-0 items-center gap-1.5 text-fg-2">
        <span className="text-fg"><HarnessLogo harness={id} size={12} /></span>
        {name}
      </span>
      {noData ? (
        <span className="flex-1 text-[10.5px] text-fg-4">no data</span>
      ) : !windows ? (
        <MonthCell m={usage!.monthly!} name={name} />
      ) : (
        <>
          <WindowCell w={usage!.five_hour} label={`${name} 5h`} />
          <WindowCell w={usage!.seven_day} label={`${name} week`} />
        </>
      )}
    </div>
  );
}

/** Plan usage per harness. Collapsed by default to one row with the live dot and the busiest window; click to open. */
export function UsageCard() {
  const { usage, status, feedLive } = useApp();
  const [open, setOpen] = useState(() => readPref('usage.open', false));
  const toggle = () => setOpen((o) => { writePref('usage.open', !o); return !o; });
  const slots = status?.slots ?? {};
  const footer = SLOT_ROWS.filter((r) => slots[r.id]).map((r) => `${r.name} ${slots[r.id]!.running}/${slots[r.id]!.cap}`).join(' · ');
  const peak = HARNESS_ROWS.reduce<number | null>((max, r) => {
    const u = usage[r.id];
    for (const p of [windowPct(u?.five_hour), windowPct(u?.seven_day), windowPct(u?.monthly)]) if (p !== null && (max === null || p > max)) max = p;
    return max;
  }, null);
  return (
    <div className="rounded-[20px] bg-bg/70 shadow-[var(--shadow-card)]">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-[20px] px-3 py-2.5 text-[11px] text-fg-3 hover:text-fg"
      >
        <span className="relative inline-block h-1.5 w-1.5 shrink-0" title={feedLive ? 'Live' : 'Reconnecting'}>
          {feedLive && <span className="ping absolute inset-0 rounded-full bg-done" />}
          <span className={`absolute inset-0 rounded-full ${feedLive ? 'bg-done' : 'bg-fg-4'}`} />
        </span>
        <span className="font-medium text-fg-2">Usage</span>
        <span className="min-w-0 flex-1 truncate text-left font-num tabular-nums">
          {open ? '' : footer || (feedLive ? 'Connected' : 'Connecting')}
        </span>
        {peak !== null && !open && (
          <span className={`font-num text-[10px] tabular-nums ${peak >= 0.9 ? 'text-needs' : 'text-fg-2'}`} title="Highest window across plans">
            {Math.round(peak * 100)}%
          </span>
        )}
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} className="shrink-0 text-fg-4" />
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          <div className="flex items-center gap-2 pb-0.5 text-[11px] font-medium text-fg-4">
            <span className="w-[66px] shrink-0" />
            <span className="flex-1">5h</span>
            <span className="flex-1">Week</span>
          </div>
          {HARNESS_ROWS.map((r) => (
            <HarnessUsageRow key={r.id} id={r.id} name={r.name} usage={usage[r.id]} />
          ))}
          <div className="flex items-center gap-2 border-t border-line pt-2.5 text-[11px] text-fg-3">
            {footer ? (
              <span className="font-num tabular-nums">{footer}</span>
            ) : (
              <span>{feedLive ? 'Connected' : 'Connecting'}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
