// Plan usage per harness account: the record each machine writes for the account its harness runs as, and the rows
// the Usage card shows. A reading belongs to the account that ran it, never to the harness, so two machines signed in
// to two Claude plans each keep their own numbers (apps/server/harness-accounts.ts writes them). Rows come from
// GET /api/accounts: one per signed-in account, any machine, with that account's last reading or none.
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

export interface PlanUsage {
  five_hour?: PlanWindow;
  seven_day?: PlanWindow;
  monthly?: MonthlyPlanUsage;
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
  if (typeof u.status === 'string') out.status = u.status.slice(0, 40);
  if (typeof u.updated_at === 'string') out.updated_at = u.updated_at.slice(0, 40);
  return out;
}
