import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { serverOptions } from '../server-options.ts';

// End-to-end verification and character-budget checks for the four routine lookup tools compacted in #1011:
// list_automations, list_threads, list_harnesses, and settings (apps/mcp/omni.ts).
// Seeded at the context-token audit's scale (14 automations, 20 threads, 5 local harnesses with repeated notes/efforts,
// and full 24-option settings state).

const ROOT = join(import.meta.dirname, '../../..');

// ---------- audit-scale fixture data ----------

const automationsFixture = Array.from({ length: 14 }, (_, i) => ({
  id: `automation-${String(i + 1).padStart(2, '0')}`,
  name: `Scheduled Automation ${i + 1}`,
  enabled: i % 3 !== 0,
  cron: i % 4 === 0 ? '' : '0 8 * * 1-5',
  on: i % 4 === 0 ? { event: 'pr_checks_failed', repo: 'org/project-repo-1' } : undefined,
  timezone: 'Europe/Amsterdam',
  next: i % 3 === 0 || i % 4 === 0 ? null : '2026-11-27T07:00:00.000Z',
  channel: `channel-${String((i % 8) + 1).padStart(2, '0')}`,
  runs_on: i === 2 ? { owner: 'mac-studio', isThisMac: false } : { owner: 'mac-air', isThisMac: true },
  source: 'own',
  role: i % 2 === 0 ? 'builder' : undefined,
  prompt: `Check status and summarize updates for automation ${i + 1}. `.repeat(3),
  runs:
    i % 3 === 0
      ? []
      : [1, 2, 3].map((k) => ({
          thread_id: `00000000-0000-4000-8000-${String(i * 10 + k).padStart(12, '0')}`,
          title: `Scheduled Automation ${i + 1} run ${k}`,
          trigger: k === 3 && i === 1 ? 'manual' : i % 4 === 0 ? 'event' : 'cron',
          created_at: `2026-11-2${k}T07:00:00.000Z`,
          status: k === 3 && i === 1 ? 'failed' : 'done',
        })),
}));

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

// Mirrors compact-json-mcp.test.ts's 5-harness shape plus real repeated notes (Cursor Claude, Antigravity, Cursor Cloud).
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
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'high', default: false, hidden: false, note: null },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: [], defaultEffort: '', default: false, hidden: false, note: null },
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
      { id: 'gpt-6-1', label: 'GPT-6.1 Sol', efforts: ['low', 'medium', 'high'], defaultEffort: 'high', default: true, hidden: false, note: null },
      { id: 'gpt-5-4-mini', label: 'GPT-5.4 Mini', efforts: [], defaultEffort: '', default: false, hidden: true, note: null },
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
      { id: 'composer-2.5', label: 'Composer 2.5', efforts: [], defaultEffort: '', default: true, hidden: false, note: null },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', efforts: ['low', 'high'], defaultEffort: 'high', default: false, hidden: false, note: 'Bills Cursor, not your Claude plan' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', efforts: ['low', 'high'], defaultEffort: 'high', default: false, hidden: false, note: 'Bills Cursor, not your Claude plan' },
    ],
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    plan: 'Google AI',
    available: true,
    cap: 4,
    running: 0,
    capabilities: { steer: false, interrupt: true, remote: false, toolLimits: false },
    models: [
      { id: 'gemini-4-neon', label: 'Gemini 4 Neon', efforts: ['low', 'high'], defaultEffort: 'high', default: true, hidden: false, note: "agy's current model. Bills your Google AI plan." },
      { id: 'gemini-4-flash', label: 'Gemini 4 Flash', efforts: ['low', 'high'], defaultEffort: 'high', default: false, hidden: false, note: "agy's current model. Bills your Google AI plan." },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', efforts: [], defaultEffort: '', default: false, hidden: true, note: 'Bills your Google AI plan, not your Claude or ChatGPT plan.' },
      { id: 'gpt-6-1', label: 'GPT-6.1', efforts: [], defaultEffort: '', default: false, hidden: true, note: 'Bills your Google AI plan, not your Claude or ChatGPT plan.' },
    ],
  },
  {
    id: 'cursor-cloud',
    name: 'Cursor Cloud',
    plan: 'Cursor',
    available: true,
    cap: 12,
    running: 0,
    capabilities: { steer: false, interrupt: true, remote: true, toolLimits: false },
    models: [
      { id: 'default', label: 'Cursor default', efforts: [], defaultEffort: '', default: true, hidden: false, note: "Runs on Cursor's Linux cloud, on its own clone of the channel repo. Bills your Cursor plan." },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: [], defaultEffort: '', default: false, hidden: false, note: "Runs on Cursor's Linux cloud, on its own clone of the channel repo. Bills your Cursor plan." },
      { id: 'gpt-6-1', label: 'GPT-6.1', efforts: [], defaultEffort: '', default: false, hidden: false, note: "Runs on Cursor's Linux cloud, on its own clone of the channel repo. Bills your Cursor plan." },
    ],
  },
];

const setupFixture = {
  onboarded: true,
  install: 'app',
  path: '~/.omni/omni.config.json',
  config: {
    version: 1,
    onboardedAt: '2026-09-15T09:00:00.000Z',
    user: { name: 'Ben', pronouns: 'he/him', timezone: '', email: 'ben@askphill.com', work: '', tools: '' },
    workspace: { root: '', reposDir: '', githubOwner: 'ben-askphill' },
    integrations: {
      hermesUrl: '',
      centralBrainDir: '',
      tailscaleLogin: '',
      mcpPublicUrl: '',
      clerkPublishableKey: '',
      clerkClientId: '',
      mcpClients: '',
      syncSignatures: 'actions',
    },
    runOn: { device: '' },
    automations: {},
    crew: {},
    worktrees: {
      retention: { enabled: false, idleDays: 14 },
      slim: { enabled: false, idleDays: 7 },
    },
  },
  resolved: {
    timezone: 'Europe/Amsterdam',
    workspaceRoot: '~/omni-workspace',
    reposDir: '~/repos',
    centralBrainDir: '',
    hermesUrl: '',
  },
  fallbacks: { timezone: 'Europe/Amsterdam', workspaceRoot: '~/omni-workspace', reposDir: '~/repos', home: '~' },
  omniRepo: 'ben-askphill/omni-os',
  env: {},
};

const serverOptionsFixture = {
  options: serverOptions({}).map((o) =>
    o.env === 'OMNI_MODS' ? { ...o, value: 'On', source: 'env' as const } : { ...o, value: o.default, source: 'default' as const },
  ),
};

const displayFixture = { technical: true, shopify: true, openItems: false };
const analyticsFixture = { enabled: true, configured: false };
const usagePanelFixture = { order: [], visible: {} };

function answer(method: string, rawUrl: string): [number, unknown] {
  const [url, qs] = rawUrl.split('?');
  if (method === 'GET' && url === '/api/automations') return [200, automationsFixture];
  if (method === 'GET' && url === '/api/threads') {
    const params = new URLSearchParams(qs);
    const ch = params.get('channel');
    const st = params.get('status');
    const filtered = threadsFixture.filter((t) => (!ch || t.channel_id === ch) && (!st || t.status === st));
    return [200, filtered];
  }
  if (method === 'GET' && url === '/api/harnesses') return [200, harnessesFixture];
  if (method === 'GET' && url === '/api/setup') return [200, setupFixture];
  if (method === 'GET' && url === '/api/setup/server') return [200, serverOptionsFixture];
  if (method === 'GET' && url === '/api/display') return [200, displayFixture];
  if (method === 'GET' && url === '/api/analytics') return [200, analyticsFixture];
  if (method === 'GET' && url === '/api/usage-panel') return [200, usagePanelFixture];
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

const callOmni = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await omni.request('tools/call', { name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  expect(r.isError).toBeFalsy();
  const raw = r.content[0].text;
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
}, 30_000);

afterAll(() => {
  omni?.close();
  api?.close();
});

const T = { timeout: 30_000 };

describe('compact routine lookup tools (#1011)', () => {
  it('list_automations keeps enabled on every row, omits default runs_on/source/run fields, and stays within budget', T, async () => {
    const { raw, body } = await callOmni('list_automations');
    expect(body).toHaveLength(14);

    // Every row keeps enabled (true and false); default runs_on and source drop.
    const disabled = body.find((a: any) => a.id === 'automation-01');
    expect(disabled.enabled).toBe(false);
    const enabled = body.find((a: any) => a.id === 'automation-02');
    expect(enabled.enabled).toBe(true);
    expect(enabled).not.toHaveProperty('runs_on');
    expect(enabled).not.toHaveProperty('source');
    expect(enabled.next).toBe('2026-11-27T07:00Z');
    expect(enabled.prompt.length).toBeLessThanOrEqual(121);

    // Non-default runs_on (another machine) and non-default run trigger/status stay visible.
    const remote = body.find((a: any) => a.id === 'automation-03');
    expect(remote.runs_on).toBe('mac-studio');
    expect(enabled.last_runs[0]).not.toHaveProperty('trigger');
    expect(enabled.last_runs[0]).not.toHaveProperty('status');
    expect(enabled.last_runs[2]).toMatchObject({ trigger: 'manual', status: 'failed' });

    // Audit baseline 12.4K; after #1006 8,155 (without runs_on/source); after #1011 ~6,500 (< 6,700).
    expect(raw.length).toBeLessThan(6_700);
  });

  it('list_threads keeps status on every row including done, omits echoed channel filter, and stays within budget', T, async () => {
    const { raw, body } = await callOmni('list_threads');
    expect(body).toHaveLength(20);
    expect(body[0]).toMatchObject({ id: threadsFixture[0].id, status: 'running', delegating: true, updated_at: '2026-11-26T08:00Z' });
    expect(body[1].status).toBe('done');
    expect(body[1]).not.toHaveProperty('delegating');
    expect(body[1].updated_at).toBe('2026-11-26T08:01Z');

    // Filtered by channel omits the echoed channel field on every row while keeping status.
    const filtered = await callOmni('list_threads', { channel: 'channel-01' });
    expect(filtered.body.length).toBeGreaterThan(0);
    for (const row of filtered.body) {
      expect(row).not.toHaveProperty('channel');
      expect(row.status).toBeTruthy();
    }

    // Audit baseline 5.9K; after #1006 4,096; after #1011 3,956 unfiltered (< 4,000).
    expect(raw.length).toBeLessThan(4_000);
  });

  it('list_harnesses keeps available and capability booleans, hoists shared efforts/notes, and stays within budget', T, async () => {
    const { raw, body } = await callOmni('list_harnesses');
    expect(body.map((h: any) => h.id)).toEqual(['claude-code', 'codex', 'cursor', 'antigravity', 'cursor-cloud']);

    const claude = body.find((h: any) => h.id === 'claude-code');
    expect(claude.available).toBe(true);
    expect(claude.capabilities).toEqual({ steer: true, interrupt: true, tool_limits: true });
    expect(claude.efforts).toEqual(['low', 'medium', 'high']);
    expect(claude.default_effort).toBe('high');
    expect(claude.models.map((m: any) => m.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5']);
    expect(claude.models[0]).toEqual({ id: 'claude-opus-5-5', default: true });
    expect(claude.models[2]).toEqual({ id: 'claude-haiku-4-5', efforts: [] });

    // Non-redundant codename label ("GPT-6.1 Sol") stays; redundant labels drop.
    const codex = body.find((h: any) => h.id === 'codex');
    expect(codex.available).toBe(true);
    expect(codex).not.toHaveProperty('running');
    expect(codex.models.find((m: any) => m.id === 'gpt-6-1').label).toBe('GPT-6.1 Sol');
    expect(codex.models.find((m: any) => m.id === 'gpt-5-4-mini')).not.toHaveProperty('label');

    // Repeated billing notes on Cursor, Antigravity, and Cursor Cloud appear once per harness instead of per model.
    const cursor = body.find((h: any) => h.id === 'cursor');
    expect(Object.values(cursor.notes)).toEqual(['Bills Cursor, not your Claude plan']);
    const agy = body.find((h: any) => h.id === 'antigravity');
    expect(Object.keys(agy.notes)).toHaveLength(2);
    expect(raw.match(/Google AI plan/g)?.length).toBe(2);
    const cloud = body.find((h: any) => h.id === 'cursor-cloud');
    expect(cloud.note).toContain("Cursor's Linux cloud");
    for (const m of cloud.models) expect(m).not.toHaveProperty('note');

    // 15 models across 5 harnesses with full billing notes and capabilities stays under 1,900 chars (1,834 measured).
    expect(raw.length).toBeLessThan(1_900);
  });

  it('settings drops defaults and UI hints, keeps analytics.enabled, and stays within budget', T, async () => {
    const { raw, body } = await callOmni('settings');
    expect(body.path).toBe('~/.omni/omni.config.json');
    expect(body.config.user).toEqual({ name: 'Ben', pronouns: 'he/him', email: 'ben@askphill.com' });
    expect(body.config.workspace).toEqual({ githubOwner: 'ben-askphill' });
    expect(body.config).not.toHaveProperty('integrations');
    expect(body.config).not.toHaveProperty('runOn');
    expect(body.config).not.toHaveProperty('crew');
    expect(body.config).not.toHaveProperty('worktrees');
    expect(body.config).not.toHaveProperty('version');
    expect(body).not.toHaveProperty('env_overrides');
    expect(body.analytics).toEqual({ enabled: true });
    expect(body).not.toHaveProperty('usage_panel');
    expect(body.display).toEqual({ technical: true, shopify: true });
    expect(body.server_options).toEqual([{ env: 'OMNI_MODS', value: 'On', default: 'Off' }]);

    // Pretty-printed baseline ~7.9K; after #1006 ~5.9K; compacted drops to 432 chars (< 500).
    expect(raw.length).toBeLessThan(500);
  });
});
