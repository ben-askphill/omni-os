// What the Inbox dashboard shows for a range (GET /api/insights). Threads, channels and automations from the db and
// the automation files; PRs from gh; tokens and cost from the harnesses' session logs (usage-logs.ts), Cursor's billing
// events (cursor-usage.ts) and LiteLLM's list prices (usage-pricing.ts). Every number is a count or a sum of those;
// nothing is estimated. Answers are kept 10 seconds per range and time zone; the slow reads under them, longer.
import { Cron } from 'croner';
import { channels, db } from './db.ts';
import { loadAutomations } from './automations.ts';
import { ghLogin } from './automation-watch.ts';
import { allPRs, mergedSince } from './github.ts';
import { cursorUsageEvents } from './cursor-usage.ts';
import { logRoots, scanUsageLogs, usageRecords, type UsageRecord } from './usage-logs.ts';
import { lookup, priceTable, RATES_URL, type Rates } from './usage-pricing.ts';
import {
  dayKey,
  rangeDays,
  type InsightRange,
  type Insights,
  type InsightsAutomations,
  type InsightsChannel,
  type InsightsPR,
  type InsightsPRs,
  type InsightsUsage,
  type TokenTotals,
  type UsageModelRow,
  type UsageRow,
  type UsageSource,
} from '@omni/shared/insights.ts';

/** How long to wait on a slow read (the first log scan, gh, Cursor) before answering with what is there. */
const WAIT_MS = 1500;
const ANSWER_TTL_MS = 10_000;
const SCAN_TTL_MS = 60_000;
const SLOW_TTL_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

// ---------- usage ----------

type Price = (model: string, source: UsageSource, speed: UsageRecord['speed']) => Rates | null;

/** Cursor bills under its own names ("cursor-claude-4.5-sonnet-thinking-high"): the list-price model under it. */
export const cursorRateModel = (model: string) =>
  model
    .replace(/^cursor-/, '')
    .replace(/(-thinking)?(-(none|minimal|low|medium|high|xhigh|max))?(-fast)?$/, '')
    .replace(/^grok-/, 'xai/grok-');

const zero = (): TokenTotals => ({ uncached: 0, cached: 0, cacheWrite: 0, output: 0, cost: 0, savings: 0, unpriced: 0 });

function add(t: TokenTotals, r: UsageRecord, rates: Rates | null) {
  t.uncached += r.uncached;
  t.cached += r.cached;
  t.cacheWrite += r.cacheWrite;
  t.output += r.output;
  if (r.billed !== null) t.cost += r.billed;
  else if (rates) t.cost += r.uncached * rates.input + r.cached * rates.cacheRead + r.cacheWrite * rates.cacheWrite + r.output * rates.output;
  else t.unpriced++;
  if (rates) t.savings += r.cached * (rates.input - rates.cacheRead);
}

/**
 * Sum the records whose day (in `timeZone`) is one of `days`. A request logged twice (Claude repeats a request's usage
 * on each content block, and a resumed session copies lines) counts once: the first record with its key wins.
 */
export function aggregateUsage(records: Iterable<UsageRecord>, days: string[], timeZone: string, price: Price): Omit<InsightsUsage, 'complete' | 'note'> {
  const inRange = new Set(days);
  const seen = new Set<string>();
  const total = zero();
  const totalSessions = new Set<string>();
  const bySource = new Map<UsageSource, { t: TokenTotals; sessions: Set<string> }>();
  const byModel = new Map<string, UsageModelRow>();
  const byDay = new Map(days.map((d) => [d, { day: d, tokens: {} as Partial<Record<UsageSource, number>>, cost: 0 }]));
  for (const r of records) {
    const day = dayKey(r.ts, timeZone);
    if (!inRange.has(day)) continue;
    if (r.key) {
      if (seen.has(r.key)) continue;
      seen.add(r.key);
    }
    const rates = price(r.model, r.source, r.speed);
    const session = `${r.source}:${r.session}`;
    add(total, r, rates);
    totalSessions.add(session);
    const src = bySource.get(r.source) ?? { t: zero(), sessions: new Set<string>() };
    add(src.t, r, rates);
    src.sessions.add(session);
    bySource.set(r.source, src);
    const mk = `${r.source}\0${r.model}`;
    const m = byModel.get(mk) ?? { model: r.model, source: r.source, ...zero() };
    add(m, r, rates);
    byModel.set(mk, m);
    const d = byDay.get(day)!;
    const one = zero();
    add(one, r, rates);
    d.tokens[r.source] = (d.tokens[r.source] ?? 0) + one.uncached + one.cached + one.cacheWrite + one.output;
    d.cost += one.cost;
  }
  const row = (t: TokenTotals, sessions: number): UsageRow => ({ ...t, sessions });
  const tokens = (t: TokenTotals) => t.uncached + t.cached + t.cacheWrite + t.output;
  return {
    total: row(total, totalSessions.size),
    sources: [...bySource].map(([source, s]) => ({ source, ...row(s.t, s.sessions.size) })).sort((a, b) => tokens(b) - tokens(a)),
    models: [...byModel.values()].sort((a, b) => b.cost - a.cost || tokens(b) - tokens(a)),
    days: [...byDay.values()],
  };
}

/** Cursor's billing events as usage records. Its input count is what was sent fresh; cache reads come apart. */
function cursorRecords(events: Awaited<ReturnType<typeof cursorUsageEvents>>): UsageRecord[] {
  return (events ?? []).map((e) => ({
    ts: e.at,
    source: 'cursor',
    model: e.model ?? 'cursor',
    session: e.conversationId ?? e.id ?? String(e.at),
    uncached: e.input,
    cached: e.cacheRead,
    cacheWrite: e.cacheWrite,
    output: e.output,
    key: e.id ? `cursor:${e.id}` : null,
    billed: e.cents / 100,
    speed: 'standard',
  }));
}

/** A slow read kept for a while and refreshed in the background, so a page load never waits on it after the first. */
function slow<T>(load: () => Promise<T>, ttl: number) {
  let value: T | undefined;
  let at = 0;
  let pending: Promise<T> | null = null;
  return {
    get(): Promise<T | undefined> {
      if (Date.now() - at > ttl && !pending) {
        pending = load()
          .then((v) => {
            value = v;
            at = Date.now();
            return v;
          })
          .finally(() => (pending = null));
      }
      if (value !== undefined || !pending) return Promise.resolve(value);
      return Promise.race([pending, new Promise<undefined>((r) => setTimeout(() => r(undefined), WAIT_MS).unref?.())]).catch(() => undefined);
    },
    reset() {
      value = undefined;
      at = 0;
    },
  };
}

const cursor = slow(() => cursorUsageEvents(Date.now() - 31 * DAY_MS), SLOW_TTL_MS);

async function usage(days: string[], timeZone: string): Promise<InsightsUsage> {
  const { scannedAt } = usageRecords();
  if (Date.now() - scannedAt > SCAN_TTL_MS) {
    const scan = scanUsageLogs();
    await Promise.race([scan, new Promise((r) => setTimeout(r, WAIT_MS).unref?.())]);
  }
  const [prices, events] = await Promise.all([priceTable(), cursor.get()]);
  const { records, complete } = usageRecords();
  const price: Price = (model, source, speed) => (prices ? lookup(prices.table, source === 'cursor' ? cursorRateModel(model) : model, speed) : null);
  return {
    ...aggregateUsage([...records, ...cursorRecords(events ?? null)], days, timeZone, price),
    complete,
    note: { logs: logRoots(), prices: prices ? RATES_URL : null, cursor: events ? 'read' : 'unavailable' },
  };
}

// ---------- threads and channels ----------

function busiestChannels(days: string[], timeZone: string, since: string): InsightsChannel[] {
  const inRange = new Set(days);
  const counts = new Map<string, number>();
  const rows = db.prepare(`SELECT channel_id, created_at FROM threads WHERE created_at >= ?`).all(since) as { channel_id: string; created_at: string }[];
  for (const r of rows) if (inRange.has(dayKey(Date.parse(r.created_at), timeZone))) counts.set(r.channel_id, (counts.get(r.channel_id) ?? 0) + 1);
  return channels
    .list()
    .flatMap((c) => (counts.get(c.id) ? [{ id: c.id, name: c.name, icon: c.icon ?? null, threads: counts.get(c.id)! }] : []))
    .sort((a, b) => b.threads - a.threads || a.name.localeCompare(b.name));
}

function doneCount(days: string[], timeZone: string, since: string): number {
  const inRange = new Set(days);
  const rows = db.prepare(`SELECT done_at FROM threads WHERE done_at IS NOT NULL AND done_at >= ?`).all(since) as { done_at: string }[];
  return rows.filter((r) => inRange.has(dayKey(Date.parse(r.done_at), timeZone))).length;
}

// ---------- pull requests ----------

type Listed = Awaited<ReturnType<typeof allPRs>>['prs'][number];

async function readPRs(repoChannel: Map<string, string>) {
  const repos = [...repoChannel.keys()];
  const since = new Date(Date.now() - 31 * DAY_MS).toISOString().slice(0, 10);
  const [all, viewer, merged] = await Promise.all([
    allPRs(repos),
    ghLogin().catch(() => null),
    Promise.all(repos.map((repo) => mergedSince(repo, since).then((prs) => prs.map((p) => ({ ...p, repo })), () => []))),
  ]);
  return { ...all, viewer, merged: merged.flat(), repoChannel };
}

/** One kept read per set of repos, so adding a channel's repo shows its PRs on the next load, not minutes later. */
let prLists: { repos: string; read: ReturnType<typeof slow<Awaited<ReturnType<typeof readPRs>>>> } | null = null;
function prListsNow() {
  const repoChannel = new Map<string, string>();
  for (const c of channels.list()) if (c.github_repo && !repoChannel.has(c.github_repo)) repoChannel.set(c.github_repo, c.id);
  const repos = [...repoChannel.keys()].sort().join('\n');
  if (prLists?.repos !== repos) prLists = { repos, read: slow(() => readPRs(repoChannel), 2 * 60_000) };
  return prLists.read.get();
}

/** Omni threads by `repo\0branch`, for the PRs opened from them. */
function threadBranches(): Map<string, string> {
  const rows = db
    .prepare(`SELECT t.id, t.branch, c.github_repo FROM threads t JOIN channels c ON c.id = t.channel_id WHERE t.branch IS NOT NULL AND c.github_repo IS NOT NULL ORDER BY t.created_at`)
    .all() as { id: string; branch: string; github_repo: string }[];
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(`${r.github_repo}\0${r.branch}`)) out.set(`${r.github_repo}\0${r.branch}`, r.id);
  return out;
}

async function pullRequests(days: string[], timeZone: string): Promise<InsightsPRs | null> {
  const lists = await prListsNow();
  if (!lists) return null;
  const inRange = new Set(days);
  const branches = threadBranches();
  const open = lists.prs.filter((p: Listed) => (p.state ?? 'OPEN') === 'OPEN');
  const author = (p: Listed) => (p.author as { login?: string } | undefined)?.login ?? null;
  const mine = (p: Listed) => !!lists.viewer && author(p) === lists.viewer;
  const hasChecks = (p: Listed) => p.checks.passed + p.checks.failed + p.checks.pending > 0;
  const top = [...open]
    .sort((a, b) => Number(mine(b)) - Number(mine(a)) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 3)
    .map(
      (p): InsightsPR => ({
        repo: p.repo,
        channel_id: lists.repoChannel.get(p.repo) ?? '',
        number: p.number,
        title: p.title,
        url: p.url,
        author: author(p),
        state: p.state,
        isDraft: !!p.isDraft,
        updatedAt: p.updatedAt,
        checks: p.checks,
        thread_id: branches.get(`${p.repo}\0${p.headRefName}`) ?? null,
      }),
    );
  return {
    open: open.length,
    mine: lists.viewer ? open.filter(mine).length : null,
    withChecks: open.filter(hasChecks).length,
    mergedFromThreads: lists.merged.filter((p) => branches.has(`${p.repo}\0${p.headRefName}`) && inRange.has(dayKey(Date.parse(p.mergedAt), timeZone))).length,
    top,
    failed: lists.failed.map((f) => f.repo),
  };
}

// ---------- automations ----------

function automations(now: number, timeZone: string): InsightsAutomations {
  const all = loadAutomations().filter((a) => !a.error);
  const today = dayKey(now, timeZone);
  const runs = all.flatMap((a) => {
    if (!a.enabled || a.on || !a.cron) return [];
    try {
      return new Cron(a.cron, { timezone: a.timezone, paused: true })
        .nextRuns(48, new Date(now))
        .filter((d) => dayKey(d.getTime(), timeZone) === today)
        .map((d) => ({ id: a.id, name: a.name, channel: a.channel, role: a.role ?? null, at: d.toISOString() }));
    } catch {
      return [];
    }
  });
  return {
    total: all.length,
    scheduled: all.filter((a) => a.enabled && !a.on).length,
    onEvent: all.filter((a) => a.enabled && !!a.on).length,
    paused: all.filter((a) => !a.enabled).length,
    today: runs.sort((a, b) => a.at.localeCompare(b.at)),
  };
}

// ---------- the answer ----------

const answers = new Map<string, { at: number; value: Promise<Insights> }>();

async function build(range: InsightRange, timeZone: string): Promise<Insights> {
  const now = Date.now();
  const days = rangeDays(range, now, timeZone);
  // A day or two before the first day in UTC covers it in any zone; the day keys decide.
  const since = new Date(Date.parse(days[0]) - 2 * DAY_MS).toISOString();
  const [u, prs] = await Promise.all([usage(days, timeZone), pullRequests(days, timeZone)]);
  return {
    range,
    from: days[0],
    to: days[days.length - 1],
    generated_at: new Date(now).toISOString(),
    done: doneCount(days, timeZone, since),
    channels: busiestChannels(days, timeZone, since),
    usage: u,
    prs,
    automations: automations(now, timeZone),
  };
}

/** Partial answers (the log scan or gh still running) are not kept, so the next poll gets the rest. */
export function getInsights(range: InsightRange, timeZone: string): Promise<Insights> {
  const key = `${range}\0${timeZone}`;
  const hit = answers.get(key);
  if (hit && Date.now() - hit.at < ANSWER_TTL_MS) return hit.value;
  const value = build(range, timeZone);
  answers.set(key, { at: Date.now(), value });
  value.then(
    (v) => {
      if (!v.usage.complete || !v.prs) answers.delete(key);
    },
    () => answers.delete(key),
  );
  return value;
}

/** Tests: forget every kept answer and slow read. */
export function resetInsights() {
  answers.clear();
  cursor.reset();
  prLists = null;
}

export const validTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
