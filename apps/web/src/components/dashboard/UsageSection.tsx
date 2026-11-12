import { useState } from 'react';
import { tokensOf, type InsightRange, type InsightsUsage, type UsageSource } from '@omni/shared/insights.ts';
import { untilLabel, windowPct } from '../../format.ts';
import { useApp } from '../../store.tsx';
import { HarnessLogo } from '../brand.tsx';
import { Chip, Loader, Segmented, Ticks } from '../ui.tsx';
import { compact, dayLabel, grouped, pct, SOURCE_COLOR, SOURCE_NAME, SOURCE_ORDER, usd } from './numbers.ts';
import { UsageChart } from './UsageChart.tsx';

const RANGE_LABEL: Record<InsightRange, string> = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days' };

/** The Claude plan's week, from the same reading as the sidebar's Usage card. */
function PlanPill() {
  const { usage } = useApp();
  const week = usage['claude-code']?.seven_day;
  const p = windowPct(week);
  if (p === null) return null;
  return (
    <span
      className="inline-flex h-7 items-center gap-2 rounded-full bg-surface px-3 text-[11.5px] text-fg-2"
      title={`Claude plan: ${Math.round(p * 100)}% of this week used, resets ${untilLabel(week!.resetsAt)}`}
    >
      <HarnessLogo harness="claude-code" size={12} />
      Claude plan
      <Ticks value={p} count={12} height={10} tone={p >= 0.9 ? 'needs' : undefined} label="Claude plan week usage" className="w-[64px]" />
      <span className="font-num tabular-nums">{Math.round(p * 100)}%</span>
    </span>
  );
}

const TYPES = [
  { key: 'cached', label: 'Cache read', color: 'var(--chart-1)' },
  { key: 'uncached', label: 'Input', color: 'var(--chart-4)' },
  { key: 'cacheWrite', label: 'Cache write', color: 'var(--chart-5)' },
  { key: 'output', label: 'Output', color: 'var(--chart-3)' },
] as const;

type Breakdown = 'model' | 'harness' | 'day';

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="caption mb-1">{label}</div>
      <div className="font-num text-[length:var(--fs-subhead)] font-medium text-fg tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-fg-3">{sub}</div>}
    </div>
  );
}

function ShareBar({ part, whole, color }: { part: number; whole: number; color: string }) {
  return (
    <div className="mt-1 h-[3px] w-full max-w-[220px] overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full" style={{ width: `${whole ? Math.max(1, (part / whole) * 100) : 0}%`, background: color }} />
    </div>
  );
}

function BreakdownTable({ usage, view }: { usage: InsightsUsage; view: Breakdown }) {
  const all = usage.total.cost;
  const allTokens = tokensOf(usage.total);
  const rows =
    view === 'model'
      ? usage.models.map((m) => ({ id: `${m.source}:${m.model}`, name: m.model, source: m.source as UsageSource | null, cost: m.cost, tokens: tokensOf(m), mono: true }))
      : view === 'harness'
        ? usage.sources.map((s) => ({ id: s.source, name: SOURCE_NAME[s.source], source: s.source as UsageSource | null, cost: s.cost, tokens: tokensOf(s), mono: false }))
        : [...usage.days].reverse().map((d) => ({ id: d.day, name: dayLabel(d.day), source: null, cost: d.cost, tokens: Object.values(d.tokens).reduce((a, b) => a + (b ?? 0), 0), mono: false }));
  if (!rows.length) return <p className="px-1 py-4 text-[12.5px] text-fg-3">No requests in this range.</p>;
  return (
    <div className="scroll-thin overflow-x-auto rounded-[14px] shadow-[inset_0_0_0_1px_var(--line)]">
      <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
        <thead>
          <tr className="text-left text-[11px] text-fg-3">
            <th className="w-10 px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">{view === 'model' ? 'Model' : view === 'harness' ? 'Harness' : 'Day'}</th>
            <th className="px-3 py-2 text-right font-medium">Cost</th>
            <th className="px-3 py-2 text-right font-medium">Share</th>
            <th className="px-3 py-2 text-right font-medium">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className="border-t border-line align-top">
              <td className="px-3 py-2 font-num text-fg-3 tabular-nums">{i + 1}</td>
              <td className="min-w-0 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`break-all text-fg ${r.mono ? 'font-mono text-[length:var(--fs-code)]' : ''}`}>{r.name}</span>
                  {view === 'model' && r.source && (
                    <Chip>
                      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ background: SOURCE_COLOR[r.source] }} />
                      {SOURCE_NAME[r.source]}
                    </Chip>
                  )}
                </div>
                <ShareBar part={r.cost || r.tokens} whole={r.cost ? all : allTokens} color={r.source ? SOURCE_COLOR[r.source] : 'var(--fg-3)'} />
              </td>
              <td className="px-3 py-2 text-right font-num text-fg tabular-nums">{usd(r.cost)}</td>
              <td className="px-3 py-2 text-right font-num text-fg-2 tabular-nums">{pct(r.cost, all)}</td>
              <td className="px-3 py-2 text-right font-num text-fg-2 tabular-nums" title={grouped(r.tokens)}>
                {compact(r.tokens)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Tokens and cost across the harnesses' session logs and Cursor's billing, modelled on T3 Code's usage view. Derived
 * figures (cache hit, per session, share) divide the totals shown beside them.
 */
export function UsageSection({ usage, range, from, to, loading }: { usage: InsightsUsage | undefined; range: InsightRange; from?: string; to?: string; loading: boolean }) {
  const [view, setView] = useState<Breakdown>('model');
  const header = (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display text-[length:var(--fs-heading)]">
        {RANGE_LABEL[range]}
        {from && to && (
          <span className="ml-2 text-[length:var(--fs-ui)] font-normal text-fg-3">
            {from === to ? dayLabel(from) : `${dayLabel(from)} to ${dayLabel(to)}`}
          </span>
        )}
      </h2>
      <PlanPill />
    </div>
  );
  if (!usage)
    return (
      <section aria-label="Usage" className="card p-5 md:p-6">
        {header}
        <div className="flex h-[180px] items-center justify-center gap-2 text-[12.5px] text-fg-3">{loading ? <><Loader /> Reading session logs</> : 'Usage could not be read.'}</div>
      </section>
    );
  const t = usage.total;
  const tokens = tokensOf(t);
  const input = t.uncached + t.cached + t.cacheWrite;
  const sources = [...SOURCE_ORDER, ...usage.sources.map((s) => s.source).filter((s) => !SOURCE_ORDER.includes(s))];
  const charted = sources.filter((s) => usage.days.some((d) => (d.tokens[s] ?? 0) > 0));
  const rowOf = (s: UsageSource) => usage.sources.find((r) => r.source === s);
  return (
    <section aria-label="Usage" className="card p-5 md:p-6">
      {header}
      <div className="grid gap-6 @3xl:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="font-display text-[length:var(--fs-display)] leading-none tabular-nums" title={`${grouped(tokens)} tokens`}>
            {compact(tokens)}
          </div>
          <div className="mt-2 text-[12.5px] text-fg-3">
            tokens · {grouped(t.sessions)} {t.sessions === 1 ? 'session' : 'sessions'} · <span className="text-fg-2">{usd(t.cost)}</span>
          </div>
          <ul className="mt-5 flex flex-col gap-3">
            {sources.map((s) => {
              const r = rowOf(s);
              const n = r ? tokensOf(r) : 0;
              return (
                <li key={s} className="flex items-start gap-2.5">
                  <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: SOURCE_COLOR[s] }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] text-fg">{SOURCE_NAME[s]}</span>
                      <span className="font-num text-[13px] text-fg tabular-nums">{compact(n)}</span>
                    </div>
                    <div className="text-[11px] text-fg-3">
                      {r ? `${grouped(r.sessions)} ${r.sessions === 1 ? 'session' : 'sessions'} · ${pct(n, tokens)} share · ${usd(r.cost)}` : s === 'cursor' && usage.note.cursor === 'unavailable' ? 'Cursor billing not readable on this machine' : 'No sessions in this range'}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="caption">Daily processed tokens</h3>
            {!usage.complete && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-3">
                <Loader size={11} /> Still reading logs
              </span>
            )}
          </div>
          {tokens > 0 ? <UsageChart days={usage.days} sources={charted} /> : <div className="flex h-[180px] items-center justify-center text-[12.5px] text-fg-3">No tokens in this range.</div>}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-5 @3xl:grid-cols-5">
        <Stat label="Cached input" value={compact(t.cached)} sub={`${pct(t.cached, input)} cache hit`} />
        <Stat label="Uncached input" value={compact(t.uncached)} sub={`plus ${compact(t.cacheWrite)} written to cache`} />
        <Stat label="Output" value={compact(t.output)} />
        <Stat label="Tokens per session" value={t.sessions ? compact(tokens / t.sessions) : '–'} sub={t.sessions ? `${usd(t.cost / t.sessions)} per session` : undefined} />
        <Stat label="Cache savings" value={usd(t.savings)} sub="vs full input price" />
      </div>

      <div className="mt-6">
        <h3 className="caption mb-2">Tokens by type</h3>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={TYPES.map((k) => `${k.label} ${pct(t[k.key], tokens)}`).join(', ')}>
          {TYPES.map((k) => (tokens ? <div key={k.key} style={{ width: `${(t[k.key] / tokens) * 100}%`, background: k.color }} /> : null))}
        </div>
        <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-[11.5px] text-fg-2">
          {TYPES.map((k) => (
            <li key={k.key} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: k.color }} />
              {k.label}
              <span className="font-num text-fg-3 tabular-nums">
                {compact(t[k.key])} · {pct(t[k.key], tokens)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="caption">Breakdown</h3>
          <Segmented
            size="sm"
            label="Break usage down by"
            value={view}
            onChange={setView}
            options={[
              { id: 'model', label: 'Model' },
              { id: 'harness', label: 'Harness' },
              { id: 'day', label: 'Day' },
            ]}
          />
        </div>
        <BreakdownTable usage={usage} view={view} />
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-fg-3">
        {usage.note.logs.length ? `From the session logs in ${usage.note.logs.join(' and ')}` : 'No Claude Code or Codex session logs on this machine'}
        {usage.note.cursor === 'read' ? ', and Cursor’s billed usage' : ''}. Cost uses LiteLLM list prices{usage.note.prices ? '' : ' (not fetched yet)'}, or what the provider billed.
        {t.unpriced > 0 && ` ${grouped(t.unpriced)} requests have no known price and count as $0.`}
      </p>
    </section>
  );
}
