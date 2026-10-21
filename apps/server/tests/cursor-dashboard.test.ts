import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cursorDashboard, ideToken, mapPlanUsage, mapUsageEvents, type TokenSource } from '../harness/cursor/dashboard.ts';

// Cursor's undocumented dashboard client, against recorded responses. No test calls the real API.
const fixture = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8'));
const PERIOD = fixture('cursor-period-usage.json');
const EVENTS = fixture('cursor-usage-events.json');

type Call = { url: string; auth: string | null; body: any };
function fakeFetch(answer: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const call = { url, auth: new Headers(init.headers).get('authorization'), body: JSON.parse(String(init.body)) };
    calls.push(call);
    return answer(call, calls.length);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const token = (v: string | null): TokenSource => async () => v;

describe('mapPlanUsage', () => {
  it('maps the current period: percent used, both buckets, spend and the cycle in epoch seconds', () => {
    expect(mapPlanUsage(PERIOD)).toEqual({
      totalPercent: 43.08091603053435,
      autoPercent: 39.485,
      apiPercent: 82.30909090909091,
      spendCents: 56_436,
      includedCents: 7000,
      bonusCents: 49_436,
      cycleStart: 1_790_233_029,
      cycleEnd: 1_792_825_029,
    });
  });

  it('is null without the percent used or the cycle end, and for anything that is not the shape', () => {
    expect(mapPlanUsage({ ...PERIOD, planUsage: { ...PERIOD.planUsage, totalPercentUsed: undefined } })).toBeNull();
    expect(mapPlanUsage({ ...PERIOD, billingCycleEnd: 'soon' })).toBeNull();
    expect(mapPlanUsage({ billingCycleEnd: '1792825029000' })).toBeNull();
    for (const bad of [null, undefined, 'x', 42, [], { planUsage: [] }]) expect(mapPlanUsage(bad)).toBeNull();
  });

  it('leaves out what is missing, and takes the limit when included spend is absent', () => {
    const p = mapPlanUsage({ billingCycleEnd: 1_792_825_029_000, planUsage: { totalPercentUsed: 12, limit: 2000 } })!;
    expect(p).toMatchObject({ totalPercent: 12, autoPercent: null, apiPercent: null, spendCents: null, includedCents: 2000, cycleStart: null });
  });
});

describe('mapUsageEvents', () => {
  it('maps each event: conversation, model, exact cents and tokens', () => {
    const m = mapUsageEvents(EVENTS)!;
    expect(m.total).toBe(3);
    expect(m.events[0]).toEqual({
      id: 'aa41b280-4910-4411-b719-d5051bb205af',
      at: 1_792_586_704_072,
      conversationId: '37d76c85-aaf4-4505-8daf-6ef312736139',
      model: 'default',
      cents: 4.7802,
      input: 22_876,
      output: 11,
      cacheRead: 3968,
      cacheWrite: 0,
    });
    expect(m.events[2].cacheWrite).toBe(724);
  });

  it('skips events without a timestamp, reads "null" strings as missing, and falls back to totalCents', () => {
    const m = mapUsageEvents({
      usageEventsDisplay: [{ model: 'x' }, { timestamp: '1', conversationId: 'null', tokenUsage: { totalCents: 2.5 } }, 'junk'],
    })!;
    expect(m.events).toEqual([{ id: null, at: 1, conversationId: null, model: null, cents: 2.5, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }]);
  });

  it('reads an empty period ({}) as no events, and a wrong shape as null', () => {
    expect(mapUsageEvents({})).toEqual({ events: [], total: 0 });
    expect(mapUsageEvents({ usageEventsDisplay: 'nope' })).toBeNull();
    expect(mapUsageEvents({ something: 1 })).toBeNull();
    expect(mapUsageEvents(null)).toBeNull();
  });
});

describe('cursorDashboard', () => {
  it('posts to the Connect endpoint with the bearer token', async () => {
    const { f, calls } = fakeFetch(() => json(PERIOD));
    const p = await cursorDashboard({ fetch: f, tokens: [token('tok-cli')] }).planUsage();
    expect(p?.totalPercent).toBeCloseTo(43.08, 2);
    expect(calls).toEqual([{ url: 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage', auth: 'Bearer tok-cli', body: {} }]);
  });

  it('falls back to the next token on a 401 or 403, and skips a source with no token', async () => {
    const { f, calls } = fakeFetch((c) => (c.auth === 'Bearer tok-ide' ? json(PERIOD) : json({ code: 'unauthenticated' }, 401)));
    const p = await cursorDashboard({ fetch: f, tokens: [token(null), token('tok-cli'), token('tok-ide')] }).planUsage();
    expect(p).not.toBeNull();
    expect(calls.map((c) => c.auth)).toEqual(['Bearer tok-cli', 'Bearer tok-ide']);
  });

  it('is null when every token is refused, or there is none', async () => {
    const { f } = fakeFetch(() => json({}, 401));
    expect(await cursorDashboard({ fetch: f, tokens: [token('a'), token('b')] }).planUsage()).toBeNull();
    const never = fakeFetch(() => json(PERIOD));
    expect(await cursorDashboard({ fetch: never.f, tokens: [token(null), async () => Promise.reject(new Error('locked'))] }).planUsage()).toBeNull();
    expect(never.calls).toEqual([]);
  });

  it('is null on a server error, a network failure, a body that is not JSON, or a changed shape', async () => {
    const tokens = [token('t')];
    const cases: (() => Response)[] = [
      () => json({ error: 'boom' }, 500),
      () => {
        throw new TypeError('fetch failed');
      },
      () => new Response('<html>', { status: 200 }),
      () => json({ planUsage: { percent: 43 } }),
    ];
    for (const answer of cases) expect(await cursorDashboard({ fetch: fakeFetch(answer).f, tokens }).planUsage()).toBeNull();
    // A 500 is not a token problem: the next source isn't tried.
    const { f, calls } = fakeFetch(() => json({}, 500));
    await cursorDashboard({ fetch: f, tokens: [token('a'), token('b')] }).planUsage();
    expect(calls).toHaveLength(1);
  });

  it('reads usage events from a start time, page by page until the total is reached', async () => {
    const page = (n: number) => ({ totalUsageEventsCount: 3, usageEventsDisplay: n === 1 ? EVENTS.usageEventsDisplay.slice(0, 2) : EVENTS.usageEventsDisplay.slice(2) });
    const { f, calls } = fakeFetch((c) => json(page(c.body.page)));
    const events = await cursorDashboard({ fetch: f, tokens: [token('t')] }).usageEvents(1_792_500_000_000);
    expect(events?.map((e) => e.conversationId)).toEqual(['37d76c85-aaf4-4505-8daf-6ef312736139', '37d76c85-aaf4-4505-8daf-6ef312736139', '303b4335-0dae-4e37-93fa-1b3d4e0eb9d1']);
    expect(calls.map((c) => c.body.page)).toEqual([1, 2]);
    expect(calls[0].url).toMatch(/GetFilteredUsageEvents$/);
    expect(calls[0].body).toMatchObject({ startDate: '1792500000000', pageSize: 1000 });
  });

  it('is null when the first page fails, and keeps what it has when a later one does', async () => {
    expect(await cursorDashboard({ fetch: fakeFetch(() => json({}, 401)).f, tokens: [token('t')] }).usageEvents(0)).toBeNull();
    const { f } = fakeFetch((_c, n) => (n === 1 ? json({ totalUsageEventsCount: 9, usageEventsDisplay: EVENTS.usageEventsDisplay.slice(0, 1) }) : json({}, 502)));
    expect(await cursorDashboard({ fetch: f, tokens: [token('t')] }).usageEvents(0)).toHaveLength(1);
  });
});

describe('ideToken', () => {
  it("reads the IDE's access token read-only, and is null when the database or the row is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cursor-state-'));
    const file = join(dir, 'state.vscdb');
    expect(await ideToken(file)()).toBeNull();
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
    expect(await ideToken(file)()).toBeNull();
    db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run('cursorAuth/accessToken', 'ide-tok');
    db.close();
    expect(await ideToken(file)()).toBe('ide-tok');
  });
});
