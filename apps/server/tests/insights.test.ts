import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetUsageLogs, scanUsageLogs, usageRecords } from '../usage-logs.ts';
import { buildTable, lookup, priceTable, resetPriceTable } from '../usage-pricing.ts';
import { aggregateUsage, cursorRateModel, resetInsights } from '../insights.ts';
import { app } from '../app.ts';
import { paths } from '../config.ts';
import { db } from '../db.ts';
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

  it('strips <metadata> from uploaded SVG channel icons while keeping icons on HTTP /api/insights', async () => {
    const chId = 'c2pa-icon-ch';
    const thId = 'c2pa-icon-thread';
    db.prepare('DELETE FROM threads WHERE id = ?').run(thId);
    db.prepare('DELETE FROM channels WHERE id = ?').run(chId);
    try {
      const c2paSvg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
        `<metadata><c2pa:manifest xmlns:c2pa="http://c2pa.org/manifest">${'M'.repeat(16_000)}</c2pa:manifest></metadata>` +
        '<circle cx="12" cy="12" r="10" fill="#283c62"/></svg>';
      const expected = 'svg:<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#283c62"/></svg>';
      const create = await app.request('/api/channels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: chId, name: 'C2PA Icon Channel', icon: `svg:${c2paSvg}` }),
      });
      expect(create.status).toBe(200);
      const created = (await create.json()) as { icon: string };
      expect(created.icon).toBe(expected);
      expect(created.icon.length).toBeLessThan(200);

      // HTTP /api/insights keeps channels[].icon for the Web UI (already stripped on upload).
      db.prepare(`INSERT INTO threads (id, channel_id, title, status, session_id, cwd) VALUES (?, ?, ?, 'done', 's', '/tmp')`).run(
        thId,
        chId,
        'Check icon',
      );
      resetInsights();
      const res = await app.request(`/api/insights?range=7d&tz=${encodeURIComponent(TZ)}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { channels: { id: string; icon: string | null }[] };
      expect(body.channels.find((c) => c.id === chId)?.icon).toBe(expected);
    } finally {
      db.prepare('DELETE FROM threads WHERE id = ?').run(thId);
      db.prepare('DELETE FROM channels WHERE id = ?').run(chId);
    }
  });
});

describe('insights MCP tool (#1010)', () => {
  const ROOT = join(import.meta.dirname, '../../..');
  const makeC2paIcon = (size: number) =>
    `svg:<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><metadata><c2pa:manifest xmlns:c2pa="http://c2pa.org/manifest">${'X'.repeat(size)}</c2pa:manifest></metadata><circle cx="12" cy="12" r="10" fill="#283c62"/></svg>`;

  // Audit-scale insights payload: 24 channels (two carrying ~15.8 KB C2PA SVG icons = ~31.6 KB total),
  // 30 usage days, 12 models, 3 sources, 3 top PRs, and today's automation runs (~47 KB pretty-printed).
  const auditInsights = {
    range: '30d',
    from: '2026-10-28',
    to: '2026-11-26',
    generated_at: '2026-11-26T08:00:00.000Z',
    done: 84,
    channels: Array.from({ length: 24 }, (_, i) => ({
      id: `channel-${String(i + 1).padStart(2, '0')}`,
      name: `Client Project ${i + 1}`,
      icon: i < 2 ? makeC2paIcon(15_600) : i % 3 === 0 ? 'icon:terminal' : null,
      threads: 24 - i,
    })),
    usage: {
      complete: true,
      total: { uncached: 4_200_000, cached: 95_000_000, cacheWrite: 12_500_000, output: 1_850_000, cost: 218.42, savings: 361.2, unpriced: 0, sessions: 312 },
      sources: [
        { source: 'claude-code', uncached: 2_500_000, cached: 70_000_000, cacheWrite: 10_000_000, output: 1_200_000, cost: 162.1, savings: 280.4, unpriced: 0, sessions: 210 },
        { source: 'codex', uncached: 1_200_000, cached: 20_000_000, cacheWrite: 2_000_000, output: 450_000, cost: 42.12, savings: 68.5, unpriced: 0, sessions: 72 },
        { source: 'cursor', uncached: 500_000, cached: 5_000_000, cacheWrite: 500_000, output: 200_000, cost: 14.2, savings: 12.3, unpriced: 0, sessions: 30 },
      ],
      models: Array.from({ length: 12 }, (_, i) => ({
        model: `model-family-${i + 1}`,
        source: i % 3 === 0 ? 'claude-code' : i % 3 === 1 ? 'codex' : 'cursor',
        uncached: 300_000 - i * 10_000,
        cached: 7_000_000 - i * 200_000,
        cacheWrite: 900_000 - i * 30_000,
        output: 120_000 - i * 5_000,
        cost: Number((18.5 - i * 1.1).toFixed(2)),
        savings: Number((28.4 - i * 1.5).toFixed(2)),
        unpriced: 0,
      })),
      days: Array.from({ length: 30 }, (_, i) => ({
        day: `2026-11-${String((i % 26) + 1).padStart(2, '0')}`,
        tokens: { 'claude-code': 2_800_000 + i * 50_000, codex: 750_000 + i * 10_000, cursor: 190_000 + i * 5_000 },
        cost: Number((7.25 + (i % 5) * 0.4).toFixed(2)),
      })),
      note: { logs: ['/home/user/.claude/projects', '/home/user/.codex/sessions'], prices: 'https://example.com/rates.json', cursor: 'read' },
    },
    prs: {
      open: 29,
      mine: 14,
      withChecks: 22,
      mergedFromThreads: 47,
      top: Array.from({ length: 3 }, (_, i) => ({
        repo: `org/project-repo-${i + 1}`,
        channel_id: `channel-0${i + 1}`,
        number: 500 - i,
        title: `feat: implement improvement #${500 - i} across module`,
        url: `https://github.com/org/project-repo-${i + 1}/pull/${500 - i}`,
        author: 'ben-askphill',
        state: 'OPEN',
        isDraft: false,
        updatedAt: '2026-11-26T07:30:00.000Z',
        checks: { passed: 6, failed: 0, pending: 0 },
        thread_id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      })),
      failed: [],
    },
    automations: {
      total: 14,
      scheduled: 9,
      onEvent: 3,
      paused: 2,
      today: Array.from({ length: 4 }, (_, i) => ({
        id: `auto-${i + 1}`,
        name: `Daily Automation ${i + 1}`,
        channel: `channel-0${i + 1}`,
        role: 'builder',
        at: `2026-11-26T0${i + 6}:00:00.000Z`,
      })),
    },
  };

  let api: Server;
  let child: ChildProcess;
  let nextId = 0;
  const waiting = new Map<number, (msg: any) => void>();

  const request = (method: string, params: unknown = {}): Promise<any> => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 20_000);
      waiting.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      });
      child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  };

  beforeAll(async () => {
    api = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        const pathname = new URL(req.url!, 'http://127.0.0.1').pathname;
        res.statusCode = pathname === '/api/insights' ? 200 : 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(pathname === '/api/insights' ? auditInsights : { error: 'not found' }));
      });
    });
    api.listen(0, '127.0.0.1');
    await once(api, 'listening');
    const base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    // insights is on omni-admin (apps/mcp/core-tools.ts).
    child = spawn(join(ROOT, 'node_modules/.bin/tsx'), [join(ROOT, 'apps/mcp/omni.ts'), 'admin'], {
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', OMNI_URL: base, OMNI_TOKEN: 'test-token', OMNI_USER: 'Ben', OMNI_THREAD_ID: 'conductor-thread' },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    createInterface({ input: child.stdout! }).on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined) waiting.get(msg.id)?.(msg);
      } catch {}
    });
    await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  }, 30_000);

  afterAll(() => {
    child?.kill('SIGTERM');
    api?.close();
  });

  it('drops channels[].icon and stays under 10K chars at audit scale', { timeout: 30_000 }, async () => {
    const baselinePretty = JSON.stringify(auditInsights, null, 2);
    expect(baselinePretty.length).toBeGreaterThan(45_000);

    const res = (await request('tools/call', { name: 'insights', arguments: { range: '30d' } })) as { isError?: boolean; content: { text: string }[] };
    expect(res.isError).toBeFalsy();
    const raw = res.content[0].text;
    const body = JSON.parse(raw);

    expect(raw.length).toBeLessThan(10_000);
    expect(raw).not.toContain('<svg');
    expect(raw).not.toContain('c2pa');
    expect(body.channels).toHaveLength(24);
    for (const ch of body.channels) {
      expect(ch).toEqual({ id: expect.any(String), name: expect.any(String), threads: expect.any(Number) });
      expect('icon' in ch).toBe(false);
    }
    expect(body.usage.days).toHaveLength(30);
    expect(body.prs.top).toHaveLength(3);
  });
});
