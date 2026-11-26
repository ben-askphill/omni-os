import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { rmSync } from 'node:fs';
import { CORE_TOOLS } from '@omni/mcp/core-tools.ts';
import { OmniMcp, StdioMcp } from './omni-mcp.ts';

// The conductor tools as two servers (#1014): apps/mcp/omni.ts serves the routing core as `omni` and every other tool
// as `omni-admin`. A thread that has the conductor tools gets both from buildMcpConfig, and omni-admin sits behind
// `omni-mcp lazy` where this install proved the front, so a thread that never calls an admin tool never starts it.

vi.mock('../db.ts', () => {
  throw new Error('db.ts must not be imported by sandbox tests');
});

const DIR = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const dir = mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'omni-mcp-split-'));
  process.env.OMNI_DATA_DIR = require('node:path').join(dir, 'data');
  delete process.env.OMNI_CONFIG;
  return dir;
});

import { buildMcpConfig, prepareAdminMcp } from '../sandbox.ts';
import { hasMcpBuild } from './support.ts';
import type { Channel } from '../db.ts';
import type { CrewRole } from '../crew.ts';

const T = { timeout: 60_000 };
const seen: { method: string; url: string; thread?: string }[] = [];
let api: Server;
let base = '';
let both: OmniMcp;

const env = () => ({ PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', OMNI_URL: base, OMNI_TOKEN: 'test-token', OMNI_USER: 'Ben', OMNI_THREAD_ID: 'conductor-thread' });

beforeAll(async () => {
  api = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, thread: req.headers['x-omni-thread'] as string | undefined });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.url!.startsWith('/api/automations') ? [] : req.url!.startsWith('/api/threads') ? [] : {}));
    });
  });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  both = await OmniMcp.start(env());
}, 60_000);

afterAll(() => {
  both?.close();
  api?.close();
  rmSync(DIR, { recursive: true, force: true });
});

const names = (server: 'omni' | 'omni-admin') => both.listed[server].map((t) => t.name).sort();
const chars = (server: 'omni' | 'omni-admin') => both.listed[server].reduce((n, t) => n + JSON.stringify(t).length, 0);

describe('the conductor tools on two servers', () => {
  it('puts the routing core on omni and every other tool on omni-admin, each on one', () => {
    expect(names('omni')).toEqual([...CORE_TOOLS].sort());
    expect(names('omni-admin').filter((t) => CORE_TOOLS.has(t))).toEqual([]);
    expect(names('omni').length).toBeLessThanOrEqual(22);
    // Every tool the server had before the split is still on one of the two.
    expect(names('omni').length + names('omni-admin').length).toBeGreaterThanOrEqual(71);
    for (const t of ['delegate', 'delegate_team', 'seat_agents', 'message_thread', 'get_thread', 'list_channels', 'list_crew']) expect(names('omni')).toContain(t);
    for (const t of ['save_automation', 'settings', 'tool_failures', 'omni_update', 'save_crew_role', 'list_harnesses']) expect(names('omni-admin')).toContain(t);
  });

  it('keeps the schemas short: under 20K characters on omni (70,293 before the split)', () => {
    expect(chars('omni')).toBeLessThan(20_000);
    expect(chars('omni-admin')).toBeLessThan(33_000);
    for (const server of ['omni', 'omni-admin'] as const)
      for (const t of both.listed[server]) {
        expect(t.description, t.name).toBeTruthy();
        expect(t.description!.length, t.name).toBeLessThanOrEqual(500);
      }
  });

  it('runs a core tool on omni and an admin tool on omni-admin, both as the calling thread', T, async () => {
    seen.length = 0;
    const core = await both.request('tools/call', { name: 'list_threads', arguments: {} });
    const admin = await both.request('tools/call', { name: 'list_automations', arguments: {} });
    expect([core.isError, admin.isError]).toEqual([undefined, undefined]);
    expect(seen.map((r) => [r.method, r.url.split('?')[0], r.thread])).toEqual([
      ['GET', '/api/threads', 'conductor-thread'],
      ['GET', '/api/automations', 'conductor-thread'],
    ]);
  });
});

const channel = { id: 'scratch', name: 'Scratch', browser_headless: 0 } as unknown as Channel;
const conductor = { id: 'conductor', mcp: ['omni'], delegateOnly: true } as unknown as CrewRole;

describe.skipIf(!hasMcpBuild)('omni-admin behind omni-mcp lazy', () => {
  it('starts at its first call, answering tools/list the same as the server itself', T, async () => {
    const direct = buildMcpConfig({ threadId: 'split-thread', channel, role: conductor, browserBusy: false, omniUrl: base }).mcpServers['omni-admin']!;
    expect(direct.args.at(-1)).toBe('admin');
    await prepareAdminMcp();
    const cfg = buildMcpConfig({ threadId: 'split-thread', channel, role: conductor, browserBusy: false, omniUrl: base });
    const front = cfg.mcpServers['omni-admin']!;
    expect(front.args[0]).toBe('lazy');
    // lazy <record> <the server's own command>: the front starts the same server at the first other request.
    expect(front.args.slice(2)).toEqual([direct.command, ...direct.args]);

    const { OMNI_TOKEN_FILE: _file, ...threadEnv } = front.env!;
    const client = new StdioMcp(spawn(front.command, front.args, { env: { ...env(), ...threadEnv }, stdio: ['pipe', 'pipe', 'inherit'] }));
    try {
      await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
      const { tools } = await client.request('tools/list');
      expect(tools.map((t: { name: string }) => t.name).sort()).toEqual(names('omni-admin'));
      seen.length = 0;
      const r = await client.request('tools/call', { name: 'list_automations', arguments: {} });
      expect(r.isError).toBeUndefined();
      expect(seen.map((x) => x.url)).toEqual(['/api/automations']);
    } finally {
      client.close();
    }
  });
});
