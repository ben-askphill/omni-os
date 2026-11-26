import { afterAll, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { hasMcpBuild } from './support.ts';

// A thread's MCP servers on the thread's own token (audit finding 12, part 2): started from the config Omni writes for
// the thread, with nothing but that config's environment, so the only credential they have is the file
// OMNI_TOKEN_FILE names. The Conductor's tools keep working, and the automation guard holds without any header.
const h = await startRunner({ HOME: mkdtempSync(join(tmpdir(), 'omni-thread-token-mcp-home-')) });
const { app } = await import('../app.ts');
const { serve } = await import('@hono/node-server');
const { buildMcpConfig } = await import('../sandbox.ts');
const { getCrew } = await import('../crew.ts');
const { mintThreadToken } = await import('../thread-tokens.ts');
const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
await once(server, 'listening');
const omniUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const { db, threads } = h.db;

const shipped = mkdtempSync(join(tmpdir(), 'omni-thread-token-mcp-crew-'));
h.paths.crew = shipped;
writeFileSync(join(shipped, 'conductor.md'), '---\nname: Conductor\nchannel: conductor\nmcp: [omni]\ndelegate_only: true\ndelegatable: false\n---\nRoute everything.\n');
writeFileSync(join(shipped, 'builder.md'), '---\nname: Builder\ndescription: Writes code.\nmodel: sonnet\n---\nYou write and ship code.\n');

const clients: ChildProcess[] = [];
afterAll(() => {
  for (const c of clients) c.kill('SIGTERM');
  server.close();
  server.closeAllConnections();
});
const T = { timeout: 30_000 };

let n = 0;
function thread(role: string | null, o: { automation?: string } = {}) {
  const id = `token-mcp-${++n}`;
  db.prepare(`INSERT INTO threads (id, channel_id, title, status, session_id, cwd, source, role, automation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, 'scratch', `Thread ${n}`, 'done', id, h.tmp, o.automation ? 'automation' : 'manual', role, o.automation ?? null,
  );
  return id;
}

/** One of the thread's MCP servers, as its harness starts it after a spawn minted the thread's token. */
async function connect(threadId: string, name: string) {
  mintThreadToken(threadId);
  const cfg = buildMcpConfig({ threadId, channel: h.db.channels.get('scratch')!, browserBusy: false, omniUrl, role: getCrew(threads.get(threadId)!.role) });
  const s = cfg.mcpServers[name];
  if (!s) throw new Error(`no ${name} server for ${threadId}`);
  expect(s.env).not.toHaveProperty('OMNI_TOKEN');
  const child = spawn(s.command, s.args, { env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...s.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  clients.push(child);
  let id = 0;
  const waiting = new Map<number, (r: any) => void>();
  createInterface({ input: child.stdout! }).on('line', (line) => {
    const msg = JSON.parse(line);
    waiting.get(msg.id)?.(msg);
  });
  const request = (method: string, params: unknown = {}) =>
    new Promise<any>((resolve, reject) => {
      const me = ++id;
      const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 20_000);
      waiting.set(me, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      });
      child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id: me, method, params })}\n`);
    });
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  return async (tool: string, args: Record<string, unknown> = {}) => {
    const r = (await request('tools/call', { name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    let body: any = r.content[0].text;
    try {
      body = JSON.parse(body);
    } catch {}
    return { isError: !!r.isError, body };
  };
}

describe("the Conductor's omni server on its thread's token", () => {
  it('reads, and delegates a thread that files under the Conductor', T, async () => {
    const conductor = thread('conductor');
    const tool = await connect(conductor, 'omni');
    const listed = await tool('list_threads', {});
    expect(listed.isError, JSON.stringify(listed.body)).toBe(false);
    const made = await tool('delegate', { channel: 'scratch', role: 'builder', prompt: 'Goal: say hi. Done when: you said it. Proof back: the word.' });
    expect(made.isError, JSON.stringify(made.body)).toBe(false);
    const child = threads.get(made.body.thread_id ?? made.body.id);
    expect(child?.parent_id).toBe(conductor);
  });

  it('under an automation: saving an automation and rotating the install token are refused', T, async () => {
    const run = thread('conductor', { automation: 'nightly' });
    const tool = await connect(run, 'omni-admin');
    const saved = await tool('save_automation', { create: true, fields: { name: 'From the run', enabled: true, cron: '0 9 * * 1-5', channel: 'scratch', prompt: 'Check the shop.' } });
    expect(saved.isError).toBe(true);
    expect(saved.body).toMatch(/automation "nightly"/);
    const rotated = await tool('rotate_install_token');
    expect(rotated.isError).toBe(true);
    expect(JSON.stringify(rotated.body)).toMatch(/cannot rotate the install token/);
  });
});

describe.skipIf(!hasMcpBuild)("omni-mcp's threads server on its thread's token", () => {
  it('reaches the API', T, async () => {
    const id = thread(null);
    const tool = await connect(id, 'omni-threads');
    // A thread nothing referenced: the API answered, so the token got through (a 401 would be an error of another kind).
    const r = await tool('read_referenced_thread', { thread_id: thread(null) });
    expect(r.body).toMatchObject({ state: 'unavailable', reason: 'not_referenced' });
  });
});
