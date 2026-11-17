import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

// The real browser MCP server (@playwright/mcp, the version apps/server pins) behind the real front (omni-mcp lazy),
// as a thread gets it from buildMcpConfig. The same conversation is held with the server started directly and with it
// behind the front, and every answer has to be the same. No browser opens: nothing here calls a browser tool that
// exists. It needs the omni-mcp build, so it skips on a machine without cargo (global-native.ts).

vi.mock('../db.ts', () => {
  throw new Error('db.ts must not be imported by sandbox tests');
});

const DIR = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const dir = mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'omni-lazy-browser-'));
  process.env.OMNI_DATA_DIR = require('node:path').join(dir, 'data');
  delete process.env.OMNI_CONFIG;
  for (const key of Object.keys(process.env)) if (key.startsWith('PLAYWRIGHT_MCP_')) delete process.env[key];
  return dir;
});

import { buildMcpConfig, playwrightMcpBin, prepareBrowserMcp } from '../sandbox.ts';
import { config, paths } from '../config.ts';
import { nativeMcpCandidate } from '../native-mcp.ts';
import { hasMcpBuild } from './support.ts';
import type { Channel } from '../db.ts';

interface Server {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

type Step = { send: object | string; wait?: string | number } | { check: (pid: number) => void };

/**
 * Holds a conversation with a stdio MCP server as a harness would: sends each line, waits for the answer where the
 * step names an id, and answers the server's own questions (it asks for the client's roots). Gives each answer by id,
 * what the server asked, its exit code once stdin closed, and what it wrote to stderr.
 */
function converse(server: Server, steps: Step[]): Promise<{ answers: Record<string, unknown>; asked: string[]; code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const answers: Record<string, unknown> = {};
    const asked: string[] = [];
    let stderr = '';
    let buffer = '';
    let at = 0;
    let sent = 0;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`no answer to step ${at} in 30 s. Answers so far: ${JSON.stringify(answers)}`));
    }, 30_000);
    const next = () => {
      for (; at < steps.length; at++) {
        const step = steps[at]!;
        if ('check' in step) {
          step.check(child.pid!);
          continue;
        }
        if (step.wait !== undefined && step.wait in answers) continue;
        if (sent < at + 1) {
          // An empty line only waits for an answer to something sent before.
          if (step.send !== '') child.stdin.write(`${typeof step.send === 'string' ? step.send : JSON.stringify(step.send)}\n`);
          sent = at + 1;
        }
        if (step.wait !== undefined) return;
      }
      child.stdin.end();
    };
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk));
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk;
      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
        const message = JSON.parse(buffer.slice(0, end)) as { id?: string | number; method?: string; result?: unknown; error?: unknown };
        buffer = buffer.slice(end + 1);
        if (message.method && message.id !== undefined) {
          asked.push(message.method);
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { roots: [] } })}\n`);
        } else if (message.id !== undefined) answers[message.id] = message.error ? { error: message.error } : { result: message.result };
      }
      next();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ answers, asked, code, stderr });
    });
    next();
  });
}

/** The processes a process started, by pid. */
const children = (pid: number) => spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);

const initialize = (id: number, version: string, patch: object = {}) => ({
  jsonrpc: '2.0',
  id,
  method: 'initialize',
  params: { protocolVersion: version, capabilities: { roots: { listChanged: true } }, clientInfo: { name: 'claude-code', version: '2.1.0' }, ...patch },
});
const request = (id: number, method: string, params?: object) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });

describe.skipIf(!hasMcpBuild)('the browser server behind omni-mcp lazy', () => {
  const channel = { id: 'c', name: 'C', browser_headless: 1 } as Channel;
  const browser = () => buildMcpConfig({ threadId: 't', channel, browserBusy: true, omniUrl: 'http://127.0.0.1:4747' }).mcpServers['omni-browser']!;
  const original = { browser: config.browser, lazy: config.browserLazy };
  let direct: Server;
  let front: Server;
  let log: string[];

  beforeAll(async () => {
    config.browser = true;
    config.browserLazy = true;
    direct = browser();
    const said = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await prepareBrowserMcp();
    log = [...said.mock.calls, ...warned.mock.calls].map(([line]) => String(line)).filter((line) => line.includes('playwright-mcp'));
    said.mockRestore();
    warned.mockRestore();
    front = browser();
  }, 60_000);
  afterAll(() => {
    config.browser = original.browser;
    config.browserLazy = original.lazy;
    rmSync(DIR, { recursive: true, force: true });
  });

  it('is what a thread gets once the server has asked the browser server and checked the front', () => {
    const binary = nativeMcpCandidate();
    const { version } = JSON.parse(readFileSync(join(dirname(playwrightMcpBin()), 'package.json'), 'utf8')) as { version: string };
    expect(log).toEqual([`[mcp] playwright-mcp ${version} starts on a thread's first call to it, behind ${binary} lazy`]);
    expect(direct.command).toBe(process.execPath);
    expect(front.command).toBe(binary);
    expect(front.args.slice(0, 1)).toEqual(['lazy']);
    expect(front.args[1]).toContain(join(paths.data, 'mcp-answers', 'playwright-mcp', `${version}-`));
    expect(front.args.slice(2)).toEqual([direct.command, ...direct.args]);
    expect(front.env).toEqual(direct.env);
    const record = JSON.parse(readFileSync(front.args[1]!, 'utf8')) as { initialize: Record<string, unknown>; tools: { tools: { name: string }[] } };
    expect(Object.keys(record.initialize)).toEqual(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']);
    expect(record.tools.tools.map((tool) => tool.name)).toContain('browser_navigate');
    expect(record).toMatchObject({ refused: { 'server/discover': { code: -32601 } } });
  });

  // The newest and the oldest protocol version, and one the record does not have.
  for (const version of ['2025-11-25', '2024-10-07', '2031-01-01']) {
    it(`answers a thread's start itself in ${version}, and everything after as the server does`, async () => {
      let before: string[] = ['unset'];
      const steps = (seesChildren: boolean): Step[] => [
        // How Claude Code opens (2.1.316): the newer way to start a session, which this server does not have.
        { send: request(0, 'server/discover', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } }), wait: 0 },
        { send: initialize(1, version), wait: 1 },
        { send: { jsonrpc: '2.0', method: 'notifications/initialized' } },
        { send: request(2, 'tools/list'), wait: 2 },
        { send: request(3, 'ping'), wait: 3 },
        { send: request(4, 'tools/list', {}), wait: 4 },
        { check: (pid) => void (seesChildren && (before = children(pid))) },
        // From here on only the server can answer.
        { send: request(5, 'tools/list', { cursor: 'next' }), wait: 5 },
        { send: request(6, 'resources/list'), wait: 6 },
        { send: request(7, 'tools/call', { name: 'no_such_tool', arguments: {} }), wait: 7 },
        { send: 'not json' },
        { send: request(8, 'tools/call', { name: 'browser_navigate', arguments: {} }), wait: 8 },
        { send: request(9, 'tools/list'), wait: 9 },
        { send: request(10, 'ping'), wait: 10 },
      ];
      const [alone, behind] = await Promise.all([converse(direct, steps(false)), converse(front, steps(true))]);
      expect(Object.keys(alone.answers)).toHaveLength(11);
      expect(alone.answers[0]).toEqual({ error: { code: -32601, message: 'Method not found' } });
      expect(behind.answers).toEqual(alone.answers);
      expect(behind.asked).toEqual(alone.asked);
      expect(behind.code).toBe(alone.code);
      expect(alone.code).toBe(0);
      // The front found the server's answers to be the ones in the record, or it would have said so.
      expect(behind.stderr).not.toContain('omni-mcp lazy');
      // Whether the handshake started the server: only when it came in a version the record does not have.
      expect(before).toHaveLength(version === '2031-01-01' ? 1 : 0);
    });
  }

  // What each harness wrote to the server's stdin when a thread started, captured on 2026-11-17. A harness that opens
  // with something the record does not cover starts the server at once: still right, but the saving is gone.
  const OPENINGS: Record<string, { lines: string[]; ids: (string | number)[] }> = {
    'Claude Code 2.1.316': {
      lines: [
        `{"jsonrpc":"2.0","id":"server-discover-probe-1","method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"claude-code","title":"Claude Code","version":"2.1.316","description":"Anthropic's agentic coding tool","websiteUrl":"https://claude.com/claude-code"},"io.modelcontextprotocol/clientCapabilities":{"roots":{"listChanged":true},"elicitation":{"form":{},"url":{}},"extensions":{"io.modelcontextprotocol/tasks":{}}}}}}`,
        `{"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{"roots":{"listChanged":true},"elicitation":{"form":{},"url":{}},"extensions":{"io.modelcontextprotocol/tasks":{}}},"clientInfo":{"name":"claude-code","title":"Claude Code","version":"2.1.316","description":"Anthropic's agentic coding tool","websiteUrl":"https://claude.com/claude-code"}},"jsonrpc":"2.0","id":0}`,
        `{"jsonrpc":"2.0","method":"notifications/initialized"}`,
        `{"method":"tools/list","jsonrpc":"2.0","id":1}`,
      ],
      ids: ['server-discover-probe-1', 0, 1],
    },
    'Codex 0.166.0': {
      lines: [
        `{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{"experimental":{"codex/auth-change":{}},"elicitation":{"form":{},"url":{}}},"clientInfo":{"name":"codex-mcp-client","title":"Codex","version":"0.166.0"}}}`,
        `{"jsonrpc":"2.0","method":"notifications/initialized"}`,
        `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"progressToken":0}}}`,
      ],
      ids: [0, 1],
    },
    'Cursor Agent': {
      lines: [
        `{"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{"elicitation":{"form":{}},"extensions":{"io.modelcontextprotocol/ui":{"mimeTypes":["text/html;profile=mcp-app"]}}},"clientInfo":{"name":"Cursor","version":"1.0.0"}},"jsonrpc":"2.0","id":0}`,
        `{"method":"notifications/initialized","jsonrpc":"2.0"}`,
        `{"method":"tools/list","params":{},"jsonrpc":"2.0","id":1}`,
      ],
      ids: [0, 1],
    },
  };

  for (const [harness, opening] of Object.entries(OPENINGS)) {
    it(`does not start for what ${harness} sends when a thread starts, and starts at its first call`, async () => {
      let before: string[] = ['unset'];
      let after: string[] = [];
      const steps = (isFront: boolean): Step[] => [
        ...opening.lines.map((line): Step => ({ send: line })),
        ...opening.ids.map((id): Step => ({ send: '', wait: id })),
        { check: (pid) => void (isFront && (before = children(pid))) },
        { send: request(7, 'tools/call', { name: 'no_such_tool', arguments: {} }), wait: 7 },
        { check: (pid) => void (isFront && (after = children(pid))) },
      ];
      const [alone, behind] = await Promise.all([converse(direct, steps(false)), converse(front, steps(true))]);
      expect(Object.keys(alone.answers)).toHaveLength(opening.ids.length + 1);
      expect(behind.answers).toEqual(alone.answers);
      expect(behind.code).toBe(alone.code);
      expect(behind.stderr).not.toContain('omni-mcp lazy');
      expect(before).toEqual([]);
      expect(after).toHaveLength(1);
    });
  }

  it('hands an initialize it would not answer itself to the server', async () => {
    const steps = (): Step[] => [
      { send: initialize(1, '2025-06-18', { clientInfo: { name: 7 } }), wait: 1 },
      { send: initialize(2, '2025-06-18', { _meta: { 'io.modelcontextprotocol/related-task': { taskId: 'x' } } }), wait: 2 },
      { send: request(3, 'tools/list'), wait: 3 },
    ];
    const [alone, behind] = await Promise.all([converse(direct, steps()), converse(front, steps())]);
    expect(Object.keys(alone.answers)).toHaveLength(3);
    expect(behind.answers).toEqual(alone.answers);
    expect(behind.code).toBe(alone.code);
  });
});
