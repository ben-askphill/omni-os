// GET /api/insights: what the Inbox dashboard shows for one range (apps/server/insights.ts).

export const INSIGHT_RANGES = ['today', '7d', '30d'] as const;
export type InsightRange = (typeof INSIGHT_RANGES)[number];
export const isInsightRange = (v: unknown): v is InsightRange => (INSIGHT_RANGES as readonly unknown[]).includes(v);
/** How many calendar days each range covers, today included. */
export const RANGE_DAYS: Record<InsightRange, number> = { today: 1, '7d': 7, '30d': 30 };

/** Where tokens were spent: each harness whose session logs or billing Omni reads. */
export type UsageSource = 'claude-code' | 'codex' | 'cursor';

/** One slice of tokens, split the way providers bill them. `cost` is US dollars. */
export interface TokenTotals {
  /** Input sent fresh, not read from the prompt cache. */
  uncached: number;
  /** Input read from the prompt cache. */
  cached: number;
  /** Input written to the prompt cache. */
  cacheWrite: number;
  output: number;
  cost: number;
  /** What `cached` would have cost at the full input rate, less what it did cost. */
  savings: number;
  /** Requests whose model has no list price and no billed amount: counted in tokens, $0 in cost. */
  unpriced: number;
}

export interface UsageRow extends TokenTotals {
  sessions: number;
}

export interface UsageModelRow extends TokenTotals {
  model: string;
  source: UsageSource;
}

export interface UsageDay {
  /** YYYY-MM-DD in the viewer's time zone. */
  day: string;
  /** Tokens per source (uncached + cached + cacheWrite + output). */
  tokens: Partial<Record<UsageSource, number>>;
  cost: number;
}

export interface InsightsUsage {
  /** False while the first scan of the session logs is still running: the numbers are partial. */
  complete: boolean;
  total: UsageRow;
  sources: (UsageRow & { source: UsageSource })[];
  models: UsageModelRow[];
  /** Every day of the range, oldest first, including days with nothing. */
  days: UsageDay[];
  /** Where the numbers came from, for the section's footnote. */
  note: { logs: string[]; prices: string | null; cursor: 'read' | 'unavailable' };
}

export interface InsightsChannel {
  id: string;
  name: string;
  icon: string | null;
  /** Threads started in the range. */
  threads: number;
}

export interface InsightsPR {
  repo: string;
  channel_id: string;
  number: number;
  title: string;
  url: string;
  author: string | null;
  state: string;
  isDraft: boolean;
  updatedAt: string;
  checks: { passed: number; failed: number; pending: number };
  /** The Omni thread on its head branch, if one is. */
  thread_id: string | null;
}

export interface InsightsPRs {
  open: number;
  /** Open PRs the gh login authored. Null when gh cannot say who that is. */
  mine: number | null;
  /** Open PRs with at least one CI check. */
  withChecks: number;
  /** PRs from an Omni thread's branch merged in the range. */
  mergedFromThreads: number;
  top: InsightsPR[];
  /** Repos gh could not read. */
  failed: string[];
}

export interface InsightsAutomationRun {
  id: string;
  name: string;
  channel: string;
  role: string | null;
  /** ISO time of the run. */
  at: string;
}

export interface InsightsAutomations {
  total: number;
  scheduled: number;
  onEvent: number;
  paused: number;
  /** Scheduled runs from now to the end of today, soonest first. */
  today: InsightsAutomationRun[];
}

export interface Insights {
  range: InsightRange;
  /** First and last day of the range, YYYY-MM-DD in the viewer's time zone. */
  from: string;
  to: string;
  generated_at: string;
  /** Threads marked done in the range. */
  done: number;
  /** Channels by threads started in the range, busiest first, only those with any. */
  channels: InsightsChannel[];
  usage: InsightsUsage;
  /** Null while gh is still being asked. */
  prs: InsightsPRs | null;
  automations: InsightsAutomations;
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * Day key in a time zone: the en-CA locale writes YYYY-MM-DD. One formatter per zone, because building one costs about
 * 40 times a format call and /insights asks for every usage record's day.
 */
export function dayKey(ms: number, timeZone: string): string {
  let f = dayFormats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormats.set(timeZone, f);
  }
  return f.format(ms);
}

/** The range's days, oldest first, ending today. Steps back from noon so a DST change never skips or repeats a day. */
export function rangeDays(range: InsightRange, now: number, timeZone: string): string[] {
  const today = dayKey(now, timeZone);
  const [y, m, d] = today.split('-').map(Number);
  const noon = Date.UTC(y, m - 1, d, 12);
  const out: string[] = [];
  for (let i = RANGE_DAYS[range] - 1; i >= 0; i--) out.push(new Date(noon - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

export const tokensOf = (t: Pick<TokenTotals, 'uncached' | 'cached' | 'cacheWrite' | 'output'>) => t.uncached + t.cached + t.cacheWrite + t.output;
