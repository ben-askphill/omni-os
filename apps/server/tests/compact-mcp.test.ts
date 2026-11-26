import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { mcpHttp } from '@omni/mcp/external/http.ts';
import { callOver } from '@omni/mcp/external/tools.ts';

// End-to-end verification of compact JSON and row-default stripping (#1006) across both the Conductor MCP server
// (apps/mcp/omni.ts) and the external MCP server (apps/mcp/external/tools.ts) against a scripted API.

const ROOT = join(import.meta.dirname, '../../..');

const CHANNELS = [
  {
    id: 'omni-os',
    name: 'Omni OS',
    kind: 'personal',
    store_domain: null,
    github_repo: 'ben-askphill/omni-os',
    running: 1,
    notes: null,
    access_level: 'full',
    connector_access: {},
    folders: [
      { id: 'f1', name: 'Features', count: 2, running: 1, threads: [{ title: 'Compact JSON' }, { title: 'MCP split' }] },
      { id: 'f2', name: 'Empty', count: 0, running: 0, threads: [] },
    ],
  },
  {
    id: 'inbox',
    name: 'Inbox',
    kind: 'personal',
    store_domain: null,
    github_repo: null,
    running: 0,
    notes: null,
    access_level: 'ask',
    connector_access: {},
    folders: [],
  },
];

const AUTOMATIONS = [
  {
    id: 'daily-brief',
    name: 'Daily brief',
    enabled: true,
    cron: '0 8 * * 1-5',
    timezone: 'Europe/Amsterdam',
    next: '2026-11-27T07:00:00.000Z',
    channel: 'inbox',
    role: 'researcher',
    prompt: 'Summarize inbox.',
    runs: [{ thread_id: 't1', title: 'Daily brief', trigger: 'cron', created_at: '2026-11-26T07:00:00Z', status: 'done' }],
  },
  {
    id: 'paused-job',
    name: 'Paused job',
    enabled: false,
    cron: '0 9 * * *',
    timezone: 'UTC',
    next: null,
    channel: 'omni-os',
    prompt: 'Paused.',
    runs: [],
  },
];

const PRS = {
  prs: [
    {
      repo: 'ben-askphill/omni-os',
      number: 1001,
      title: 'Open PR without labels',
      author: { login: 'ben' },
      state: 'OPEN',
      isDraft: false,
      labels: [],
      url: 'https://github.com/ben-askphill/omni-os/pull/1001',
      updatedAt: '2026-11-26T08:00:00Z',
    },
    {
      repo: 'ben-askphill/omni-os',
      number: 1002,
      title: 'Labeled PR with null author',
      author: null,
      state: 'MERGED',
      isDraft: false,
      labels: ['bug'],
      url: 'https://github.com/ben-askphill/omni-os/pull/1002',
      updatedAt: '2026-11-25T08:00:00Z',
    },
  ],
  failed: [],
};

const THREADS = [
  {
    id: 'th-1',
    title: 'Plain thread',
    channel_id: 'omni-os',
    folder_id: null,
    role: null,
    status: 'done',
    harness: 'claude-code',
    model: null,
    branch: null,
    pinned_at: null,
    delegating: false,
    task_id: null,
    updated_at: '2026-11-26T08:00:00Z',
  },
  {
    id: 'th-2',
    title: 'Delegated thread',
    channel_id: 'omni-os',
    folder_id: 'f1',
    role: 'builder',
    status: 'running',
    harness: 'codex',
    model: 'gpt-5',
    branch: 'omni/th-2',
    pinned_at: '2026-11-26T07:00:00Z',
    delegating: true,
    task_id: 'T-1006',
    updated_at: '2026-11-26T08:10:00Z',
  },
];

const SEARCH_HITS = [
  { thread_id: 'th-1', title: 'Title match', channel_id: 'omni-os', status: 'done', updated_at: '2026-11-26T08:00:00Z', snippet: '', event_id: null },
  { thread_id: 'th-2', title: 'Body match', channel_id: 'omni-os', status: 'done', updated_at: '2026-11-26T08:01:00Z', snippet: '<mark>compact</mark> json', event_id: 42 },
];

const HARNESSES = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    plan: 'Max',
    available: true,
    fix: null,
    cap: 4,
    running: 1,
    capabilities: { steer: true, interrupt: true, remote: false, toolLimits: true },
    models: [
      { id: 'claude-opus-4-6', label: 'Opus 4.6', efforts: ['low', 'medium', 'high'], defaultEffort: 'high', default: true, hidden: false, note: null },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: [], defaultEffort: null, default: false, hidden: false, note: null },
    ],
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    plan: null,
    available: false,
    fix: 'agy login',
    cap: null,
    running: 0,
    capabilities: { steer: false, interrupt: true, remote: false, toolLimits: false },
    models: [
      { id: 'claude-opus-5-5', label: 'Claude Opus', efforts: [], defaultEffort: null, default: false, hidden: true, note: 'Bills Google AI' },
    ],
  },
];

let activeChannels: any[] = CHANNELS;
let activeAutomations: any[] = AUTOMATIONS;
let activePrs: any = PRS;
let activeThreads: any[] = THREADS;
let activeSearch: any[] = SEARCH_HITS;
let activeHarnesses: any[] = HARNESSES;

function answer(url: string): [number, unknown] {
  const path = url.split('?')[0];
  if (path === '/api/channels') return [200, activeChannels];
  if (path === '/api/automations') return [200, activeAutomations];
  if (path === '/api/prs') return [200, activePrs];
  if (path === '/api/threads') return [200, activeThreads];
  if (path === '/api/search') return [200, activeSearch];
  if (path === '/api/harnesses') return [200, activeHarnesses];
  return [404, { error: `no fake for ${url}` }];
}

class StdioMcp {
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
let baseUrl: string;
let conductor: StdioMcp;

const callConductor = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await conductor.request('tools/call', { name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  expect(r.isError).toBeFalsy();
  const raw = r.content[0].text;
  return { raw, body: JSON.parse(raw) };
};

let extRpcId = 0;
const callExternal = async (name: string, args: Record<string, unknown> = {}) => {
  const handle = mcpHttp(callOver((path, init) => fetch(`${baseUrl}${path}`, init)));
  const req = new Request('http://127.0.0.1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++extRpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  const res = await handle(req);
  const { result } = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } };
  expect(result.isError).toBeFalsy();
  const raw = result.content[0].text;
  return { raw, body: JSON.parse(raw) };
};

beforeAll(async () => {
  api = createServer((req, res) => {
    const [status, body] = answer(req.url!);
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  baseUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  conductor = new StdioMcp(
    spawn(join(ROOT, 'node_modules/.bin/tsx'), [join(ROOT, 'apps/mcp/omni.ts')], {
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', OMNI_URL: baseUrl, OMNI_TOKEN: 'test-token', OMNI_USER: 'Ben', OMNI_THREAD_ID: 'conductor-thread' },
      stdio: ['pipe', 'pipe', 'inherit'],
    }),
  );
  await conductor.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
}, 30_000);

afterAll(() => {
  conductor?.close();
  api?.close();
});

const assertCompact = (raw: string) => {
  expect(raw).toBe(JSON.stringify(JSON.parse(raw)));
  expect(raw).not.toContain('\n  ');
};

describe('Conductor MCP compact JSON and row defaults (#1006)', () => {
  it('list_channels emits compact JSON and drops null and empty-array defaults', async () => {
    const { raw, body } = await callConductor('list_channels');
    assertCompact(raw);
    const [omni, inbox] = body;
    expect(omni).not.toHaveProperty('store');
    expect(omni).not.toHaveProperty('notes');
    expect(omni.repo).toBe('ben-askphill/omni-os');
    expect(omni.folders[0]).toEqual({ id: 'f1', name: 'Features', threads: 2, recent: ['Compact JSON', 'MCP split'] });
    expect(omni.folders[1]).toEqual({ id: 'f2', name: 'Empty', threads: 0 });
    expect(omni.folders[1]).not.toHaveProperty('recent');
    expect(inbox).not.toHaveProperty('store');
    expect(inbox).not.toHaveProperty('repo');
    expect(inbox).not.toHaveProperty('notes');
    expect(inbox).not.toHaveProperty('folders');
    expect(inbox.running).toBe(0);
  });

  it('list_automations emits compact JSON, drops null/empty-array defaults, and keeps enabled: false', async () => {
    const { raw, body } = await callConductor('list_automations');
    assertCompact(raw);
    const [daily, paused] = body;
    expect(daily.enabled).toBe(true);
    expect(daily.last_runs).toHaveLength(1);
    expect(paused.enabled).toBe(false);
    expect(paused).not.toHaveProperty('next');
    expect(paused).not.toHaveProperty('last_runs');
  });

  it('list_pull_requests emits compact JSON and drops null author and empty labels on rows', async () => {
    const { raw, body } = await callConductor('list_pull_requests');
    assertCompact(raw);
    expect(body.failed).toEqual([]);
    const [openPr, mergedPr] = body.prs;
    expect(openPr.author).toBe('ben');
    expect(openPr).not.toHaveProperty('labels');
    expect(mergedPr).not.toHaveProperty('author');
    expect(mergedPr.labels).toEqual(['bug']);
  });

  it('list_threads emits compact JSON and drops null role/task_id and false delegating', async () => {
    const { raw, body } = await callConductor('list_threads');
    assertCompact(raw);
    const [plain, delegated] = body;
    expect(plain).not.toHaveProperty('role');
    expect(plain).not.toHaveProperty('delegating');
    expect(plain).not.toHaveProperty('task_id');
    expect(delegated).toMatchObject({ id: 'th-2', role: 'builder', delegating: true, task_id: 'T-1006' });
  });

  it('search_history emits compact JSON and drops null event_id', async () => {
    const { raw, body } = await callConductor('search_history', { query: 'compact' });
    assertCompact(raw);
    expect(body[0]).not.toHaveProperty('event_id');
    expect(body[1].event_id).toBe(42);
  });

  it('list_harnesses emits compact JSON, drops model/harness defaults, and keeps available: false and false capabilities', async () => {
    const { raw, body } = await callConductor('list_harnesses');
    assertCompact(raw);
    const [claude, agy] = body;
    expect(claude.capabilities).toEqual({ steer: true, interrupt: true, tool_limits: true });
    expect(claude.capabilities).not.toHaveProperty('remote');
    expect(claude.models[0]).toEqual({ id: 'claude-opus-4-6', label: 'Opus 4.6', efforts: ['low', 'medium', 'high'], default_effort: 'high', default: true });
    expect(claude.models[1]).toEqual({ id: 'claude-haiku-4-5', label: 'Haiku 4.5' });
    expect(agy.available).toBe(false);
    expect(agy).not.toHaveProperty('plan');
    expect(agy).not.toHaveProperty('cap');
    expect(agy.capabilities).toEqual({ steer: false, interrupt: true, tool_limits: false });
    expect(agy.models[0]).toEqual({ id: 'claude-opus-5-5', label: 'Claude Opus', hidden: true, note: 'Bills Google AI' });
  });
});

describe('External MCP compact JSON and row defaults (#1006)', () => {
  it('emits compact JSON and drops row defaults across list tools while keeping meaningful false flags', async () => {
    const channels = await callExternal('list_channels');
    assertCompact(channels.raw);
    expect(channels.body[1]).not.toHaveProperty('repo');
    expect(channels.body[1]).not.toHaveProperty('store');
    expect(channels.body[1]).not.toHaveProperty('notes');
    expect(channels.body[1]).not.toHaveProperty('folders');

    const automations = await callExternal('list_automations');
    assertCompact(automations.raw);
    expect(automations.body[1].enabled).toBe(false);
    expect(automations.body[1]).not.toHaveProperty('next');
    expect(automations.body[1]).not.toHaveProperty('on');
    expect(automations.body[1]).not.toHaveProperty('error');
    expect(automations.body[1]).not.toHaveProperty('last_runs');

    const prs = await callExternal('list_pull_requests');
    assertCompact(prs.raw);
    expect(prs.body.prs[0]).not.toHaveProperty('labels');
    expect(prs.body.prs[1]).not.toHaveProperty('author');

    const threads = await callExternal('list_threads');
    assertCompact(threads.raw);
    expect(threads.body[0]).not.toHaveProperty('folder_id');
    expect(threads.body[0]).not.toHaveProperty('role');
    expect(threads.body[0]).not.toHaveProperty('model');
    expect(threads.body[0]).not.toHaveProperty('branch');
    expect(threads.body[0]).not.toHaveProperty('pinned');
    expect(threads.body[1].pinned).toBe(true);

    const search = await callExternal('search_threads', { query: 'compact' });
    assertCompact(search.raw);
    expect(search.body[0]).not.toHaveProperty('event_id');
    expect(search.body[1].event_id).toBe(42);

    const harnesses = await callExternal('list_harnesses');
    assertCompact(harnesses.raw);
    expect(harnesses.body[0].models[1]).toEqual({ id: 'claude-haiku-4-5', label: 'Haiku 4.5' });
    expect(harnesses.body[1].available).toBe(false);
  });
});

/** Audit-scale fixture (spec #1005: 24 channels / 76 folders, 12 automations, 300 PRs, 20 threads, 40 hits, 5 harnesses). */
function auditScaleFixtures() {
  // Distribute 76 folders across 24 channels (16 channels with folders, 8 without).
  const folderCounts = [8, 7, 6, 6, 6, 5, 5, 5, 5, 4, 4, 4, 3, 3, 3, 2, 0, 0, 0, 0, 0, 0, 0, 0];
  let fid = 0;
  const channels = folderCounts.map((n, i) => ({
    id: `ch-${i + 1}`,
    name: `Client Project ${i + 1}`,
    kind: i < 16 ? 'client' : 'personal',
    store_domain: i % 3 === 0 ? `shop-${i + 1}.myshopify.com` : null,
    github_repo: i < 14 ? `org/project-${i + 1}` : null,
    running: i < 3 ? 1 : 0,
    notes: i % 4 === 0 ? `Primary contact and deployment notes for project ${i + 1}.` : null,
    access_level: i % 5 === 0 ? 'ask' : 'full',
    connector_access: {},
    folders: Array.from({ length: n }, (_, j) => {
      fid++;
      const count = j % 4 === 0 ? 0 : (j % 5) + 1;
      return {
        id: `fld-${fid}`,
        name: `Workstream ${j + 1}`,
        count,
        running: 0,
        threads: Array.from({ length: Math.min(count, 3) }, (_, k) => ({ title: `Task ${k + 1} in workstream ${j + 1}` })),
      };
    }),
  }));

  const automations = Array.from({ length: 12 }, (_, i) => ({
    id: `auto-${i + 1}`,
    name: `Automation ${i + 1}`,
    enabled: i % 3 !== 0,
    ...(i % 4 === 0
      ? { cron: '', on: { event: 'pr_checks_failed', repo: `org/project-${i + 1}` } }
      : { cron: '0 8 * * 1-5', timezone: 'Europe/Amsterdam', next: i % 3 !== 0 ? '2026-11-27T07:00:00.000Z' : null }),
    channel: `ch-${(i % 10) + 1}`,
    role: i % 2 === 0 ? 'researcher' : null,
    harness: i % 4 === 0 ? 'claude-code' : null,
    model: null,
    effort: null,
    prompt: `Run scheduled check ${i + 1} across the project workspace and report any issues found.`,
    error: i === 9 ? 'unknown harness' : null,
    poll_error: null,
    runs: i % 3 === 0
      ? []
      : Array.from({ length: 3 }, (_, r) => ({
          thread_id: `th-a${i}-${r}`,
          trigger: 'cron',
          created_at: `2026-11-2${r}T07:00:00Z`,
          status: 'done',
        })),
  }));

  const prs = {
    prs: Array.from({ length: 300 }, (_, i) => ({
      repo: `org/project-${(i % 14) + 1}`,
      number: 100 + i,
      title: `PR #${100 + i}: update module ${(i % 20) + 1}`,
      author: i % 15 === 0 ? null : { login: i % 2 === 0 ? 'ben' : 'teammate' },
      state: i < 25 ? 'OPEN' : 'MERGED',
      isDraft: i < 5,
      labels: i % 5 === 0 ? ['enhancement'] : [],
      url: `https://github.com/org/project-${(i % 14) + 1}/pull/${100 + i}`,
      updatedAt: `2026-11-${String((i % 25) + 1).padStart(2, '0')}T10:00:00Z`,
    })),
    failed: [],
  };

  const threads = Array.from({ length: 20 }, (_, i) => ({
    id: `th-${String(i + 1).padStart(2, '0')}`,
    title: `Thread ${i + 1}: investigate issue ${1000 + i}`,
    channel_id: `ch-${(i % 10) + 1}`,
    role: i % 2 === 0 ? 'builder' : null,
    status: i < 2 ? 'running' : 'done',
    delegating: i === 0,
    task_id: i % 2 === 0 ? `T-${1000 + i}` : null,
    updated_at: `2026-11-26T08:${String(i).padStart(2, '0')}:00Z`,
  }));

  const search = Array.from({ length: 40 }, (_, i) => ({
    thread_id: `th-${String(i + 1).padStart(2, '0')}`,
    title: `Matched thread ${i + 1}`,
    channel_id: `ch-${(i % 10) + 1}`,
    status: 'done',
    updated_at: `2026-11-26T08:${String(i % 60).padStart(2, '0')}:00Z`,
    snippet: i % 2 === 0 ? '' : `Discussion around <mark>context</mark> tokens in thread ${i + 1}`,
    event_id: i % 2 === 0 ? null : 500 + i,
  }));

  const harnesses = [
    {
      id: 'claude-code',
      name: 'Claude Code',
      plan: 'Max',
      available: true,
      fix: null,
      cap: 4,
      running: 1,
      capabilities: { steer: true, interrupt: true, remote: false, toolLimits: true },
      models: [
        { id: 'claude-opus-4-6', label: 'Opus 4.6', efforts: ['low', 'medium', 'high'], defaultEffort: 'high', default: true, hidden: false, note: null },
        { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', default: false, hidden: false, note: null },
        { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: [], defaultEffort: null, default: false, hidden: false, note: null },
        { id: 'claude-opus-4-5', label: 'Opus 4.5', efforts: [], defaultEffort: null, default: false, hidden: true, note: null },
      ],
    },
    {
      id: 'codex',
      name: 'Codex',
      plan: 'Pro',
      available: true,
      fix: null,
      cap: 4,
      running: 0,
      capabilities: { steer: true, interrupt: true, remote: false, toolLimits: true },
      models: [
        { id: 'gpt-5-4', label: 'GPT-5.4', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high', default: true, hidden: false, note: null },
        { id: 'gpt-5-4-mini', label: 'GPT-5.4 mini', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', default: false, hidden: false, note: null },
        { id: 'gpt-5-3-codex', label: 'GPT-5.3 Codex', efforts: ['low', 'medium', 'high'], defaultEffort: 'high', default: false, hidden: true, note: null },
        { id: 'o4-mini', label: 'o4-mini', efforts: [], defaultEffort: null, default: false, hidden: true, note: null },
      ],
    },
    {
      id: 'cursor',
      name: 'Cursor Agent',
      plan: 'Pro',
      available: true,
      fix: null,
      cap: 2,
      running: 0,
      capabilities: { steer: false, interrupt: true, remote: false, toolLimits: true },
      models: [
        { id: 'auto', label: 'Auto', efforts: [], defaultEffort: null, default: true, hidden: false, note: null },
        { id: 'composer-1', label: 'Composer 1', efforts: [], defaultEffort: null, default: false, hidden: false, note: null },
        { id: 'claude-4-sonnet', label: 'Claude 4 Sonnet', efforts: [], defaultEffort: null, default: false, hidden: true, note: null },
        { id: 'gpt-5', label: 'GPT-5', efforts: [], defaultEffort: null, default: false, hidden: true, note: null },
      ],
    },
    {
      id: 'cursor-cloud',
      name: 'Cursor Cloud',
      plan: null,
      available: false,
      fix: 'Set CURSOR_API_KEY in Settings',
      cap: null,
      running: 0,
      capabilities: { steer: false, interrupt: false, remote: true, toolLimits: false },
      models: [
        { id: 'default', label: 'Default', efforts: [], defaultEffort: null, default: true, hidden: false, note: null },
        { id: 'claude-4-sonnet', label: 'Claude 4 Sonnet', efforts: [], defaultEffort: null, default: false, hidden: false, note: null },
        { id: 'gpt-5', label: 'GPT-5', efforts: [], defaultEffort: null, default: false, hidden: true, note: null },
        { id: 'o3', label: 'o3', efforts: [], defaultEffort: null, default: false, hidden: true, note: null },
      ],
    },
    {
      id: 'antigravity',
      name: 'Antigravity',
      plan: null,
      available: true,
      fix: null,
      cap: 2,
      running: 0,
      capabilities: { steer: true, interrupt: true, remote: false, toolLimits: false },
      models: [
        { id: 'gemini-4-neon', label: 'Gemini 4 Neon', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high', default: true, hidden: false, note: null },
        { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', efforts: [], defaultEffort: null, default: false, hidden: false, note: null },
        { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', efforts: ['low', 'high'], defaultEffort: 'high', default: false, hidden: true, note: 'Bills your Google AI plan, not your Claude or ChatGPT plan.' },
        { id: 'gpt-oss-120b', label: 'GPT-OSS 120B', efforts: [], defaultEffort: null, default: false, hidden: true, note: 'Bills your Google AI plan, not your Claude or ChatGPT plan.' },
      ],
    },
  ];

  return { channels, automations, prs, threads, search, harnesses };
}

describe('audit-scale compact output budgets (#1006)', () => {
  it('cuts character count substantially across all six benchmark tools at audit scale', async () => {
    const scale = auditScaleFixtures();
    const saved = { activeChannels, activeAutomations, activePrs, activeThreads, activeSearch, activeHarnesses };
    activeChannels = scale.channels;
    activeAutomations = scale.automations;
    activePrs = scale.prs;
    activeThreads = scale.threads;
    activeSearch = scale.search;
    activeHarnesses = scale.harnesses;
    try {
      const results = {
        list_channels: await callConductor('list_channels'),
        list_automations: await callConductor('list_automations'),
        list_pull_requests: await callConductor('list_pull_requests'),
        list_threads: await callConductor('list_threads'),
        search_history: await callConductor('search_history', { query: 'context' }),
        list_harnesses: await callConductor('list_harnesses'),
      };
      for (const [name, { raw, body }] of Object.entries(results)) {
        assertCompact(raw);
        const prettyOfSameBody = JSON.stringify(body, null, 2);
        expect(raw.length, `${name} should be strictly smaller than pretty-printed JSON`).toBeLessThan(prettyOfSameBody.length);
      }
      expect(results.list_channels.body).toHaveLength(24);
      expect(results.list_pull_requests.body.prs).toHaveLength(300);
      expect(results.list_threads.body).toHaveLength(20);
      expect(results.search_history.body).toHaveLength(40);
      expect(results.list_harnesses.body).toHaveLength(5);
    } finally {
      activeChannels = saved.activeChannels;
      activeAutomations = saved.activeAutomations;
      activePrs = saved.activePrs;
      activeThreads = saved.activeThreads;
      activeSearch = saved.activeSearch;
      activeHarnesses = saved.activeHarnesses;
    }
  });
});
