import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { createExternalServer, callOver } from '@omni/mcp/external/tools.ts';
import { mcpHttp } from '@omni/mcp/external/http.ts';

// End-to-end verification of compact JSON serialization and default-key stripping (#1006) across the Conductor MCP
// server (apps/mcp/omni.ts) and the external MCP server (apps/mcp/external/tools.ts), seeded at the context-token
// audit's data scale (24 channels / 76 folders, 14 automations, 338 PRs, 20 threads, 40 search hits, 5 local harnesses).

const ROOT = join(import.meta.dirname, '../../..');

// ---------- audit-scale fixture data ----------

const channelsFixture = Array.from({ length: 24 }, (_, i) => {
  const folderCount = i < 4 ? 0 : i < 12 ? 3 : 4; // 0*4 + 3*8 + 4*12 = 72; add 4 to ch 23 -> 76 folders
  const n = i === 23 ? folderCount + 4 : folderCount;
  return {
    id: `channel-${String(i + 1).padStart(2, '0')}`,
    name: `Client Project ${i + 1}`,
    kind: i < 4 ? 'personal' : 'client',
    store_domain: i % 3 === 0 ? `store-${i + 1}.myshopify.com` : null,
    github_repo: i % 2 === 0 ? `org/project-repo-${i + 1}` : null,
    running: i < 2 ? 1 : 0,
    notes: i % 3 === 0 ? `Deployment notes and workflow rules for project ${i + 1}. Always run checks before pushing.` : null,
    access_level: i % 4 === 0 ? 'full' : null,
    access_default: 'ask',
    connector_access: {},
    folders: Array.from({ length: n }, (_, j) => ({
      id: `00000000-0000-4000-8000-${String(i * 100 + j).padStart(12, '0')}`,
      channel_id: `channel-${String(i + 1).padStart(2, '0')}`,
      name: `Workstream ${j + 1}`,
      count: j % 5 === 0 ? 0 : 4,
      running: 0,
      threads:
        j % 5 === 0
          ? []
          : [
              { title: `Implement feature slice ${j + 1} for client ${i + 1}` },
              { title: `Review pull request and fix edge cases in module ${j + 1}` },
              { title: `Investigate production issue reported on dashboard ${j + 1}` },
            ],
    })),
  };
});

const automationsFixture = Array.from({ length: 14 }, (_, i) => ({
  id: `automation-${String(i + 1).padStart(2, '0')}`,
  name: `Scheduled Automation ${i + 1}`,
  enabled: i % 3 !== 0,
  cron: i % 4 === 0 ? '' : '0 8 * * 1-5',
  on: i % 4 === 0 ? { event: 'pr_checks_failed', repo: 'org/project-repo-1' } : undefined,
  timezone: 'Europe/Amsterdam',
  next: i % 3 === 0 || i % 4 === 0 ? null : '2026-11-27T07:00:00.000Z',
  channel: `channel-${String((i % 8) + 1).padStart(2, '0')}`,
  role: i % 2 === 0 ? 'builder' : undefined,
  prompt: `Check status and summarize updates for automation ${i + 1}. `.repeat(3),
  runs:
    i % 3 === 0
      ? []
      : [1, 2, 3].map((k) => ({
          thread_id: `00000000-0000-4000-8000-${String(i * 10 + k).padStart(12, '0')}`,
          title: `Scheduled Automation ${i + 1} run ${k}`,
          trigger: i % 4 === 0 ? 'event' : 'cron',
          created_at: `2026-11-2${k}T07:00:00.000Z`,
          status: 'done',
        })),
}));

const prsFixture = {
  prs: Array.from({ length: 338 }, (_, i) => ({
    repo: `org/project-repo-${(i % 10) + 1}`,
    number: 500 - i,
    title: `feat: implement improvement #${500 - i} across module ${(i % 12) + 1}`,
    author: i % 7 === 0 ? null : { login: `dev-${(i % 5) + 1}` },
    state: i < 29 ? 'OPEN' : 'MERGED',
    isDraft: i < 3,
    labels: i % 4 === 0 ? ['enhancement', 'priority'] : [],
    url: `https://github.com/org/project-repo-${(i % 10) + 1}/pull/${500 - i}`,
    updatedAt: `2026-11-${String((i % 25) + 1).padStart(2, '0')}T12:00:00.000Z`,
    headRefName: `feat/change-${500 - i}`,
  })),
  failed: [],
};

const threadsFixture = Array.from({ length: 20 }, (_, i) => ({
  id: `00000000-0000-4000-9000-${String(i + 1).padStart(12, '0')}`,
  title: `Thread task ${i + 1}: update configuration and verify tests`,
  channel_id: `channel-${String((i % 6) + 1).padStart(2, '0')}`,
  folder_id: i % 3 === 0 ? `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` : null,
  role: i % 2 === 0 ? 'builder' : null,
  status: i === 0 ? 'running' : 'done',
  harness: 'claude-code',
  model: i % 2 === 0 ? 'claude-sonnet-5-5' : null,
  branch: i % 2 === 0 ? `omni/branch-${i + 1}` : null,
  pinned_at: i === 0 ? '2026-11-25T10:00:00.000Z' : null,
  delegating: i === 0,
  task_id: i % 3 === 0 ? `T-${1000 + i}` : null,
  updated_at: `2026-11-26T08:${String(i).padStart(2, '0')}:00.000Z`,
}));

const searchFixture = Array.from({ length: 40 }, (_, i) => ({
  thread_id: `00000000-0000-4000-a000-${String(i + 1).padStart(12, '0')}`,
  title: `Matched conversation ${i + 1} about deployment pipeline`,
  channel_id: `channel-${String((i % 10) + 1).padStart(2, '0')}`,
  status: 'done',
  updated_at: `2026-11-25T14:${String(i).padStart(2, '0')}:00.000Z`,
  snippet: i % 2 === 0 ? '' : `… checked the <mark>deployment</mark> pipeline and verified all tests pass for step ${i + 1} …`,
  event_id: i % 2 === 0 ? null : 10000 + i,
}));

const harnessesFixture = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    plan: 'Max',
    available: true,
    cap: 12,
    running: 1,
    capabilities: { steer: true, interrupt: true, remote: false, toolLimits: true },
    models: [
      { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'high', default: true, hidden: false, note: null },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', default: false, hidden: false, note: null },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: [], defaultEffort: null, default: false, hidden: false, note: null },
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    plan: 'Pro',
    available: true,
    cap: 8,
    running: 0,
    capabilities: { steer: true, interrupt: true, remote: false, toolLimits: true },
    models: [
      { id: 'gpt-6-1', label: 'GPT-6.1', efforts: ['low', 'medium', 'high'], defaultEffort: 'high', default: true, hidden: false, note: null },
      { id: 'gpt-5-4-mini', label: 'GPT-5.4 Mini', efforts: [], defaultEffort: null, default: false, hidden: true, note: null },
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    plan: 'Ultra',
    available: true,
    cap: 6,
    running: 0,
    capabilities: { steer: false, interrupt: true, remote: false, toolLimits: true },
    models: [
      { id: 'composer-2.5', label: 'Composer 2.5', efforts: [], defaultEffort: null, default: true, hidden: false, note: null },
    ],
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    plan: 'Google AI',
    available: true,
    cap: 4,
    running: 0,
    capabilities: { steer: true, interrupt: true, remote: false, toolLimits: false },
    models: [
      { id: 'gemini-4-neon', label: 'Gemini 4 Neon', efforts: ['low', 'high'], defaultEffort: 'high', default: true, hidden: false, note: null },
    ],
  },
  {
    id: 'cursor-cloud',
    name: 'Cursor Cloud',
    plan: null,
    available: false,
    fix: 'Add CURSOR_API_KEY in Settings',
    cap: null,
    running: 0,
    capabilities: { steer: false, interrupt: false, remote: true, toolLimits: false },
    models: [],
  },
];

function answer(method: string, rawUrl: string): [number, unknown] {
  const url = rawUrl.split('?')[0];
  if (method === 'GET' && url === '/api/channels') return [200, channelsFixture];
  if (method === 'GET' && url.startsWith('/api/channels/')) {
    const id = decodeURIComponent(url.slice('/api/channels/'.length));
    const hit = channelsFixture.find((c) => c.id === id);
    return hit ? [200, hit] : [404, { error: 'not found' }];
  }
  if (method === 'GET' && url === '/api/automations') return [200, automationsFixture];
  if (method === 'GET' && url === '/api/prs') return [200, prsFixture];
  if (method === 'GET' && url === '/api/threads') return [200, threadsFixture];
  if (method === 'GET' && url === '/api/search') return [200, searchFixture];
  if (method === 'GET' && url === '/api/harnesses') return [200, harnessesFixture];
  return [404, { error: `no fake for ${method} ${rawUrl}` }];
}

class McpClient {
  private id = 0;
  private waiting = new Map<number, (r: any) => void>();
  constructor(private child: ChildProcess) {
    createInterface({ input: child.stdout! }).on('line', (line) => {
      const msg = JSON.parse(line);
      this.waiting.get(msg.id)?.(msg);
    });
  }
  request(method: string, params: unknown = {}): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 20_000);
      this.waiting.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      });
      this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  close() {
    this.child.kill('SIGTERM');
  }
}

let api: Server;
let omni: McpClient;
let extHandler: (req: Request) => Promise<Response>;

const callOmni = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await omni.request('tools/call', { name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  expect(r.isError).toBeFalsy();
  const raw = r.content[0].text;
  return { raw, body: JSON.parse(raw) };
};

let rpcId = 0;
const callExternal = async (name: string, args: Record<string, unknown> = {}) => {
  const req = new Request('http://127.0.0.1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  const res = await extHandler(req);
  expect(res.status).toBe(200);
  const { result } = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } };
  expect(result.isError).toBeFalsy();
  const raw = result.content[0].text;
  return { raw, body: JSON.parse(raw) };
};

beforeAll(async () => {
  api = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const [status, body] = answer(req.method!, req.url!);
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    });
  });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  const base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  omni = new McpClient(
    spawn(join(ROOT, 'node_modules/.bin/tsx'), [join(ROOT, 'apps/mcp/omni.ts')], {
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', OMNI_URL: base, OMNI_TOKEN: 'test-token', OMNI_USER: 'Ben', OMNI_THREAD_ID: 'conductor-thread' },
      stdio: ['pipe', 'pipe', 'inherit'],
    }),
  );
  await omni.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  const call = callOver(async (path, init) => {
    const [status, body] = answer(init.method ?? 'GET', path);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  // Verify createExternalServer also constructs cleanly with the same call adapter.
  void createExternalServer;
  extHandler = mcpHttp(call);
}, 30_000);

afterAll(() => {
  omni?.close();
  api?.close();
});

const T = { timeout: 30_000 };

describe('compact JSON across Conductor and external MCP tools (#1006)', () => {
  it('emits compact JSON without pretty-print indentation and strips null, false and empty-array row defaults', T, async () => {
    const channels = await callOmni('list_channels');
    const automations = await callOmni('list_automations');
    const prs = await callOmni('list_pull_requests');
    const threads = await callOmni('list_threads');
    const search = await callOmni('search_history', { query: 'deployment' });
    const harnesses = await callOmni('list_harnesses');

    for (const [name, res] of [
      ['list_channels', channels],
      ['list_automations', automations],
      ['list_pull_requests', prs],
      ['list_threads', threads],
      ['search_history', search],
      ['list_harnesses', harnesses],
    ] as const) {
      expect(res.raw, `${name} must not be pretty-printed`).not.toMatch(/\n {2}/);
      expect(res.raw, `${name} must equal compact JSON.stringify`).toBe(JSON.stringify(res.body));
    }

    // list_channels returns a compact index by default (omits notes, folder trees, zero running and default access)
    // and drops empty recent arrays on the one-channel detail path (#1007).
    expect(channels.raw.length).toBeLessThan(3100);
    expect(channels.body[0]).not.toHaveProperty('folders');
    expect(channels.body[0]).not.toHaveProperty('folder_count');
    expect(channels.body[0]).not.toHaveProperty('notes');
    expect(channels.body[1]).not.toHaveProperty('store');
    expect(channels.body[1]).not.toHaveProperty('repo');
    expect(channels.body[1]).not.toHaveProperty('notes');
    expect(channels.body[1]).not.toHaveProperty('access');
    expect(channels.body[4].folder_count).toBe(3);
    const channelDetail = await callOmni('list_channels', { channel: 'channel-05' });
    expect(channelDetail.raw).toBe(JSON.stringify(channelDetail.body));
    const emptyFolder = channelDetail.body.folders.find((f: any) => f.threads === 0);
    expect(emptyFolder).toBeDefined();
    expect(emptyFolder).not.toHaveProperty('recent');

    // list_automations keeps enabled: false (absence would flip meaning) while dropping next: null and last_runs: [].
    const disabled = automations.body.find((a: any) => a.id === 'automation-01');
    expect(disabled.enabled).toBe(false);
    expect(disabled).not.toHaveProperty('next');
    expect(disabled).not.toHaveProperty('last_runs');

    // list_pull_requests drops author: null and labels: [] on rows, keeping top-level failed: [].
    expect(prs.body.failed).toEqual([]);
    const unlabeled = prs.body.prs.find((p: any) => p.number === 499);
    expect(unlabeled).not.toHaveProperty('labels');
    const noAuthor = prs.body.prs.find((p: any) => p.number === 500);
    expect(noAuthor).not.toHaveProperty('author');

    // list_threads drops delegating: false, role: null, task_id: null while keeping delegating: true.
    expect(threads.body[0].delegating).toBe(true);
    expect(threads.body[1]).not.toHaveProperty('delegating');
    expect(threads.body[1]).not.toHaveProperty('role');
    expect(threads.body[1]).not.toHaveProperty('task_id');

    // search_history defaults to 10 hits, drops UI-only event_id, and ensures every hit has a non-empty snippet.
    expect(search.body).toHaveLength(10);
    expect(search.body[0]).not.toHaveProperty('event_id');
    expect(search.body[1]).not.toHaveProperty('event_id');
    expect(search.body.every((h: any) => typeof h.snippet === 'string' && h.snippet.length > 0)).toBe(true);

    // list_harnesses keeps available and capability booleans that default to true (steer, interrupt, tool_limits),
    // drops remote: false and model defaults, and hoists shared efforts to the harness (#1006, #1011).
    const claude = harnesses.body.find((h: any) => h.id === 'claude-code');
    expect(claude.available).toBe(true);
    expect(claude.capabilities).toEqual({ steer: true, interrupt: true, tool_limits: true });
    expect(claude.efforts).toEqual(['low', 'medium', 'high']);
    expect(claude.models[1]).not.toHaveProperty('default');
    expect(claude.models[1]).not.toHaveProperty('hidden');
    expect(claude.models[1]).not.toHaveProperty('note');
    expect(claude.models[1]).not.toHaveProperty('efforts');
    expect(claude.models[2].efforts).toEqual([]);
    expect(claude.models[2]).not.toHaveProperty('default_effort');
    const agy = harnesses.body.find((h: any) => h.id === 'antigravity');
    expect(agy.capabilities.tool_limits).toBe(false);
    const cursor = harnesses.body.find((h: any) => h.id === 'cursor');
    expect(cursor.capabilities.steer).toBe(false);
    const cloud = harnesses.body.find((h: any) => h.id === 'cursor-cloud');
    expect(cloud.available).toBe(false);
    expect(cloud.capabilities).toEqual({ steer: false, interrupt: false, remote: true, tool_limits: false });
    expect(cloud).not.toHaveProperty('models');
    expect(cloud).not.toHaveProperty('plan');
    expect(cloud).not.toHaveProperty('cap');
  });

  it('emits compact JSON and strips row defaults on external MCP tools too', T, async () => {
    const extChannels = await callExternal('list_channels');
    const extAutomations = await callExternal('list_automations');
    const extPrs = await callExternal('list_pull_requests');
    const extThreads = await callExternal('list_threads');
    const extSearch = await callExternal('search_threads', { query: 'deployment' });
    const extHarnesses = await callExternal('list_harnesses');

    for (const [name, res] of [
      ['list_channels', extChannels],
      ['list_automations', extAutomations],
      ['list_pull_requests', extPrs],
      ['list_threads', extThreads],
      ['search_threads', extSearch],
      ['list_harnesses', extHarnesses],
    ] as const) {
      expect(res.raw, `external ${name} must not be pretty-printed`).not.toMatch(/\n {2}/);
      expect(res.raw, `external ${name} must equal compact JSON.stringify`).toBe(JSON.stringify(res.body));
    }

    expect(extAutomations.body.find((a: any) => a.id === 'automation-01').enabled).toBe(false);
    expect(extAutomations.body.find((a: any) => a.id === 'automation-01')).not.toHaveProperty('last_runs');
    expect(extHarnesses.body.find((h: any) => h.id === 'cursor-cloud').available).toBe(false);
    expect(extThreads.body[1]).not.toHaveProperty('pinned');
    expect(extThreads.body[1]).not.toHaveProperty('folder_id');
    expect(extSearch.body).toHaveLength(10);
    expect(extSearch.body[0]).not.toHaveProperty('event_id');
    expect(extSearch.body[1]).not.toHaveProperty('event_id');
    expect(extSearch.body.every((h: any) => typeof h.snippet === 'string' && h.snippet.length > 0)).toBe(true);
  });
});
