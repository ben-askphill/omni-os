import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { serve } from '@hono/node-server';
import { startRunner } from './runner-boot.ts';

// End-to-end verification of compact list_channels index and one-channel detail (#1007) against the real HTTP API
// and SQLite database, seeded at the context-token audit's scale (24 channels, 76 folders).

const MCP_TOKEN = 'mcp-channels-test-token-0123456789abcdef0123';
process.env.OMNI_MCP_TOKEN = MCP_TOKEN;
const API_TOKEN = process.env.OMNI_TOKEN!;

const h = await startRunner();
const { app } = await import('../app.ts');
const { ROOT } = await import('../config.ts');
const T = { timeout: 30_000 };

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
let baseUrl: string;
let omni: McpClient;
let extStdio: McpClient;

const callMcp = async (client: McpClient, name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.request('tools/call', { name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const raw = r.content[0].text;
  return { isError: !!r.isError, raw, body: r.isError ? null : JSON.parse(raw) };
};

let httpRpcId = 0;
const callExternalHttp = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await app.request(`http://127.0.0.1:4747/mcp/${MCP_TOKEN}`, {
    method: 'POST',
    headers: { host: '127.0.0.1:4747', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++httpRpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  expect(res.status).toBe(200);
  const { result } = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } };
  const raw = result.content[0].text;
  return { isError: !!result.isError, raw, body: result.isError ? null : JSON.parse(raw) };
};

beforeAll(async () => {
  // startRunner seeds 3 channels (conductor, inbox, scratch). Add 21 more -> 24 total channels, 76 total folders.
  const existing = h.db.channels.list().length;
  expect(existing).toBe(3);

  let totalFolders = 0;
  for (let i = 0; i < 21; i++) {
    const num = i + 1;
    const id = `client-${String(num).padStart(2, '0')}`;
    const isRich = num === 5;
    h.db.channels.create({
      id,
      name: `Client Project ${num}`,
      kind: num <= 1 ? 'personal' : 'client',
      use_worktree: 0,
      github_repo: num % 2 === 1 ? `org/project-repo-${num}` : null,
      store_domain: num % 3 === 1 ? `store-${num}.myshopify.com` : null,
      notes: num % 3 === 1 || isRich ? `Deployment notes and workflow rules for project ${num}. Always run checks before pushing.` : null,
      worktree_include: isRich ? '.env.local\n.env.test' : null,
      worktree_shared: isRich ? 'node_modules' : null,
      access_level: num === 1 ? 'ask' : num === 2 ? 'read' : null,
      connector_access: num === 3 ? JSON.stringify({ gmail: 'off' }) : null,
    });

    // 0 folders on client-01; 3 on 02..09 (24); 4 on 10..20 (44); 8 on 21 (8) -> 76 folders total.
    const folderCount = num === 1 ? 0 : num <= 9 ? 3 : num <= 20 ? 4 : 8;
    for (let j = 0; j < folderCount; j++) {
      const folder = h.db.folders.create({ channel_id: id, name: `Workstream ${j + 1}` });
      totalFolders++;
      // Leave the first folder of client-05 empty to assert empty-folder recent omission; fill the rest.
      const threadCount = isRich && j === 0 ? 0 : 3;
      for (let k = 0; k < threadCount; k++) {
        const tid = randomUUID();
        h.db.threads.create({
          id: tid,
          channel_id: id,
          title: `Task ${k + 1} in workstream ${j + 1} for ${id}`,
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
        } as any);
        h.db.folders.moveThread(tid, folder.id);
      }
    }
  }
  expect(h.db.channels.list()).toHaveLength(24);
  expect(totalFolders).toBe(76);

  // Seed one running thread on client-01 so only that channel reports running > 0.
  h.db.threads.create({
    id: randomUUID(),
    channel_id: 'client-01',
    title: 'Active task',
    status: 'running',
    role: null,
    model: null,
    session_id: randomUUID(),
    cwd: h.paths.data,
    branch: null,
    parent_id: null,
    task_id: null,
    source: 'manual',
    automation: null,
  } as any);

  server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
  if (!server.listening) await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  omni = new McpClient(
    spawn(join(ROOT, 'node_modules/.bin/tsx'), [join(ROOT, 'apps/mcp/omni.ts')], {
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', OMNI_URL: baseUrl, OMNI_TOKEN: API_TOKEN, OMNI_USER: 'User', OMNI_THREAD_ID: 'conductor-thread' },
      stdio: ['pipe', 'pipe', 'inherit'],
    }),
  );
  await omni.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });

  // Plain node (no tsx) to verify erasable TS in apps/mcp/channels.ts and external/tools.ts.
  extStdio = new McpClient(
    spawn(process.execPath, [join(ROOT, 'apps/mcp/external/stdio.ts')], {
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', OMNI_URL: baseUrl, OMNI_TOKEN: API_TOKEN },
      stdio: ['pipe', 'pipe', 'inherit'],
    }),
  );
  await extStdio.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
}, 30_000);

afterAll(() => {
  omni?.close();
  extStdio?.close();
  server?.close();
  server?.closeAllConnections?.();
});

describe('list_channels compact index and one-channel detail (#1007)', () => {
  it('returns a compact index under 3,100 chars at 24 channels / 76 folders', T, async () => {
    const res = await callMcp(omni, 'list_channels');
    expect(res.isError).toBe(false);
    expect(res.raw).toBe(JSON.stringify(res.body));
    expect(res.body).toHaveLength(24);
    expect(res.raw.length).toBeLessThan(3100);

    // Notes, folder trees and worktree lists stay off the index.
    for (const row of res.body) {
      expect(row).not.toHaveProperty('notes');
      expect(row).not.toHaveProperty('folders');
      expect(row).not.toHaveProperty('copy_into_worktrees');
      expect(row).not.toHaveProperty('shared_directories');
    }

    const byId = new Map<string, any>(res.body.map((c: any) => [c.id, c]));

    // client-01: running = 1, non-default ask access, repo + store, 0 folders.
    expect(byId.get('client-01')).toEqual({
      id: 'client-01',
      name: 'Client Project 1',
      kind: 'personal',
      store: 'store-1.myshopify.com',
      repo: 'org/project-repo-1',
      running: 1,
      access: 'Ask first',
    });

    // client-02: running = 0 (omitted), no repo/store (omitted), non-default read access, 3 folders.
    expect(byId.get('client-02')).toEqual({
      id: 'client-02',
      name: 'Client Project 2',
      kind: 'client',
      folder_count: 3,
      access: 'Read only',
    });

    // client-03: default channel level with a connector override -> access included.
    expect(byId.get('client-03').access).toContain('Gmail off');

    // client-04: default access, 0 running, store set, 3 folders.
    expect(byId.get('client-04')).toEqual({
      id: 'client-04',
      name: 'Client Project 4',
      kind: 'client',
      store: 'store-4.myshopify.com',
      folder_count: 3,
    });

    // Whitespace channel falls back to the index.
    const blank = await callMcp(omni, 'list_channels', { channel: '   ' });
    expect(blank.isError).toBe(false);
    expect(blank.body).toEqual(res.body);
  });

  it('returns one channel detail with folder tree, recent thread titles, notes, worktree lists and access', T, async () => {
    const detail = await callMcp(omni, 'list_channels', { channel: 'client-05' });
    expect(detail.isError).toBe(false);
    expect(detail.raw).toBe(JSON.stringify(detail.body));
    expect(detail.body).toMatchObject({
      id: 'client-05',
      name: 'Client Project 5',
      kind: 'client',
      repo: 'org/project-repo-5',
      notes: 'Deployment notes and workflow rules for project 5. Always run checks before pushing.',
      copy_into_worktrees: ['.env.local', '.env.test'],
      shared_directories: ['node_modules'],
    });
    expect(typeof detail.body.access).toBe('string');
    expect(detail.body).not.toHaveProperty('running');
    expect(detail.body.folders).toHaveLength(3);

    const emptyFolder = detail.body.folders.find((f: any) => f.name === 'Workstream 1');
    expect(emptyFolder).toMatchObject({ name: 'Workstream 1', threads: 0 });
    expect(emptyFolder).not.toHaveProperty('recent');

    const filledFolder = detail.body.folders.find((f: any) => f.name === 'Workstream 2');
    expect(filledFolder).toMatchObject({ name: 'Workstream 2', threads: 3 });
    expect(filledFolder.recent).toHaveLength(3);
    expect(filledFolder.recent[0]).toContain('workstream 2 for client-05');

    const missing = await callMcp(omni, 'list_channels', { channel: 'no-such-channel' });
    expect(missing.isError).toBe(true);
    expect(missing.raw).toMatch(/not found/i);
  });

  it('serves the same compact index and detail on external MCP (HTTP and plain-node stdio)', T, async () => {
    const httpIndex = await callExternalHttp('list_channels');
    expect(httpIndex.isError).toBe(false);
    expect(httpIndex.body).toHaveLength(24);
    expect(httpIndex.raw.length).toBeLessThan(3100);

    const httpDetail = await callExternalHttp('list_channels', { channel: 'client-05' });
    expect(httpDetail.isError).toBe(false);
    expect(httpDetail.body.notes).toContain('project 5');
    expect(httpDetail.body.folders).toHaveLength(3);

    const stdioIndex = await callMcp(extStdio, 'list_channels');
    expect(stdioIndex.isError).toBe(false);
    expect(stdioIndex.raw).toBe(httpIndex.raw);

    const stdioDetail = await callMcp(extStdio, 'list_channels', { channel: 'client-05' });
    expect(stdioDetail.isError).toBe(false);
    expect(stdioDetail.body).toEqual(httpDetail.body);
  });

  it('leaves the HTTP /api/channels response unchanged for Web UI and clients', T, async () => {
    const res = await fetch(`${baseUrl}/api/channels`, { headers: { authorization: `Bearer ${API_TOKEN}` } });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as any[];
    expect(rows).toHaveLength(24);
    const ch5 = rows.find((c) => c.id === 'client-05');
    expect(ch5.notes).toContain('project 5');
    expect(ch5.running).toBe(0);
    expect(ch5.folders).toHaveLength(3);
    expect(ch5.folders[1].threads).toHaveLength(3);
  });
});
