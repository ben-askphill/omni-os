import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetUsageLogs, scanUsageLogs, usageRecords } from '../usage-logs.ts';
import { buildTable, lookup, priceTable, resetPriceTable } from '../usage-pricing.ts';
import { aggregateUsage, cursorRateModel, resetInsights } from '../insights.ts';
import { app } from '../app.ts';
import { paths } from '../config.ts';
import { rangeDays, tokensOf } from '@omni/shared/insights.ts';

const TZ = 'Europe/Amsterdam';
const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const claudeLine = (o: { id: string; req: string; at: string; session?: string; model?: string; input?: number; read?: number; write?: number; out?: number }) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: o.at,
    sessionId: o.session ?? 's1',
    requestId: o.req,
    message: { id: o.id, model: o.model ?? 'claude-opus-5-5', usage: { input_tokens: o.input ?? 2, cache_read_input_tokens: o.read ?? 1000, cache_creation_input_tokens: o.write ?? 100, output_tokens: o.out ?? 50 } },
  }) + '\n';

const codexLines = (at: string) =>
  [
    { timestamp: at, type: 'session_meta', payload: { id: 'cx1' } },
    { timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 1 }, last_token_usage: { input_tokens: 1, output_tokens: 0 } } } },
    { timestamp: at, type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
    { timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 1100 }, last_token_usage: { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 100 } } } },
    // The same total again: a repeat, not a new request.
    { timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 1100 }, last_token_usage: { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 100 } } } },
  ]
    .map((l) => JSON.stringify(l))
    .join('\n') + '\n';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'omni-usage-'));
  process.env.CLAUDE_CONFIG_DIR = join(home, 'claude');
  process.env.CODEX_HOME = join(home, 'codex');
  mkdirSync(join(home, 'claude', 'projects', 'p'), { recursive: true });
  mkdirSync(join(home, 'codex', 'sessions', '2026', '11', '12'), { recursive: true });
  resetUsageLogs();
  resetInsights();
});
afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CODEX_HOME;
});

describe('session log scan', () => {
  it('reads Claude and Codex logs the way T3 Code does', async () => {
    const at = iso(60_000);
    const file = join(home, 'claude', 'projects', 'p', 's1.jsonl');
    // One request logged on two content blocks, a user line, and a synthetic message: one record.
    writeFileSync(
      file,
      claudeLine({ id: 'm1', req: 'r1', at }) +
        claudeLine({ id: 'm1', req: 'r1', at }) +
        JSON.stringify({ type: 'user', timestamp: at, message: { content: 'usage' } }) +
        '\n' +
        claudeLine({ id: 'm2', req: 'r2', at, model: '<synthetic>' }),
    );
    writeFileSync(join(home, 'codex', 'sessions', '2026', '11', '12', 'rollout-x.jsonl'), codexLines(at));
    await scanUsageLogs();
    const { records, complete } = usageRecords();
    expect(complete).toBe(true);
    const u = aggregateUsage(records, rangeDays('today', NOW, TZ), TZ, () => null);
    expect(u.sources.map((s) => [s.source, s.uncached, s.cached, s.cacheWrite, s.output, s.sessions])).toEqual([
      ['claude-code', 2, 1000, 100, 50, 1],
      ['codex', 400, 600, 0, 100, 1],
    ]);
    expect(u.total.unpriced).toBe(2);
  });

  it('reads on from where it stopped when a log grows, and keeps what it read in the cache file', async () => {
    const file = join(home, 'claude', 'projects', 'p', 's1.jsonl');
    writeFileSync(file, claudeLine({ id: 'm1', req: 'r1', at: iso(60_000) }));
    await scanUsageLogs();
    appendFileSync(file, claudeLine({ id: 'm2', req: 'r2', at: iso(30_000), out: 7 }) + '{"type":"assistant","usage"'); // a half-written line
    await scanUsageLogs();
    expect(usageRecords().records.map((r) => r.output)).toEqual([50, 7]);
    appendFileSync(file, ',"broken":true}\n' + claudeLine({ id: 'm3', req: 'r3', at: iso(10_000), out: 9 }));
    // A restart: the cache on disk is all it has.
    resetUsageLogs();
    await scanUsageLogs();
    expect(usageRecords().records.map((r) => r.output)).toEqual([50, 7, 9]);
  });

  it('leaves out days outside the range', async () => {
    const file = join(home, 'claude', 'projects', 'p', 's1.jsonl');
    writeFileSync(file, claudeLine({ id: 'old', req: 'r', at: iso(10 * 86_400_000) }) + claudeLine({ id: 'new', req: 'r', at: iso(60_000) }));
    await scanUsageLogs();
    const { records } = usageRecords();
    expect(tokensOf(aggregateUsage(records, rangeDays('7d', NOW, TZ), TZ, () => null).total)).toBe(1152);
    expect(tokensOf(aggregateUsage(records, rangeDays('30d', NOW, TZ), TZ, () => null).total)).toBe(2304);
  });
});

describe('pricing', () => {
  const doc = {
    'claude-opus-5-5': { input_cost_per_token: 4e-6, output_cost_per_token: 2e-5, cache_read_input_token_cost: 2e-7, cache_creation_input_token_cost: 5e-6 },
    'openai/gpt-x': { input_cost_per_token: 2e-6, output_cost_per_token: 1e-5, input_cost_per_token_priority: 4e-6, output_cost_per_token_priority: 2e-5 },
  };

  it('finds a model by its bare name, prices fast requests at priority rates, and never prices a family alias', () => {
    const table = buildTable(doc);
    expect(lookup(table, 'gpt-x', 'standard')).toEqual({ input: 2e-6, output: 1e-5, cacheRead: 2e-6, cacheWrite: 2e-6 });
    expect(lookup(table, 'gpt-x', 'fast')?.input).toBe(4e-6);
    expect(lookup(table, 'Claude-Opus-5-5[1m]', 'standard')?.cacheRead).toBe(2e-7);
    expect(lookup(table, 'opus', 'standard')).toBeNull();
  });

  it('adds cost and cache savings from the totals, and uses a billed amount as is', () => {
    const table = buildTable(doc);
    const base = { ts: NOW, session: 's', key: null, speed: 'standard' as const };
    const u = aggregateUsage(
      [
        { ...base, source: 'claude-code', model: 'claude-opus-5-5', uncached: 1000, cached: 10_000, cacheWrite: 0, output: 100, billed: null },
        { ...base, source: 'cursor', model: 'cursor-claude-opus-5-5-thinking-high', uncached: 10, cached: 0, cacheWrite: 0, output: 0, billed: 0.5 },
      ],
      rangeDays('today', NOW, TZ),
      TZ,
      (m, s, sp) => lookup(table, s === 'cursor' ? cursorRateModel(m) : m, sp),
    );
    expect(u.total.cost).toBeCloseTo(1000 * 4e-6 + 10_000 * 2e-7 + 100 * 2e-5 + 0.5, 10);
    expect(u.total.savings).toBeCloseTo(10_000 * (4e-6 - 2e-7), 10);
    expect(u.sources.find((s) => s.source === 'cursor')?.cost).toBe(0.5);
  });

  it('fetches the table once and works from the saved copy', async () => {
    rmSync(join(paths.data, 'usage-model-rates.json'), { force: true });
    resetPriceTable();
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response(JSON.stringify(doc));
    }) as unknown as typeof fetch;
    expect((await priceTable(f))?.table.has('gpt-x')).toBe(true);
    resetPriceTable();
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect((await priceTable(failing))?.table.has('gpt-x')).toBe(true);
    expect(calls).toBe(1);
  });
});

describe('GET /api/insights', () => {
  it('refuses an unknown range or time zone', async () => {
    expect((await app.request('/api/insights?range=year')).status).toBe(400);
    expect((await app.request('/api/insights?range=7d&tz=Mars/Base')).status).toBe(400);
  });

  it('answers with every section for the range', async () => {
    writeFileSync(join(home, 'claude', 'projects', 'p', 's1.jsonl'), claudeLine({ id: 'm1', req: 'r1', at: iso(60_000) }));
    await scanUsageLogs();
    const res = await app.request(`/api/insights?range=7d&tz=${encodeURIComponent(TZ)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.range).toBe('7d');
    expect(body.usage.days).toHaveLength(7);
    expect(body.usage.total.sessions).toBe(1);
    expect(body.automations).toMatchObject({ total: expect.any(Number) });
  });
});
