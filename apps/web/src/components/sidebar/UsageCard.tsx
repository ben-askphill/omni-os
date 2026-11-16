import { useMemo, useState } from 'react';
import { accountUsageKey, usageRows, type AccountUsage, type UsageRow } from '@omni/shared/account-usage.ts';
import { type MonthlyUsage, type UsageWindow } from '../../api.ts';
import { useAccounts } from '../../accounts.ts';
import { monthlyTitle, untilLabel, windowPct } from '../../format.ts';
import { readPref, useApp, useFeed, useNow, writePref } from '../../store.tsx';
import { HARNESS_ROWS, HarnessLogo, SLOT_ROWS } from '../brand.tsx';
import { Icon, Ticks } from '../ui.tsx';

const HARNESS_IDS = HARNESS_ROWS.map((r) => r.id);
const NAMES: Record<string, string> = Object.fromEntries(HARNESS_ROWS.map((r) => [r.id, r.name]));

/** One window's tick bar and percentage, with the reset time on hover. */
function WindowCell({ w, label }: { w?: UsageWindow; label: string }) {
  const pct = windowPct(w);
  if (pct === null) return <span className="flex-1 text-center font-num text-[10px] text-fg-3">—</span>;
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
      <span className="text-[10px] text-fg-3">mo</span>
    </div>
  );
}

/** Who a row's account is, in full: "ben@askphill.com · Max · Acme, on omarchy and Ben's MacBook Air". */
function accountTitle(a: NonNullable<UsageRow['account']>): string {
  const machines = a.machines.length ? `, on ${a.machines.join(' and ')}` : '';
  return `${[a.label, a.plan, a.org && !a.org.toLowerCase().includes(a.label.toLowerCase()) ? a.org : null].filter(Boolean).join(' · ')}${machines}`;
}

/**
 * One account's row: the 5-hour and weekly windows, a monthly cycle (Cursor), or "no data" when that account has no
 * reading of its own. A harness with several accounts names each under its row; one with a single account keeps the
 * plain row, with the account on hover.
 */
function UsageRowView({ row }: { row: UsageRow }) {
  useNow(60_000);
  const name = NAMES[row.harness] ?? row.harness;
  const usage = row.usage;
  const windows = !!usage && (!!usage.five_hour || !!usage.seven_day);
  const noData = !windows && !usage?.monthly;
  const who = row.account && accountTitle(row.account);
  // Several accounts on one harness: each bar's tooltip names the account it belongs to.
  const label = row.several && row.account ? `${name} (${row.account.label})` : name;
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="caption inline-flex w-[66px] shrink-0 items-center gap-1.5 text-fg-2" title={who ?? undefined}>
          <span className="text-fg"><HarnessLogo harness={row.harness} size={12} /></span>
          {name}
        </span>
        {noData ? (
          <span className="flex-1 text-[10.5px] text-fg-3">no data</span>
        ) : !windows ? (
          <MonthCell m={usage!.monthly! as MonthlyUsage} name={label} />
        ) : (
          <>
            <WindowCell w={usage!.five_hour} label={`${label} 5h`} />
            <WindowCell w={usage!.seven_day} label={`${label} week`} />
          </>
        )}
      </div>
      {row.several && row.account && (
        <div className="flex min-w-0 items-center gap-1 pl-[18px] pt-0.5 text-[10px] leading-tight text-fg-3" title={who ?? undefined} data-testid="usage-account">
          <span className="min-w-0 truncate">{row.account.label}</span>
          {row.account.plan && <span className="shrink-0">· {row.account.plan}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * The card's rows: one per signed-in account (GET /api/accounts), each with its own reading. Readings that come in on
 * the feed replace the listed one for that account until the list loads again.
 */
function useUsageRows(): UsageRow[] {
  const { usage } = useApp();
  const accounts = useAccounts();
  const [live, setLive] = useState<Record<string, AccountUsage>>({});
  useFeed((e) => {
    if (e.type === 'account_usage') setLive((prev) => ({ ...prev, [accountUsageKey(e.usage)]: e.usage }));
  });
  const view = accounts.data;
  return useMemo(() => usageRows(HARNESS_IDS, view, [...(view?.usage ?? []), ...Object.values(live)], usage), [view, live, usage]);
}

/** Plan usage per harness. Collapsed by default to one row with the live dot and the busiest window; click to open. */
export function UsageCard() {
  const { status, feedLive } = useApp();
  const rows = useUsageRows();
  const [open, setOpen] = useState(() => readPref('usage.open', false));
  const toggle = () => setOpen((o) => { writePref('usage.open', !o); return !o; });
  const slots = status?.slots ?? {};
  const footer = SLOT_ROWS.filter((r) => slots[r.id]).map((r) => `${r.name} ${slots[r.id]!.running}/${slots[r.id]!.cap}`).join(' · ');
  const peak = rows.reduce<number | null>((max, r) => {
    const u = r.usage;
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
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} className="shrink-0 text-fg-3" />
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          <div className="flex items-center gap-2 pb-0.5 text-[11px] font-medium text-fg-3">
            <span className="w-[66px] shrink-0" />
            <span className="flex-1">5h</span>
            <span className="flex-1">Week</span>
          </div>
          {rows.map((r) => (
            <UsageRowView key={r.key} row={r} />
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
