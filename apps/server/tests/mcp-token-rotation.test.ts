import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// After POST /api/auth/rotate-token, a running thread's Omni MCP servers (apps/mcp/api.ts) still hold the old token
// in their env. Their next call must pick up the new one from OMNI_TOKEN_FILE instead of failing until the thread
// restarts (PRD #667, story 11). The local stdio server other clients start (apps/mcp/external/stdio.ts) does the same.

const OLD = 'old-token-0123456789abcdef0123456789abcdef';
const NEW = 'new-token-0123456789abcdef0123456789abcdef';
const seen: string[] = [];
/** The token the fake API accepts now. */
let accepted = NEW;
let server: Server;
let file: string;
let base: string;
let api: typeof import('@omni/mcp/api.ts');
const env = { ...process.env };

beforeAll(async () => {
  server = createServer((req, res) => {
    const auth = req.headers.authorization ?? '';
    seen.push(auth);
    res.setHeader('content-type', 'application/json');
    if (auth !== `Bearer ${accepted}`) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    res.end(JSON.stringify(req.url === '/api/channels' ? [] : { ok: true, path: req.url }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const dir = mkdtempSync(join(tmpdir(), 'omni-mcp-token-'));
  file = join(dir, 'api-token');
  writeFileSync(file, `${NEW}\n`);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.OMNI_URL = base;
  process.env.OMNI_TOKEN = OLD;
  process.env.OMNI_TOKEN_FILE = file;
  vi.resetModules();
  api = await import('@omni/mcp/api.ts');
});

afterAll(() => {
  process.env = env;
  server.close();
});

describe('apps/mcp call() after the install token rotates', () => {
  it('reads the token file again on a 401 and retries once with the new token', async () => {
    seen.length = 0;
    await expect(api.call('/threads')).resolves.toEqual({ ok: true, path: '/api/threads' });
    expect(seen).toEqual([`Bearer ${OLD}`, `Bearer ${NEW}`]);
  });

  it('keeps the new token for later calls', async () => {
    seen.length = 0;
    await api.call('/channels');
    expect(seen).toEqual([`Bearer ${NEW}`]);
  });

  it('does not retry when the file holds the token that was just refused', async () => {
    accepted = 'rotated-again-0123456789abcdef0123456789ab';
    seen.length = 0;
    const err = await api.call('/y').catch((e) => e);
    expect(err).toBeInstanceOf(api.ApiError);
    expect(err.status).toBe(401);
    expect(seen).toHaveLength(1);
  });
});

describe('the local stdio MCP server after the install token rotates', () => {
  it('reads the token file again on a 401 and keeps the new token', { timeout: 30_000 }, async () => {
    accepted = NEW;
    writeFileSync(file, `${NEW}\n`);
    // Plain node, the way a client outside Omni starts it.
    const child = spawn(process.execPath, [join(import.meta.dirname, '../../mcp/external/stdio.ts')], {
      env: { PATH: process.env.PATH ?? '', OMNI_URL: base, OMNI_TOKEN: OLD, OMNI_TOKEN_FILE: file },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const waiting = new Map<number, (msg: any) => void>();
    createInterface({ input: child.stdout! }).on('line', (line) => {
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
    });
    let id = 0;
    const request = (method: string, params: unknown) =>
      new Promise<any>((resolve) => {
        waiting.set(++id, resolve);
        child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    try {
      await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
      seen.length = 0;
      const first = await request('tools/call', { name: 'list_channels', arguments: {} });
      expect(first.result.isError).toBeFalsy();
      expect(seen).toEqual([`Bearer ${OLD}`, `Bearer ${NEW}`]);
      seen.length = 0;
      const second = await request('tools/call', { name: 'list_channels', arguments: {} });
      expect(second.result.isError).toBeFalsy();
      expect(seen).toEqual([`Bearer ${NEW}`]);
    } finally {
      child.kill('SIGTERM');
    }
  });
});
