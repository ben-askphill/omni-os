import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { callOver } from '@omni/mcp/external/tools.ts';
import { mcpHttp } from '@omni/mcp/external/http.ts';
import { startRunner } from './runner-boot.ts';

// End-to-end verification of bounded search_history (Conductor MCP) and search_threads (external MCP) (#1008)
// against the real Hono API and SQLite FTS5 index, seeded at audit scale (40+ hits across channels, including
// title+body overlap, body-only, title-only, and a chatty thread with many matching events).

const ROOT = join(import.meta.dirname, '../../..');
const API_TOKEN = process.env.OMNI_TOKEN!;

const h = await startRunner();
const { app } = await import('../app.ts');
const { serve } = await import('@hono/node-server');

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

let server: Server;
let omni: McpClient;
let extHandler: (req: Request) => Promise<Response>;
let rpcId = 0;

const callOmni = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await omni.request('tools/call', { name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  expect(r.isError).toBeFalsy();
  const raw = r.content[0].text;
  return { raw, body: JSON.parse(raw) as any[] };
};

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
  return { raw, body: JSON.parse(raw) as any[] };
};

const makeThread = (channelId: string, title: string) =>
  h.db.threads.create({
    id: randomUUID(),
    channel_id: channelId,
    title,
    status: 'done',
    role: null,
    model: null,
    session_id: randomUUID(),
    cwd: h.paths.data,
    branch: null,
    parent_id: null,
    task_id: null,
    source: 'manual',
    automation: null,
  });

const titleOnlyId = randomUUID();
const titleAndBodyId = randomUUID();

beforeAll(async () => {
  h.db.channels.create({ id: 'shop', name: 'Shop', kind: 'client', use_worktree: 0, base_dir: h.paths.data });
  h.db.channels.create({ id: 'ops', name: 'Ops', kind: 'personal', use_worktree: 0, base_dir: h.paths.data });

  // Seed 45 threads across channels matching "deployment" (audit scale is 40+ hits).
  // One chatty thread has 40 matching events so a naive FTS LIMIT would starve other title-matched threads.
  const chatty = makeThread('ops', 'Chatty rollout log');
  for (let i = 0; i < 40; i++) {
    h.db.events.add(chatty.id, 'assistant_text', { text: `Verified deployment step ${i} for cluster node ${i}` });
  }

  for (let i = 0; i < 40; i++) {
    const channel = i < 12 ? 'shop' : 'ops';
    // Half match BOTH title and body (the exact path that previously yielded empty snippets); half match body only.
    const title = i % 2 === 0 ? `Deployment checklist ${i + 1}` : `Release notes ${i + 1}`;
    const t = makeThread(channel, title);
    h.db.events.add(t.id, 'user', { text: `Check the deployment pipeline status for build ${i + 1} before shipping.` });
  }

  // Explicit title+body thread and explicit title-only thread in #shop for targeted assertions.
  h.db.threads.create({
    id: titleAndBodyId,
    channel_id: 'shop',
    title: 'Zephyr rollout plan',
    status: 'done',
    role: null,
    model: null,
    session_id: randomUUID(),
    cwd: h.paths.data,
    branch: null,
    parent_id: null,
    task_id: null,
    source: 'manual',
    automation: null,
  });
  h.db.events.add(titleAndBodyId, 'user', { text: 'Investigate the zephyr checkout latency spike in production.' });

  h.db.threads.create({
    id: titleOnlyId,
    channel_id: 'shop',
    title: 'Quasar migration checklist',
    status: 'done',
    role: null,
    model: null,
    session_id: randomUUID(),
    cwd: h.paths.data,
    branch: null,
    parent_id: null,
    task_id: null,
    source: 'manual',
    automation: null,
  });
  h.db.events.add(titleOnlyId, 'user', { text: 'Double check database indexes before Friday.' });

  server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  omni = new McpClient(
    spawn(join(ROOT, 'node_modules/.bin/tsx'), [join(ROOT, 'apps/mcp/omni.ts')], {
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', OMNI_URL: base, OMNI_TOKEN: API_TOKEN, OMNI_USER: 'Ben', OMNI_THREAD_ID: 'conductor-thread' },
      stdio: ['pipe', 'pipe', 'inherit'],
    }),
  );
  await omni.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });

  const call = callOver(async (path, init) => app.request(`http://127.0.0.1:4747${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${API_TOKEN}` } }));
  extHandler = mcpHttp(call);
}, 30_000);

afterAll(() => {
  omni?.close();
  server?.close();
  server?.closeAllConnections();
});

const T = { timeout: 30_000 };

describe('search_history and search_threads (#1008)', () => {
  it('defaults to at most 10 compact hits with non-empty snippets and no event_id', T, async () => {
    const res = await callOmni('search_history', { query: 'deployment' });
    expect(res.body).toHaveLength(10);
    expect(res.raw).toBe(JSON.stringify(res.body));
    // Character budget at audit scale (down from 10,408 chars after #1006 / 11-18K before).
    expect(res.raw.length).toBeLessThan(3_500);
    for (const hit of res.body) {
      expect(hit).not.toHaveProperty('event_id');
      expect(typeof hit.snippet).toBe('string');
      expect(hit.snippet.trim().length).toBeGreaterThan(0);
      expect(hit.snippet).not.toContain('<mark>');
      expect(hit.snippet.toLowerCase()).toContain('deployment');
    }
  });

  it('filters by channel and honors explicit larger limit overrides', T, async () => {
    const shopOnly = await callOmni('search_history', { query: 'deployment', channel: 'shop' });
    expect(shopOnly.body).toHaveLength(10);
    expect(shopOnly.body.every((hit) => hit.channel_id === 'shop')).toBe(true);
    expect(shopOnly.body.every((hit) => hit.snippet.toLowerCase().includes('deployment') && !('event_id' in hit))).toBe(true);

    const wider = await callOmni('search_history', { query: 'deployment', limit: 25 });
    expect(wider.body).toHaveLength(25);
    expect(wider.body.every((hit) => hit.snippet.trim().length > 0 && !('event_id' in hit))).toBe(true);

    const empty = await callOmni('search_history', { query: 'deployment', channel: 'scratch' });
    expect(empty.body).toEqual([]);
  });

  it('returns the body snippet when both title and body match, and a non-empty snippet on title-only matches', T, async () => {
    const both = await callOmni('search_history', { query: 'zephyr' });
    expect(both.body).toHaveLength(1);
    expect(both.body[0]).toMatchObject({ thread_id: titleAndBodyId, title: 'Zephyr rollout plan' });
    expect(both.body[0].snippet).toContain('checkout latency spike');
    expect(both.body[0]).not.toHaveProperty('event_id');

    const titleOnly = await callOmni('search_history', { query: 'quasar' });
    expect(titleOnly.body).toHaveLength(1);
    expect(titleOnly.body[0]).toMatchObject({ thread_id: titleOnlyId, snippet: 'Quasar migration checklist' });
    expect(titleOnly.body[0]).not.toHaveProperty('event_id');
  });

  it('keeps event_id and default 40-hit behavior on the HTTP API the Web UI reads', T, async () => {
    const apiRes = await app.request('http://127.0.0.1:4747/api/search?q=deployment', { headers: { authorization: `Bearer ${API_TOKEN}` } });
    expect(apiRes.status).toBe(200);
    const apiHits = (await apiRes.json()) as any[];
    expect(apiHits).toHaveLength(40);
    expect(apiHits.every((hit) => typeof hit.event_id === 'number')).toBe(true);
    expect(apiHits.every((hit) => hit.snippet.includes('<mark>'))).toBe(true);
  });

  it('applies the same bounds, channel filter and field stripping on external search_threads', T, async () => {
    const def = await callExternal('search_threads', { query: 'deployment' });
    expect(def.body).toHaveLength(10);
    expect(def.raw.length).toBeLessThan(3_500);
    expect(def.body.every((hit) => !('event_id' in hit) && hit.snippet.toLowerCase().includes('deployment'))).toBe(true);

    const filtered = await callExternal('search_threads', { query: 'deployment', channel: 'shop', limit: 15 });
    expect(filtered.body).toHaveLength(12);
    expect(filtered.body.every((hit) => hit.channel_id === 'shop' && !('event_id' in hit) && hit.snippet.length > 0)).toBe(true);
  });
});
