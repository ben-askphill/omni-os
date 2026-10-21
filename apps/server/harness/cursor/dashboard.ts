// Cursor's plan usage and usage events, read from the dashboard's own Connect RPC endpoints on api2.cursor.sh.
// These are undocumented (Cursor's Admin API is for Enterprise teams only), so every call, the token lookup and
// the response shapes live in this one file: when Cursor changes them, this is the file to fix. Everything else
// takes the typed results below. Any failure (no token, a 401, a timeout, a shape this file doesn't know) is
// null, which the UI shows as "no data". Token values are never logged, returned or stored.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const BASE = 'https://api2.cursor.sh/aiserver.v1.DashboardService';
const TIMEOUT_MS = 10_000;
/** One page is enough for a thread's events; the API takes up to 1000. */
const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

/** The plan's current billing cycle. */
export interface CursorPlanUsage {
  /** Percent of the included usage used, 0 to 100. Cursor's headline number. */
  totalPercent: number;
  /** The Auto and Composer bucket, and the named-model (API) bucket, 0 to 100. */
  autoPercent: number | null;
  apiPercent: number | null;
  /** Cents spent this cycle, cents the plan includes, cents Cursor gave as bonus. */
  spendCents: number | null;
  includedCents: number | null;
  bonusCents: number | null;
  /** Epoch seconds. */
  cycleStart: number | null;
  cycleEnd: number;
}

/** One billed model call (or turn) from the usage events. */
export interface CursorUsageEvent {
  id: string | null;
  /** Epoch ms. */
  at: number;
  /** The cursor-agent session id (an Omni thread's session_id), when the event came from a chat. */
  conversationId: string | null;
  model: string | null;
  cents: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// ---------- response mapping (pure) ----------

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v && v !== 'null' ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** GetCurrentPeriodUsage's body, or null when it lacks the percent used or the cycle end. */
export function mapPlanUsage(body: unknown): CursorPlanUsage | null {
  const b = obj(body);
  const plan = obj(b?.planUsage);
  if (!b || !plan) return null;
  const totalPercent = num(plan.totalPercentUsed);
  const end = num(b.billingCycleEnd);
  if (totalPercent === null || end === null || end <= 0) return null;
  const start = num(b.billingCycleStart);
  return {
    totalPercent: Math.max(0, totalPercent),
    autoPercent: num(plan.autoPercentUsed),
    apiPercent: num(plan.apiPercentUsed),
    spendCents: num(plan.totalSpend),
    includedCents: num(plan.includedSpend) ?? num(plan.limit),
    bonusCents: num(plan.bonusSpend),
    // Cursor sends epoch ms as strings.
    cycleStart: start !== null && start > 0 ? Math.round(start / 1000) : null,
    cycleEnd: Math.round(end / 1000),
  };
}

/** GetFilteredUsageEvents' body: its events and the total count, or null when the list is missing. */
export function mapUsageEvents(body: unknown): { events: CursorUsageEvent[]; total: number } | null {
  const b = obj(body);
  const list = b?.usageEventsDisplay;
  // An empty period comes back as {} with no list.
  if (b && list === undefined && Object.keys(b).length === 0) return { events: [], total: 0 };
  if (!Array.isArray(list)) return null;
  const events: CursorUsageEvent[] = [];
  for (const raw of list) {
    const e = obj(raw);
    const at = num(e?.timestamp);
    if (!e || at === null) continue;
    const t = obj(e.tokenUsage);
    events.push({
      id: str(e.usageEventId),
      at,
      conversationId: str(e.conversationId),
      model: str(e.model),
      cents: num(e.chargedCents) ?? num(t?.totalCents) ?? 0,
      input: num(t?.inputTokens) ?? 0,
      output: num(t?.outputTokens) ?? 0,
      cacheRead: num(t?.cacheReadTokens) ?? 0,
      cacheWrite: num(t?.cacheWriteTokens) ?? 0,
    });
  }
  return { events, total: num(b?.totalUsageEventsCount) ?? events.length };
}

// ---------- tokens ----------

/** Where a token comes from. Each is read fresh on every call: cursor-agent and the IDE keep theirs refreshed. */
export type TokenSource = () => Promise<string | null>;

/** cursor-agent's login, in the Keychain. Read with `security`, the way Omni reads its own secrets. */
export const keychainToken: TokenSource = () =>
  new Promise((resolve) => {
    execFile('security', ['find-generic-password', '-s', 'cursor-access-token', '-w'], { timeout: 5000 }, (err, stdout) => {
      const v = err ? '' : String(stdout).trim();
      resolve(v || null);
    });
  });

export const IDE_STATE_DB = join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');

/** The Cursor IDE's session, read-only from its state database. */
export function ideToken(file = IDE_STATE_DB): TokenSource {
  return async () => {
    if (!existsSync(file)) return null;
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'").get() as { value?: unknown } | undefined;
      const v = typeof row?.value === 'string' ? row.value.trim() : '';
      return v || null;
    } catch {
      return null;
    } finally {
      try {
        db?.close();
      } catch {}
    }
  };
}

// ---------- the client ----------

export interface DashboardDeps {
  fetch?: typeof fetch;
  /** Tried in order: the next one only when the one before has no token or is refused. */
  tokens?: TokenSource[];
}

export interface CursorDashboard {
  planUsage(): Promise<CursorPlanUsage | null>;
  /** Events from `since` (epoch ms) to now, newest first. Null when they can't be read. */
  usageEvents(since: number): Promise<CursorUsageEvent[] | null>;
}

/** The parsed body of one call, trying each token source until one is accepted. Null on any failure. */
async function rpc(deps: Required<DashboardDeps>, method: string, body: unknown): Promise<unknown | null> {
  for (const source of deps.tokens) {
    const token = await source().catch(() => null);
    if (!token) continue;
    let res: Response;
    try {
      res = await deps.fetch(`${BASE}/${method}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'connect-protocol-version': '1' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    // Refused: this token is stale or the wrong kind. The next source may have a good one.
    if (res.status === 401 || res.status === 403) continue;
    if (!res.ok) return null;
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  return null;
}

export function cursorDashboard(deps: DashboardDeps = {}): CursorDashboard {
  const d: Required<DashboardDeps> = { fetch: deps.fetch ?? fetch, tokens: deps.tokens ?? [keychainToken, ideToken()] };
  return {
    async planUsage() {
      return mapPlanUsage(await rpc(d, 'GetCurrentPeriodUsage', {}));
    },
    async usageEvents(since) {
      const events: CursorUsageEvent[] = [];
      const end = String(Date.now());
      for (let page = 1; page <= MAX_PAGES; page++) {
        const mapped = mapUsageEvents(await rpc(d, 'GetFilteredUsageEvents', { startDate: String(Math.floor(since)), endDate: end, page, pageSize: PAGE_SIZE }));
        if (!mapped) return page === 1 ? null : events;
        events.push(...mapped.events);
        if (!mapped.events.length || events.length >= mapped.total) break;
      }
      return events;
    },
  };
}
