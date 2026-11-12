// Number formats for the Inbox dashboard. Every derived figure here divides two totals the server sent.
import type { UsageSource } from '@omni/shared/insights.ts';

export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  if (abs >= 1e3) return `${trim(n / 1e3)}K`;
  return String(Math.round(n));
}
const trim = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : (Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.?0+$/, ''));

export const grouped = (n: number) => Math.round(n).toLocaleString('en-US');

export function usd(n: number): string {
  if (n > 0 && n < 0.01) return '<$0.01';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n >= 1000 ? 0 : 2, minimumFractionDigits: n >= 1000 ? 0 : 2 });
}

/** A share as a whole percent, or "<1%" for a sliver; "–" when there is no whole to share. */
export function pct(part: number, whole: number): string {
  if (!whole) return '–';
  const p = (part / whole) * 100;
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
}

export const SOURCE_NAME: Record<UsageSource, string> = { 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor' };
/** Chart tokens from index.css, one per source, in a fixed order so a source keeps its colour across ranges. */
export const SOURCE_COLOR: Record<UsageSource, string> = { 'claude-code': 'var(--chart-2)', codex: 'var(--chart-1)', cursor: 'var(--chart-3)' };
/** The rows the section always lists, then any other source with data. */
export const SOURCE_ORDER: UsageSource[] = ['claude-code', 'cursor', 'codex'];

/** "12 Nov" from a YYYY-MM-DD day key, read as a calendar date (no time zone shift). */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
