import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

// The Conductor's automation and channel action tools (apps/mcp/omni.ts, #681), started the way a harness starts the
// omni server, against a fake API that records each request and answers with canned bodies.

const ROOT = join(import.meta.dirname, '../../..');
const seen: { method: string; url: string; body: any }[] = [];

const automations = [
  {
    id: 'daily-brief',
    name: 'Daily brief',
    cron: '0 8 * * 1-5',
    timezone: 'Europe/Amsterdam',
    next: '2026-11-16T07:00:00.000Z',
    channel: 'inbox',
    role: 'researcher',
    prompt: 'x'.repeat(300),
    enabled: true,
    file: '/secret/path/daily-brief.yaml',
    runs: [1, 2, 3, 4, 5].map((i) => ({ id: i, automation: 'daily-brief', thread_id: `t${i}`, trigger: 'cron', created_at: `2026-11-1${i}`, status: 'done', title: 'Daily brief' })),
    deliveries: [],
  },
  { id: 'pr-fix', name: 'Fix PR checks', cron: '', on: { event: 'pr_checks_failed' }, timezone: 'UTC', channel: 'omni-os', prompt: 'Fix it', enabled: false, file: 'x', error: 'unknown harness', poll_error: null, runs: [] },
];
const action = { id: 'act-1', channel_id: 'shop', name: 'Theme preview', command: 'shopify theme dev --port $OMNI_PORT', secrets: ['SHOPIFY_TOKEN'], port: 0, setup: null, position: 0, created_at: 'c', updated_at: 'u' };
const run = (output: string) => ({ id: 'run-1', thread_id: 'th-1', action_id: 'act-1', name: 'Theme preview', command: action.command, cwd: '/wt', port: 9301, state: 'running', exit_code: null, error: null, output, output_bytes: output.length, started_at: 's', ended_at: null });

function answer(method: string, url: string): [number, unknown] {
  if (method === 'GET' && url === '/api/automations') return [200, automations];
  if (method === 'POST' && url === '/api/automations/daily-brief/run') return [200, { id: 'new-thread', title: 'Daily brief · 14 Nov', channel_id: 'inbox', status: 'running', cwd: '/x' }];
  if (method === 'POST' && url === '/api/automations/pr-fix/run') return [400, { error: 'unknown harness' }];
  if (method === 'POST' && url === '/api/automations/daily-brief/enabled') return [200, { ok: true }];
  if (method === 'DELETE' && url === '/api/automations/daily-brief') return [200, { ok: true, removed: 'file' }];
  if (method === 'DELETE' && url === '/api/automations/nope') return [404, { error: 'not found' }];
  if (method === 'GET' && url === '/api/channels/shop/actions') return [200, [action]];
  if (method === 'GET' && url === '/api/threads/th-1/actions') return [200, { actions: [action], runs: [run(`${'a'.repeat(3000)}http://127.0.0.1:9301`)], blocked: null, setup_run: null, clone: null }];
  if (method === 'POST' && url === '/api/threads/th-1/actions/act-1/run') return [201, run('')];
  return [404, { error: `no fake for ${method} ${url}` }];
}

let api: Server;
let omni: McpClient;

/** Just enough of an MCP client over stdio (newline-delimited JSON-RPC) to list tools and call one. */
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

const tool = async (name: string, args: Record<string, unknown> = {}) => {
  seen.length = 0;
  const r = (await omni.request('tools/call', { name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const raw = r.content[0].text;
  let body: any = raw;
  try {
    body = JSON.parse(raw);
  } catch {}
  return { isError: !!r.isError, body, requests: [...seen] };
};

beforeAll(async () => {
  api = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, body: data ? JSON.parse(data) : undefined });
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
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', OMNI_URL: base, OMNI_TOKEN: 'test-token', OMNI_USER: 'Ben' },
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

describe('Conductor automation tools', () => {
  it('registers them, and delete says it is destructive', T, async () => {
    const { tools } = (await omni.request('tools/list')) as { tools: { name: string; description: string }[] };
    const names = tools.map((t) => t.name);
    for (const n of ['list_automations', 'run_automation', 'set_automation_enabled', 'delete_automation', 'list_channel_actions', 'run_channel_action']) expect(names).toContain(n);
    expect(tools.find((t) => t.name === 'delete_automation')!.description).toMatch(/^Destructive:/);
  });

  it('list_automations returns a compact list from GET /automations', T, async () => {
    const { isError, body, requests } = await tool('list_automations');
    expect(isError).toBe(false);
    expect(requests).toEqual([{ method: 'GET', url: '/api/automations', body: undefined }]);
    const [brief, pr] = body;
    expect(brief).toMatchObject({ id: 'daily-brief', enabled: true, cron: '0 8 * * 1-5', next: '2026-11-16T07:00:00.000Z', role: 'researcher' });
    expect(brief.prompt).toHaveLength(201);
    expect(brief.last_runs).toEqual([1, 2, 3].map((i) => ({ thread_id: `t${i}`, trigger: 'cron', at: `2026-11-1${i}`, status: 'done' })));
    expect(brief).not.toHaveProperty('file');
    expect(brief).not.toHaveProperty('deliveries');
    expect(pr).toMatchObject({ id: 'pr-fix', enabled: false, on: { event: 'pr_checks_failed' }, error: 'unknown harness' });
    expect(pr).not.toHaveProperty('cron');
  });

  it('run_automation posts to the run route and returns the new thread', T, async () => {
    const { body, requests } = await tool('run_automation', { automation: 'daily-brief' });
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual(['POST /api/automations/daily-brief/run']);
    expect(body).toEqual({ automation: 'daily-brief', thread_id: 'new-thread', title: 'Daily brief · 14 Nov', channel: 'inbox', status: 'running' });
  });

  it('run_automation passes on the server refusal', T, async () => {
    const { isError, body } = await tool('run_automation', { automation: 'pr-fix' });
    expect(isError).toBe(true);
    expect(body).toContain('unknown harness');
  });

  it('set_automation_enabled posts the flag', T, async () => {
    const { body, requests } = await tool('set_automation_enabled', { automation: 'daily-brief', enabled: false });
    expect(requests).toEqual([{ method: 'POST', url: '/api/automations/daily-brief/enabled', body: { enabled: false } }]);
    expect(body).toEqual({ automation: 'daily-brief', enabled: false });
  });

  it('delete_automation calls DELETE and says what was removed', T, async () => {
    const { body, requests } = await tool('delete_automation', { automation: 'daily-brief' });
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual(['DELETE /api/automations/daily-brief']);
    expect(body).toEqual({ deleted: 'daily-brief', removed: 'file' });
    const missing = await tool('delete_automation', { automation: 'nope' });
    expect(missing.isError).toBe(true);
    expect(missing.body).toContain('not found');
  });
});

describe('Conductor channel action tools', () => {
  it("list_channel_actions with a channel lists its actions", T, async () => {
    const { body, requests } = await tool('list_channel_actions', { channel: 'shop' });
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual(['GET /api/channels/shop/actions']);
    expect(body).toEqual([{ id: 'act-1', name: 'Theme preview', command: action.command, port: 0, setup: null, secrets: ['SHOPIFY_TOKEN'] }]);
  });

  it('list_channel_actions with a thread leaves run output out unless include_output is true', T, async () => {
    const { body } = await tool('list_channel_actions', { thread_id: 'th-1' });
    expect(body.runs[0]).toMatchObject({ run_id: 'run-1', state: 'running' });
    expect(body.runs[0]).not.toHaveProperty('output');
    expect((await tool('list_channel_actions', { thread_id: 'th-1', include_output: false })).body.runs[0]).not.toHaveProperty('output');
  });

  it("list_channel_actions with include_output adds each run's output, cut to the end", T, async () => {
    const { body, requests } = await tool('list_channel_actions', { thread_id: 'th-1', include_output: true });
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual(['GET /api/threads/th-1/actions']);
    expect(body.blocked).toBeNull();
    expect(body.actions).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({ run_id: 'run-1', state: 'running', port: 9301 });
    expect(body.runs[0].output.length).toBe(1501);
    expect(body.runs[0].output.endsWith('http://127.0.0.1:9301')).toBe(true);
  });

  it('list_channel_actions wants exactly one of channel and thread_id', T, async () => {
    expect((await tool('list_channel_actions', {})).isError).toBe(true);
    expect((await tool('list_channel_actions', { channel: 'shop', thread_id: 'th-1' })).isError).toBe(true);
  });

  it('run_channel_action resolves a name and starts the run', T, async () => {
    const { body, requests } = await tool('run_channel_action', { thread_id: 'th-1', action: 'theme PREVIEW' });
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual(['GET /api/threads/th-1/actions', 'POST /api/threads/th-1/actions/act-1/run']);
    expect(body).toMatchObject({ run_id: 'run-1', action_id: 'act-1', name: 'Theme preview', state: 'running', port: 9301 });
    expect(body).not.toHaveProperty('output');
  });

  it('run_channel_action names the actions there are when none matches', T, async () => {
    const { isError, body, requests } = await tool('run_channel_action', { thread_id: 'th-1', action: 'deploy' });
    expect(isError).toBe(true);
    expect(body).toContain('"Theme preview"');
    expect(requests).toHaveLength(1);
  });
});
