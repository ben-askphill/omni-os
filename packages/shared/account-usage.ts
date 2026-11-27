// Plan usage per harness account: the record each machine writes for the account its harness runs as, and the rows
// the Usage card shows. A reading belongs to the account that ran it, never to the harness, so two machines signed in
// to two Claude plans each keep their own numbers (apps/server/harness-accounts.ts writes them). Rows come from
// GET /api/accounts: one per signed-in account, any machine, with that account's last reading or none.
import { formatCents } from './context-meter.ts';
import { identityKey, type AccountsView } from './harness-accounts.ts';

/** A 5-hour or weekly window, or a monthly cycle. Utilization is 0 to 1 (older readings say 0 to 100). Epoch seconds. */
export interface PlanWindow {
  utilization: number;
  resetsAt: number;
}

/** A monthly billing cycle (Cursor's). Fractions are 0 to 1, money in cents. */
export interface MonthlyPlanUsage extends PlanWindow {
  startsAt?: number;
  auto?: number;
  api?: number;
  spendCents?: number;
  includedCents?: number;
  bonusCents?: number;
}

/**
 * One group of models that share a 5-hour and a weekly window (Antigravity's Gemini models, and its Claude and GPT
 * models). The name is the harness's own, without a trailing "models".
 */
export interface PlanPool {
  name: string;
  five_hour?: PlanWindow;
  seven_day?: PlanWindow;
}

export interface PlanUsage {
  five_hour?: PlanWindow;
  seven_day?: PlanWindow;
  monthly?: MonthlyPlanUsage;
  /**
   * A plan whose models are split into groups, each with its own windows (Antigravity). The first is the default
   * model's group, and the top-level windows are a copy of its own, so a reader that knows no pools still sees them.
   */
  pools?: PlanPool[];
  status?: string;
  updated_at?: string;
  /** The per-harness reading came through a login that may not be the harness's account (Cursor's IDE session). */
  unattributed?: boolean;
}

/** One account's last plan reading, as the machine that read it wrote it to the synced kv. */
export interface AccountUsage {
  harness: string;
  label: string;
  org: string | null;
  plan: string | null;
  /** The machine that read it, and when. */
  machine: string;
  machineName: string;
  at: string;
  /** Null: the reading went stale or failed, so the row says "no data". */
  usage: PlanUsage | null;
}

/** The kv prefix of every account's usage record: `usage-account.<harness>.<hash of the account>`. */
export const ACCOUNT_USAGE_PREFIX = 'usage-account.';

/** Which account a usage record belongs to, the way accounts are told apart (label and org). */
export const accountUsageKey = (r: Pick<AccountUsage, 'harness' | 'label' | 'org'>) => `${r.harness}\u0000${identityKey(r) ?? ''}`;

/** One row of the Usage card: a signed-in account, or the harness itself when it has no account to name. */
export interface UsageRow {
  key: string;
  harness: string;
  /** Null for a harness-level row (no accounts listed yet, or a harness like Hermes that has none to read). */
  account: { label: string; org: string | null; plan: string | null; machines: string[] } | null;
  usage: PlanUsage | null;
  /** The harness has more than one account, so this row names its account. */
  several: boolean;
  /**
   * One of several accounts on a harness whose readings come in per account (Claude Code with each turn, Codex with each
   * run and its limit checks), and this one has none of its own yet from any machine. The row says it is waiting for
   * one instead of a bare "no data". Never set for Cursor, whose dashboard fallback is never filed per account.
   */
  waiting: boolean;
}

/** Harnesses whose readings each get filed under the account they ran as, so a missing one is only not in yet. */
const FILED_PER_ACCOUNT = new Set(['claude-code', 'codex']);

/** The latest record per account, by when it was read. */
export function latestUsage(records: readonly AccountUsage[]): Map<string, AccountUsage> {
  const out = new Map<string, AccountUsage>();
  for (const r of records) {
    const k = accountUsageKey(r);
    const had = out.get(k);
    if (!had || had.at < r.at) out.set(k, r);
  }
  return out;
}

/**
 * The Usage card's rows, in `harnesses` order. Each signed-in account on any machine gets one row, however many
 * machines run it, with that account's own reading or none ("no data"): never another account's. A harness with no
 * signed-in account gets no row, except one with no account to read (Hermes) or a failed check, which keeps a plain
 * harness row. Without the accounts list (still loading, or an older server) every harness gets today's row from
 * `legacy`, the reading kept per harness.
 *
 * `legacy` also fills a lone account's row until any account of that harness has its own record, so the card does
 * not go blank on the first start after an update, unless it was read through another login (`unattributed`). Once
 * an account has a record, it is never used for that harness again.
 */
export function usageRows(
  harnesses: readonly string[],
  view: Pick<AccountsView, 'machines'> | null | undefined,
  records: readonly AccountUsage[],
  legacy: Partial<Record<string, PlanUsage | null>> = {},
): UsageRow[] {
  const latest = latestUsage(records);
  return harnesses.flatMap((h): UsageRow[] => {
    const plain = (usage: PlanUsage | null): UsageRow[] => [{ key: h, harness: h, account: null, usage, several: false, waiting: false }];
    const listed = (view?.machines ?? []).flatMap((m) => m.accounts.filter((a) => a.harness === h).map((a) => ({ machine: m.name, a })));
    if (!view || !listed.length) return plain(legacy[h] ?? null);

    const accounts = new Map<string, NonNullable<UsageRow['account']>>();
    for (const { machine, a } of listed) {
      const k = identityKey(a);
      if (a.state !== 'signed-in' || !a.label || !k) continue;
      const had = accounts.get(k);
      if (had) {
        if (!had.machines.includes(machine)) had.machines.push(machine);
        had.plan ??= a.plan;
      } else accounts.set(k, { label: a.label, org: a.org, plan: a.plan, machines: [machine] });
    }
    if (!accounts.size) {
      if (listed.some(({ a }) => a.state === 'not-reported')) return plain(legacy[h] ?? null);
      return listed.some(({ a }) => a.state === 'unknown') ? plain(null) : [];
    }

    const anyRecord = [...latest.values()].some((r) => r.harness === h);
    const several = accounts.size > 1;
    return [...accounts.values()].map((account) => {
      const k = accountUsageKey({ harness: h, label: account.label, org: account.org });
      const own = latest.get(k);
      // The per-harness reading stands in only when it can be no other account's: one account, none filed yet, and not
      // read through another login.
      const stand = legacy[h] && !legacy[h]!.unattributed ? legacy[h]! : null;
      const usage = own ? own.usage : !several && !anyRecord ? stand : null;
      return { key: k, harness: h, account, usage, several, waiting: several && !own && !usage && FILED_PER_ACCOUNT.has(h) };
    });
  });
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function windowOf(v: unknown): PlanWindow | undefined {
  const w = v as Partial<PlanWindow> | null;
  const utilization = num(w?.utilization);
  const resetsAt = num(w?.resetsAt);
  return utilization === undefined || resetsAt === undefined ? undefined : { utilization, resetsAt };
}

/** Only the fields the card reads, each a finite number or a string: a record another machine wrote is not trusted further. */
export function parsePlanUsage(v: unknown): PlanUsage | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const u = v as Record<string, unknown>;
  const out: PlanUsage = {};
  const five = windowOf(u.five_hour);
  const week = windowOf(u.seven_day);
  const month = windowOf(u.monthly);
  if (five) out.five_hour = five;
  if (week) out.seven_day = week;
  if (month) {
    const m = u.monthly as Record<string, unknown>;
    out.monthly = { ...month };
    for (const k of ['startsAt', 'auto', 'api', 'spendCents', 'includedCents', 'bonusCents'] as const) {
      const n = num(m[k]);
      if (n !== undefined) out.monthly[k] = n;
    }
  }
  const pools = Array.isArray(u.pools) ? u.pools.flatMap(poolOf).slice(0, MAX_POOLS) : [];
  if (pools.length) out.pools = pools;
  if (typeof u.status === 'string') out.status = u.status.slice(0, 40);
  if (typeof u.updated_at === 'string') out.updated_at = u.updated_at.slice(0, 40);
  return out;
}

/** More groups than any plan has: a record that says more is cut there. */
const MAX_POOLS = 6;

function poolOf(v: unknown): PlanPool[] {
  const p = v as Record<string, unknown> | null;
  const name = typeof p?.name === 'string' ? p.name.trim().slice(0, 40) : '';
  if (!p || !name) return [];
  const five = windowOf(p.five_hour);
  const week = windowOf(p.seven_day);
  if (!five && !week) return [];
  return [{ name, ...(five && { five_hour: five }), ...(week && { seven_day: week }) }];
}

/**
 * Each harness with the short name usage rows give it, in the order they list until Settings > Usage panel orders
 * them (usage-panel.ts).
 */
export const HARNESS_ROWS = [
  { id: 'claude-code', name: 'Claude' },
  { id: 'codex', name: 'Codex' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'antigravity', name: 'Antigravity' },
  { id: 'hermes', name: 'Hermes' },
] as const;

/** The harnesses the running-slots line counts: the usage rows, plus Cursor Cloud, which has no usage row. */
export const SLOT_ROWS = [...HARNESS_ROWS, { id: 'cursor-cloud', name: 'Cursor Cloud' }, { id: 'opencode', name: 'OpenCode' }] as const;

/** How full a usage window is, whether the harness reports a fraction or a percent. */
export function windowPct(w?: { utilization: number }): number | null {
  if (!w) return null;
  const raw = w.utilization > 1.5 ? w.utilization / 100 : w.utilization;
  return Math.max(0, Math.min(1, raw));
}

/** From this full on, a meter's bar and percent show in the Needs you colour. */
const NEARLY_FULL = 0.9;

/**
 * A meter (0 to 1) close enough to full that its bar and percent show in the Needs you colour: a usage window on the
 * Usage card and Activity, or a machine's CPU or memory on its tile.
 */
export const nearlyFull = (fraction: number | null | undefined): boolean => fraction != null && fraction >= NEARLY_FULL;

/**
 * What a Usage card keeps between loads: the reading per harness (GET /status, then each `usage` feed message) and
 * the account readings the feed brought since GET /api/accounts (`account_usage`), by account.
 */
export interface UsageFeed {
  harness: Partial<Record<string, PlanUsage | null>>;
  live: Record<string, AccountUsage>;
}

/** A `usage` feed message: the reading kept per harness (Claude Code when it names none). */
export const withHarnessUsage = <U>(prev: Partial<Record<string, U>>, e: { harness?: string; usage: U }): Partial<Record<string, U>> => ({
  ...prev,
  [e.harness ?? 'claude-code']: e.usage,
});

/** An `account_usage` feed message: it replaces that account's reading until the accounts list loads again. */
export const withAccountUsage = (live: Readonly<Record<string, AccountUsage>>, usage: AccountUsage): Record<string, AccountUsage> => ({
  ...live,
  [accountUsageKey(usage)]: usage,
});

/** The records the card's rows read: the listed ones, then those the feed brought (`latestUsage` keeps the newer). */
export const usageRecords = (view: { usage?: readonly AccountUsage[] } | null | undefined, live: Readonly<Record<string, AccountUsage>>): AccountUsage[] => [
  ...(view?.usage ?? []),
  ...Object.values(live),
];

/** An `account_usage` record read off the feed, where a client gets it untyped. Only the fields the rows read. */
export function feedAccountUsage(v: unknown): AccountUsage | null {
  const r = v as Partial<AccountUsage> | null;
  if (!r || typeof r !== 'object' || typeof r.harness !== 'string' || typeof r.label !== 'string' || !r.label) return null;
  if (typeof r.machine !== 'string' || typeof r.at !== 'string') return null;
  const str = (s: unknown) => (typeof s === 'string' ? s : null);
  return {
    harness: r.harness,
    label: r.label,
    org: str(r.org),
    plan: str(r.plan),
    machine: r.machine,
    machineName: str(r.machineName) ?? r.machine,
    at: r.at,
    usage: parsePlanUsage(r.usage),
  };
}

export const EMPTY_USAGE_FEED: UsageFeed = { harness: {}, live: {} };

const typeOf = (message: unknown) => (message && typeof message === 'object' && 'type' in message ? (message as { type: unknown }).type : null);

/**
 * A feed message merged into what a Usage card holds, as the web store and the iOS Activity card both do: `usage`
 * replaces the harness's reading, `account_usage` that account's. Any other message leaves `feed` as it is.
 */
export function mergeUsageMessage(feed: UsageFeed, message: unknown): UsageFeed {
  const m = message as { harness?: unknown; usage?: unknown };
  if (typeOf(message) === 'usage') {
    const harness = typeof m.harness === 'string' ? m.harness : undefined;
    return { ...feed, harness: withHarnessUsage(feed.harness, { harness, usage: parsePlanUsage(m.usage) }) };
  }
  if (typeOf(message) === 'account_usage') {
    const usage = feedAccountUsage(m.usage);
    return usage ? { ...feed, live: withAccountUsage(feed.live, usage) } : feed;
  }
  return feed;
}

/** A feed message saying the accounts changed: the card loads GET /api/accounts again. */
export const isAccountsMessage = (message: unknown): boolean => typeOf(message) === 'accounts';

export function peakUsage(rows: readonly UsageRow[]): number | null {
  let peak: number | null = null;
  for (const { usage } of rows) {
    const pooled = usage?.pools?.flatMap((p) => [p.five_hour, p.seven_day]) ?? [];
    for (const window of [usage?.five_hour, usage?.seven_day, usage?.monthly, ...pooled]) {
      const pct = windowPct(window);
      if (pct !== null && (peak === null || pct > peak)) peak = pct;
    }
  }
  return peak;
}

/** The full account identity, including the machines that reported it. */
export function accountTitle(a: NonNullable<UsageRow['account']>): string {
  const machines = a.machines.length ? `, on ${a.machines.join(' and ')}` : '';
  return `${[a.label, a.plan, a.org && !a.org.toLowerCase().includes(a.label.toLowerCase()) ? a.org : null].filter(Boolean).join(' · ')}${machines}`;
}

/** Why an account row has no numbers yet, and what fills it in. */
export function waitingTitle(harness: string, name: string, a: NonNullable<UsageRow['account']>): string {
  const on = a.machines.length ? ` on ${a.machines.join(' or ')}` : '';
  const when =
    harness === 'claude-code'
      ? 'after the next Claude Code turn signed in as this account'
      : `the next time ${name} reads this account's limits (at startup, every 15 minutes, or during a run)`;
  return `No reading for ${a.label} yet. It fills in ${when}${on}.`;
}

function monthlyDetails(m: MonthlyPlanUsage): string {
  const pct = (f: number) => `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
  return [
    m.auto !== undefined && `Auto ${pct(m.auto)}`,
    m.api !== undefined && `API ${pct(m.api)}`,
    m.spendCents !== undefined && `${formatCents(m.spendCents)} spent`,
    m.includedCents !== undefined && `${formatCents(m.includedCents)} included`,
  ].filter(Boolean).join(' · ');
}

interface PlanWindowView {
  label: string;
  fraction: number;
  resetsAt: number;
  detail?: string;
}

/** The pools a reading names, when it has more than one: a single pool is the plan's own windows. */
export const planPools = (usage: PlanUsage | null | undefined): PlanPool[] => (usage?.pools && usage.pools.length > 1 ? usage.pools : []);

/**
 * The windows a phone row lists: the 5-hour and weekly windows when present (each pool's, named by its pool, when
 * the plan has several), and the monthly cycle otherwise.
 */
export function planWindows(usage: PlanUsage | null): PlanWindowView[] {
  const pools = planPools(usage);
  const windows = pools.length
    ? pools.flatMap((p) => [
        { label: `${p.name} 5-hour window`, window: p.five_hour },
        { label: `${p.name} weekly window`, window: p.seven_day },
      ])
    : [
        { label: '5-hour window', window: usage?.five_hour },
        { label: 'Weekly window', window: usage?.seven_day },
      ];
  if (usage?.monthly && !usage.five_hour && !usage.seven_day && !pools.length) {
    return [{ label: 'Monthly cycle', fraction: windowPct(usage.monthly)!, resetsAt: usage.monthly.resetsAt, detail: monthlyDetails(usage.monthly) }];
  }
  return windows.flatMap(({ label, window }) => window ? [{ label, fraction: windowPct(window)!, resetsAt: window.resetsAt }] : []);
}
