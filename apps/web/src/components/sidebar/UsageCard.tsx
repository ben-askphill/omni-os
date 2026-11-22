import { useMemo, useState } from 'react';
import { accountTitle, accountUsageKey, HARNESS_ROWS, peakUsage, planWindows, slotSummary, usageRows, waitingTitle, type AccountUsage, type UsageRow } from '@omni/shared/account-usage.ts';
import { type MonthlyUsage, type UsageWindow } from '../../api.ts';
import { useAccounts } from '../../accounts.ts';
import { resetAt, resetAtShort, resetIn, resetSentence } from '@omni/shared/usage-reset.ts';
import { monthlyTitle, windowPct } from '../../format.ts';
import { readPref, useApp, useFeed, useNow, writePref } from '../../store.tsx';
import { HarnessLogo } from '../brand.tsx';
import { Icon, Ticks } from '../ui.tsx';

const HARNESS_IDS = HARNESS_ROWS.map((r) => r.id);
const NAMES: Record<string, string> = Object.fromEntries(HARNESS_ROWS.map((r) => [r.id, r.name]));

/**
 * When a window resets: "resets in 2h 10m" by its bar, the local time on hover, and a tap swaps the two (touch has no
 * hover). `compact`, for the Usage card's narrow columns: "in 2h 10m", and "at 14:20" or "Fri 09:00" on a tap. Nothing
 * when the source sent no reset time, or once it has passed.
 */
export function ResetTime({ resetsAt, label, compact = false, className = '' }: { resetsAt: number | undefined; label: string; compact?: boolean; className?: string }) {
  const now = useNow(60_000);
  const [local, setLocal] = useState(false);
  const left = resetIn(resetsAt, now);
  const at = resetAt(resetsAt, now);
  if (!left || !at) return null;
  const text = compact ? (local ? resetAtShort(resetsAt, now) : `in ${left}`) : local ? `resets ${at}` : `resets in ${left}`;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setLocal((v) => !v);
      }}
      title={`${label}: ${resetSentence(resetsAt, now)}`}
      aria-label={`${label} resets in ${left}, ${at}`}
      data-testid="usage-reset"
      className={`block max-w-full truncate text-left font-num text-[10px] leading-tight text-fg-3 tabular-nums hover:text-fg-2 ${className}`}
    >
      {text}
    </button>
  );
}

/** What a window's tooltip says: the percent, then the reset when the source gave one. */
function windowTitle(label: string, pct: number, resetsAt: number | undefined, now: number): string {
  const reset = resetSentence(resetsAt, now);
  return `${label}: ${Math.round(pct * 100)}% used.${reset ? ` ${reset}` : ''}`;
}

/** One window's tick bar and percentage, with when it resets under it. */
function WindowCell({ w, label }: { w?: UsageWindow; label: string }) {
  const now = useNow(60_000);
  const pct = windowPct(w);
  if (pct === null) return <span className="flex-1 text-center font-num text-[10px] text-fg-3">—</span>;
  const tone = pct >= 0.9 ? 'needs' : undefined;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-1.5" title={windowTitle(label, pct, w!.resetsAt, now)}>
        <Ticks responsive value={pct} count={10} height={10} tone={tone} className="min-w-0 flex-1" label={`${label} usage`} />
        <span className="w-[26px] shrink-0 text-right font-num text-[10px] text-fg-2 tabular-nums">{Math.round(pct * 100)}%</span>
      </div>
      <ResetTime compact resetsAt={w!.resetsAt} label={label} className="pt-0.5" />
    </div>
  );
}

/** A monthly cycle across both columns: one tick bar, the percent, "mo", and when the cycle resets. */
function MonthCell({ m, name }: { m: MonthlyUsage; name: string }) {
  const pct = windowPct(m)!;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-1.5" title={monthlyTitle(name, m)}>
        <Ticks responsive value={pct} count={20} height={10} tone={pct >= 0.9 ? 'needs' : undefined} className="min-w-0 flex-1" label={`${name} month usage`} />
        <span className="w-[26px] shrink-0 text-right font-num text-[10px] text-fg-2 tabular-nums">{Math.round(pct * 100)}%</span>
        <span className="text-[10px] text-fg-3">mo</span>
      </div>
      <ResetTime compact resetsAt={m.resetsAt} label={`${name} month`} className="pt-0.5" />
    </div>
  );
}

/**
 * One account's row: the 5-hour and weekly windows, a monthly cycle (Cursor), "no reading yet" when that account has
 * none of its own yet, or "no data" when its reading went stale. A harness with several accounts names each under its
 * row; one with a single account keeps the plain row, with the account on hover.
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
      <div className="flex items-start gap-2">
        <span className="caption inline-flex h-[14px] w-[66px] shrink-0 items-center gap-1.5 text-fg-2" title={who ?? undefined}>
          <span className="text-fg"><HarnessLogo harness={row.harness} size={12} /></span>
          {name}
        </span>
        {noData && row.waiting && row.account ? (
          <span className="flex-1 truncate text-[10.5px] text-fg-3" title={waitingTitle(row.harness, name, row.account)} data-testid="usage-waiting">
            no reading yet
          </span>
        ) : noData ? (
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
          {/* The plan gives way too, at most half the line, so a narrow sidebar keeps room for the email. */}
          {row.account.plan && <span className="min-w-0 max-w-[45%] shrink-0 truncate">· {row.account.plan}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * The card's rows: one per signed-in account (GET /api/accounts), each with its own reading. Readings that come in on
 * the feed replace the listed one for that account until the list loads again.
 */
export function useUsageRows(): UsageRow[] {
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
export function UsageCard({ phone = false }: { phone?: boolean }) {
  const { status, feedLive } = useApp();
  const rows = useUsageRows();
  const pref = phone ? 'usage.phone.open' : 'usage.open';
  const [open, setOpen] = useState(() => readPref(pref, false));
  const toggle = () => setOpen((o) => { writePref(pref, !o); return !o; });
  const footer = slotSummary(status?.slots);
  const peak = peakUsage(rows);
  return (
    <div className="rounded-[20px] bg-bg/70 shadow-[var(--shadow-card)]">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 rounded-[20px] px-3 py-2.5 text-fg-3 hover:text-fg ${phone ? 'min-h-11 text-[14px]' : 'text-[11px]'}`}
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
          {phone ? (
            <PhoneUsageRows rows={rows} />
          ) : (
            <>
              <div className="flex items-center gap-2 pb-0.5 text-[11px] font-medium text-fg-3">
                <span className="w-[66px] shrink-0" />
                <span className="flex-1">5h</span>
                <span className="flex-1">Week</span>
              </div>
              {rows.map((r) => <UsageRowView key={r.key} row={r} />)}
            </>
          )}
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

/** At phone width each account gets the full line, with labels and reset details visible without hover. */
function PhoneUsageRows({ rows }: { rows: UsageRow[] }) {
  const now = useNow(60_000);
  if (!rows.length) return <p className="text-[13px] text-fg-3">No usage data.</p>;
  return (
    <ul role="list" className="divide-y divide-line">
      {rows.map((row) => {
        const name = NAMES[row.harness] ?? row.harness;
        const meterName = row.account ? `${name} (${row.account.label})` : name;
        const windows = planWindows(row.usage);
        return (
          <li key={row.key} className="space-y-2 py-2.5">
            <div>
              <div className="flex items-center gap-2 text-[14px] font-medium"><HarnessLogo harness={row.harness} />{name}</div>
              {row.account && <p className="mt-1 text-[13px] text-fg-2 [overflow-wrap:anywhere]">{accountTitle(row.account)}</p>}
            </div>
            {windows.map(({ label, fraction, resetsAt, detail }) => {
              const reset = resetSentence(resetsAt, now);
              return (
                <div key={label}>
                  <div className="flex flex-wrap justify-between gap-x-2 text-[13px]">
                    <span>{label}</span>
                    <span className="font-num tabular-nums">{Math.round(fraction * 100)}% used</span>
                  </div>
                  <Ticks responsive value={fraction} tone={fraction >= 0.9 ? 'needs' : undefined} label={`${meterName} ${label} usage`} className="my-1" />
                  {detail && <p className="text-[13px] text-fg-3">{detail}</p>}
                  {reset && <p className="text-[13px] text-fg-3">{reset}</p>}
                </div>
              );
            })}
            {!windows.length && <p className="text-[13px] text-fg-3 [overflow-wrap:anywhere]">
              {row.waiting && row.account ? waitingTitle(row.harness, name, row.account) : 'No data'}
            </p>}
          </li>
        );
      })}
    </ul>
  );
}
