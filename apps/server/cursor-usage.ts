// Cursor's plan usage and each Cursor thread's tokens and cost. Tokens come from every turn's result; the
// plan's monthly cycle and the exact cents per thread come from the dashboard client (harness/cursor/dashboard.ts),
// read every 15 minutes with the catalog refresh and shortly after each Cursor turn. A failed read keeps the last
// good one for a while, then shows "no data".
import { config } from './config.ts';
import { db } from './db.ts';
import { recordSpend, threadSpend } from './context.ts';
import { clearUsage, recordUsage, usageFor } from './usage.ts';
import type { CursorTurnUsage, ThreadSpend } from '@omni/shared/context-meter.ts';
import { cursorDashboard, type CursorDashboard, type CursorPlanUsage, type CursorUsageEvent } from './harness/cursor/dashboard.ts';
import type { Usage } from './stream.ts';

/** A plan reading older than this, with every read since failing, is dropped to "no data". */
const STALE_MS = 60 * 60 * 1000;
/** Threads whose cost is read: Cursor threads touched this recently. Their events are read from when they began. */
const ACTIVE_MS = 7 * 24 * 60 * 60 * 1000;
/** Never ask for more than this much history. */
const MAX_HISTORY_MS = 35 * 24 * 60 * 60 * 1000;
/** After a turn: a first read once Cursor has billed it, and a second for events that land late. */
const AFTER_TURN_MS = [4_000, 90_000];

let dashboard: CursorDashboard | null = config.cursorDashboard ? cursorDashboard() : null;
/** Tests swap in a fake. */
export function setCursorDashboard(d: CursorDashboard) {
  dashboard = d;
}

// ---------- plan usage ----------

/** The cycle as Omni's usage record: a monthly window, 0 to 1. */
export function planToUsage(p: CursorPlanUsage, now = new Date()): Usage {
  const frac = (pct: number | null) => (pct === null ? undefined : Math.round(Math.max(0, Math.min(100, pct)) * 100) / 10_000);
  return {
    monthly: {
      utilization: frac(p.totalPercent)!,
      resetsAt: p.cycleEnd,
      ...(p.cycleStart !== null && { startsAt: p.cycleStart }),
      ...(p.autoPercent !== null && { auto: frac(p.autoPercent) }),
      ...(p.apiPercent !== null && { api: frac(p.apiPercent) }),
      ...(p.spendCents !== null && { spendCents: p.spendCents }),
      ...(p.includedCents !== null && { includedCents: p.includedCents }),
      ...(p.bonusCents !== null && { bonusCents: p.bonusCents }),
    },
    updated_at: now.toISOString(),
  };
}

export async function refreshCursorPlan(now = new Date()): Promise<void> {
  if (!dashboard) return;
  const plan = await dashboard.planUsage().catch(() => null);
  if (plan) return recordUsage('cursor', planToUsage(plan, now));
  const last = usageFor('cursor');
  if (last && (!last.updated_at || now.getTime() - Date.parse(last.updated_at) > STALE_MS)) clearUsage('cursor');
}

// ---------- per-thread tokens and cost ----------

/** Add one turn's tokens to the thread's totals. The cost stays as last read until the next read. */
export function addCursorTurn(threadId: string, u: CursorTurnUsage): ThreadSpend {
  const prev = threadSpend(threadId) ?? { turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cents: null };
  const next: ThreadSpend = {
    ...prev,
    turns: prev.turns + 1,
    input: prev.input + u.inputTokens,
    output: prev.output + u.outputTokens,
    cacheRead: prev.cacheRead + u.cacheReadTokens,
    cacheWrite: prev.cacheWrite + u.cacheWriteTokens,
  };
  recordSpend(threadId, next);
  return next;
}

/** Cents per conversation, over the events read. */
export function centsByConversation(events: CursorUsageEvent[]): Map<string, number> {
  const out = new Map<string, number>();
  const seen = new Set<string>();
  for (const e of events) {
    if (!e.conversationId) continue;
    if (e.id) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
    }
    out.set(e.conversationId, (out.get(e.conversationId) ?? 0) + e.cents);
  }
  return out;
}

/** Read the events since the oldest active Cursor thread began, and set each thread's exact cost. */
export async function refreshCursorCosts(now = new Date()): Promise<void> {
  const rows = db
    .prepare(`SELECT id, session_id, created_at FROM threads WHERE harness = 'cursor' AND has_run = 1 AND updated_at >= ?`)
    .all(new Date(now.getTime() - ACTIVE_MS).toISOString()) as { id: string; session_id: string; created_at: string }[];
  if (!dashboard || !rows.length) return;
  const oldest = Math.min(...rows.map((r) => Date.parse(r.created_at)).filter(Number.isFinite));
  const since = Math.max(now.getTime() - MAX_HISTORY_MS, (Number.isFinite(oldest) ? oldest : now.getTime()) - 60_000);
  const events = await dashboard.usageEvents(since).catch(() => null);
  if (!events) return;
  const cents = centsByConversation(events);
  for (const r of rows) {
    const sum = cents.get(r.session_id);
    if (sum === undefined) continue;
    // Cursor bills fractions of a cent; four places keeps float noise out.
    const c = Math.round(sum * 10_000) / 10_000;
    const prev = threadSpend(r.id) ?? { turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cents: null };
    if (prev.cents !== null && Math.abs(prev.cents - c) < 1e-6) continue;
    recordSpend(r.id, { ...prev, cents: c, billedAt: now.toISOString() });
  }
}

/** The plan and the costs together: the 15-minute refresh and the after-turn read. */
export async function refreshCursorUsage(): Promise<void> {
  await Promise.all([refreshCursorPlan(), refreshCursorCosts()]).catch(() => {});
}

const pending: ReturnType<typeof setTimeout>[] = [];
/** A Cursor turn ended: read again shortly, so the card and the thread's cost catch up. Repeats fold into one. */
export function afterCursorTurn() {
  for (const t of pending.splice(0)) clearTimeout(t);
  for (const ms of AFTER_TURN_MS) {
    const t = setTimeout(() => void refreshCursorUsage(), ms);
    t.unref?.();
    pending.push(t);
  }
}
