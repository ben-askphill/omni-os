import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { newContext } from '@omni/shared/message-context.ts';
import { referenceBody, threadReference } from '@omni/shared/message-context-thread.ts';
import { startRunner } from './runner-boot.ts';
import { hasMcpBuild } from './support.ts';

// read_referenced_thread as an agent calls it: the omni-threads server, started from the config Omni writes for a
// thread, talking to the real API over HTTP. The same tool is registered by the conductor's server (apps/mcp/omni.ts).

const h = await startRunner();
const { app } = await import('../app.ts');
const { serve } = await import('@hono/node-server');
const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
await once(server, 'listening');
const port = (server.address() as AddressInfo).port;
const { buildMcpConfig } = await import('../sandbox.ts');
const { stampThreadReferences } = await import('../message-context/thread-reference.ts');
const { PAGE_CHARS_DEFAULT, PAGE_CHARS_MAX, PAGE_ROWS_DEFAULT, PAGE_ROWS_MAX, ROW_CHARS_DEFAULT, ROW_CHARS_MAX } = await import('../thread-history.ts');
const clients: McpClient[] = [];
afterAll(() => {
  for (const c of clients) c.close();
  server.close();
  server.closeAllConnections();
});
const T = { timeout: 30_000 };

const make = (title: string) =>
  h.db.threads.create({ id: randomUUID(), channel_id: 'scratch', title, status: 'done', role: null, model: null, session_id: randomUUID(), cwd: h.paths.data, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null });

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

/** A client of the thread's own omni-threads server, started the way a harness starts it. */
async function connect(threadId: string) {
  const channel = h.db.channels.get('scratch')!;
  const cfg = buildMcpConfig({ threadId, channel, browserBusy: false, omniUrl: `http://127.0.0.1:${port}` });
  const s = cfg.mcpServers['omni-threads'];
  const client = new McpClient(spawn(s.command, s.args, { env: { ...(process.env as Record<string, string>), ...s.env }, stdio: ['pipe', 'pipe', 'inherit'] }));
  clients.push(client);
  await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  return client;
}
const callTool = async (client: McpClient, args: Record<string, unknown>) => {
  const r = (await client.request('tools/call', { name: 'read_referenced_thread', arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
  return { isError: !!r.isError, raw: r.content[0].text, body: JSON.parse(r.content[0].text) as any };
};

describe.skipIf(!hasMcpBuild)('read_referenced_thread', () => {
  const from = make('Asking');
  const to = make('A long one');
  for (let i = 0; i < 120; i++) h.db.events.add(to.id, i % 2 ? 'assistant_text' : 'user', { text: `message ${i}` });
  const big = make('Verbose thread');
  for (let i = 0; i < 20; i++) h.db.events.add(big.id, i % 2 ? 'assistant_text' : 'user', { text: `${i}:${'x'.repeat(10_000)}` });
  const stamped = stampThreadReferences(from.id, [
    newContext(threadReference, referenceBody({ id: to.id, title: to.title, channel: 'scratch', channel_name: 'Scratch' }, 'scratch', new Date()), ''),
    newContext(threadReference, referenceBody({ id: big.id, title: big.title, channel: 'scratch', channel_name: 'Scratch' }, 'scratch', new Date()), ''),
  ]);
  if (!stamped.ok) throw new Error(stamped.error);
  h.db.events.add(from.id, 'user', { text: 'read it', context: stamped.value });

  it('is the only tool the thread gets, with its limits in the description', T, async () => {
    const client = await connect(from.id);
    const { tools } = (await client.request('tools/list')) as { tools: { name: string; description: string; inputSchema: { properties: Record<string, unknown> } }[] };
    expect(tools.map((t) => t.name)).toEqual(['read_referenced_thread']);
    expect(tools[0].description).toContain('up to 100 messages (default 15) and 60,000 characters (default 20,000)');
    expect(tools[0].description).toContain('cut at up to 8,000 characters (default 3,000');
    expect(Object.keys(tools[0].inputSchema.properties)).toEqual(expect.arrayContaining(['limit', 'page_chars', 'row_chars']));
  });

  it('returns a bounded default page (15 rows) and pages back with explicit larger limits', T, async () => {
    const client = await connect(from.id);
    const first = await callTool(client, { thread_id: to.id });
    expect(first.isError).toBe(false);
    expect(first.body.rows).toHaveLength(PAGE_ROWS_DEFAULT);
    expect(first.body.limits).toEqual({ rows: PAGE_ROWS_DEFAULT, page_chars: PAGE_CHARS_DEFAULT, row_chars: ROW_CHARS_DEFAULT });
    expect(first.body.rows.at(-1).text).toBe('message 119');
    const older = await callTool(client, { thread_id: to.id, before: first.body.older, limit: PAGE_ROWS_MAX });
    expect(older.body.rows.at(-1).text).toBe('message 104');
    expect(older.body.rows).toHaveLength(PAGE_ROWS_MAX);
    expect(older.body.limits.rows).toBe(PAGE_ROWS_MAX);
    expect(older.body.older).not.toBeNull();
    const oldest = await callTool(client, { thread_id: to.id, before: older.body.older, limit: PAGE_ROWS_MAX });
    expect(oldest.body.rows).toHaveLength(5);
    expect(oldest.body.rows[0].text).toBe('message 0');
    expect(oldest.body.older).toBeNull();
  });

  it('defaults to 20K page chars and 3K per row, while explicit larger overrides still work', T, async () => {
    const client = await connect(from.id);
    const def = await callTool(client, { thread_id: big.id });
    expect(def.isError).toBe(false);
    expect(def.body.limits).toEqual({ rows: PAGE_ROWS_DEFAULT, page_chars: PAGE_CHARS_DEFAULT, row_chars: ROW_CHARS_DEFAULT });
    expect(def.body.rows).toHaveLength(Math.floor(PAGE_CHARS_DEFAULT / ROW_CHARS_DEFAULT));
    expect(def.body.rows.every((r: any) => r.text.length === ROW_CHARS_DEFAULT && r.cut_from > ROW_CHARS_DEFAULT)).toBe(true);
    expect(def.raw.length).toBeLessThan(22_000);

    const wide = await callTool(client, { thread_id: big.id, limit: 40, page_chars: PAGE_CHARS_MAX, row_chars: ROW_CHARS_MAX });
    expect(wide.isError).toBe(false);
    expect(wide.body.limits).toEqual({ rows: 40, page_chars: PAGE_CHARS_MAX, row_chars: ROW_CHARS_MAX });
    expect(wide.body.rows).toHaveLength(Math.floor(PAGE_CHARS_MAX / ROW_CHARS_MAX));
    expect(wide.body.rows.every((r: any) => r.text.length === ROW_CHARS_MAX && r.cut_from > ROW_CHARS_MAX)).toBe(true);
    expect(wide.raw.length).toBeGreaterThan(55_000);
  });

  it('says unavailable, as an error, for a thread nothing referenced and for one that is gone', T, async () => {
    const client = await connect(from.id);
    const stranger = make('Never referenced');
    const none = await callTool(client, { thread_id: stranger.id });
    expect(none).toMatchObject({ isError: true, body: { state: 'unavailable', reason: 'not_referenced' } });
    const gone = make('Gone');
    const s = stampThreadReferences(from.id, [newContext(threadReference, referenceBody({ id: gone.id, title: gone.title, channel: 'scratch', channel_name: 'Scratch' }, 'scratch', new Date()), '')]);
    if (!s.ok) throw new Error(s.error);
    h.db.events.add(from.id, 'user', { text: 'again', context: s.value });
    h.db.db.prepare('DELETE FROM threads WHERE id = ?').run(gone.id);
    expect(await callTool(client, { thread_id: gone.id })).toMatchObject({ isError: true, body: { state: 'unavailable', reason: 'missing' } });
  });

  it('reads a thread referenced on a new thread\'s first message, as the new-thread composer sends it', T, async () => {
    const body = { channel: 'scratch', prompt: 'CMD hi', context: [newContext(threadReference, referenceBody({ id: to.id, title: to.title, channel: 'scratch', channel_name: 'Scratch' }, 'scratch', new Date()), '')] };
    const res = await app.request('/api/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(res.status, await res.clone().text()).toBe(200);
    const made = (await res.json()) as { id: string };
    await h.untilResults(made.id, 1);
    const before = { thread: JSON.stringify(h.db.threads.get(to.id)), events: h.db.events.since(to.id).length };
    const read = await callTool(await connect(made.id), { thread_id: to.id, limit: 2 });
    expect(read.isError).toBe(false);
    expect(read.body.rows.map((r: any) => r.text)).toEqual(['message 118', 'message 119']);
    // Reading it changed nothing in it.
    expect({ thread: JSON.stringify(h.db.threads.get(to.id)), events: h.db.events.since(to.id).length }).toEqual(before);
  });

  it('explains a bad call and an unknown asking thread instead of throwing', T, async () => {
    const client = await connect(from.id);
    const both = await callTool(client, { thread_id: to.id, before: 5, after: 3 });
    expect(both).toMatchObject({ isError: true, body: { state: 'unavailable', message: 'Pass before or after, not both.' } });
    const lone = await connect(randomUUID());
    expect(await callTool(lone, { thread_id: to.id })).toMatchObject({ isError: true, body: { state: 'unavailable', message: 'not found' } });
  });
});
