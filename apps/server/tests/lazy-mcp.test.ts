import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// How a server gets to start late (lazy-mcp.ts): asking it once for its answers, keeping them, and proving that
// `omni-mcp lazy` repeats them before any thread is given the front. The server here is a small script that writes
// down each start, and the fronts are shell scripts, plus omni-mcp itself where this run built it.
// lazy-browser.test.ts does the same with the real browser server.

vi.mock('../db.ts', () => {
  throw new Error('db.ts must not be imported by sandbox tests');
});

const DIR = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const dir = mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'omni-lazy-mcp-'));
  process.env.OMNI_DATA_DIR = require('node:path').join(dir, 'data');
  delete process.env.OMNI_CONFIG;
  for (const key of Object.keys(process.env)) if (key.startsWith('PLAYWRIGHT_MCP_')) delete process.env[key];
  return dir;
});

import { answersFile, handshake, lazyCommand, prepareLazy, recordAnswers, refusals, type LazyServer } from '../lazy-mcp.ts';
import { buildMcpConfig, playwrightMcpBin, prepareBrowserMcp } from '../sandbox.ts';
import { browserOutDir, config, paths } from '../config.ts';
import { nativeMcpCandidate } from '../native-mcp.ts';
import { hasMcpBuild } from './support.ts';
import type { Channel } from '../db.ts';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'];
/** How often a server is started to make its record: once per version, and once for what a harness asks before those. */
const ASKED = VERSIONS.length + 1;
/** And to check a front that is the server itself: one handshake, and the same questions before it. */
const CHECKED = 2;
const NOT_FOUND = { code: -32601, message: 'Method not found' };

/**
 * A stdio MCP server that appends its mode and pid to `<dir>/starts` each time it starts. `ok` answers as a server
 * should. The other modes are the ways one can let the asker down.
 */
const SERVER = join(DIR, 'server.mjs');
writeFileSync(
  SERVER,
  `import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const [dir, mode = 'ok'] = process.argv.slice(2);
appendFileSync(dir + '/starts', mode + ' ' + process.pid + '\\n');
if (mode === 'exit') process.exit(3);
const starts = readFileSync(dir + '/starts', 'utf8').trim().split('\\n').length;
const name = mode === 'other' ? 'other' : mode === 'flaky' ? 'look-' + starts : 'look';
const say = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (mode === 'silent' || message.id === undefined) return;
  if (mode === 'garbage') return void process.stdout.write('not json\\n');
  if (mode === 'error') return say({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'no' } });
  if (message.method === 'initialize') say({ result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } }, jsonrpc: '2.0', id: message.id });
  else if (message.method === 'tools/list') say({ result: { tools: [{ name, inputSchema: { type: 'object' } }] }, jsonrpc: '2.0', id: message.id });
  else if (message.method === 'server/discover' && mode === 'discovers') say({ result: { serverInfo: { name: 'fake' } }, jsonrpc: '2.0', id: message.id });
  else say({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
});
`,
);

let runs = 0;
/** A folder of its own for one test's server, so its starts are counted alone. */
const room = () => {
  const dir = join(DIR, `run-${runs++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const server = (dir: string, mode = 'ok') => ({ command: process.execPath, args: [SERVER, dir, mode] });
const starts = (dir: string) => (existsSync(join(dir, 'starts')) ? readFileSync(join(dir, 'starts'), 'utf8').trim().split('\n') : []);
const lazy = (dir: string, mode = 'ok', version = '1.0.0', name = `fake-${runs}`): LazyServer => ({ name, version, probe: server(dir, mode) });

const script = (name: string, body: string) => {
  const file = join(DIR, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
};
/** A front that keeps nothing back: it drops `lazy <answers>` and is the server. */
const THROUGH = script('through', 'shift 2\nexec "$@"');
const BROKEN = script('broken', 'exit 1');

const TOOLS = { tools: [{ name: 'look', inputSchema: { type: 'object' } }] };
const hello = (version: string) => ({ protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } });

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

let log: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('one handshake with a stdio server', () => {
  it('gives what the server answers to initialize in the version asked and to tools/list', async () => {
    const dir = room();
    expect(await handshake(server(dir), '2025-06-18')).toEqual({ initialize: hello('2025-06-18'), tools: TOOLS });
    expect(await handshake(server(dir), '2024-11-05')).toMatchObject({ initialize: { protocolVersion: '2024-11-05' } });
    expect(starts(dir)).toHaveLength(2);
  });

  it('fails with the reason when the server answers an error, writes something else, exits or is not there', async () => {
    const dir = room();
    await expect(handshake(server(dir, 'error'), '2025-06-18')).rejects.toThrow('it answered initialize with an error');
    await expect(handshake(server(dir, 'garbage'), '2025-06-18')).rejects.toThrow('it wrote a line that is not JSON');
    await expect(handshake(server(dir, 'exit'), '2025-06-18')).rejects.toThrow('it exited (3) before it answered');
    await expect(handshake({ command: join(DIR, 'absent'), args: [] }, '2025-06-18')).rejects.toThrow('ENOENT');
  });

  it('gives up on a server that says nothing, and does not leave it running', async () => {
    const dir = room();
    await expect(handshake(server(dir, 'silent'), '2025-06-18', 300)).rejects.toThrow('no answer in 0.3 s');
    const pid = Number(starts(dir)[0]!.split(' ')[1]);
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5000 });
  });
});

describe('what a server does not have', () => {
  it('is its "method not found" for what a harness asks before the handshake', async () => {
    const dir = room();
    expect(await refusals(server(dir))).toEqual({ 'server/discover': NOT_FOUND });
    expect(await refusals(server(dir), ['b/second', 'a/first'])).toEqual({ 'b/second': NOT_FOUND, 'a/first': NOT_FOUND });
    expect(starts(dir)).toHaveLength(2);
  });

  it('leaves out a method the server has or fails another way, and asks nothing when there is nothing to ask', async () => {
    const dir = room();
    expect(await refusals(server(dir, 'discovers'))).toEqual({});
    expect(await refusals(server(dir, 'discovers'), ['server/discover', 'other/method'])).toEqual({ 'other/method': NOT_FOUND });
    expect(await refusals(server(dir, 'error'))).toEqual({});
    expect(await refusals(server(dir), [])).toEqual({});
    expect(starts(dir)).toHaveLength(3);
  });
});

describe('the record of a server', () => {
  it('holds its initialize answer in every protocol version, its tool list and what it does not have', async () => {
    const dir = room();
    const answers = await recordAnswers(server(dir));
    expect(Object.keys(answers.initialize)).toEqual(VERSIONS);
    for (const version of VERSIONS) expect(answers.initialize[version]).toEqual(hello(version));
    expect(answers.tools).toEqual(TOOLS);
    expect(answers.refused).toEqual({ 'server/discover': NOT_FOUND });
    expect(starts(dir)).toHaveLength(ASKED);
  });

  it('is not made of a server whose tool list differs from one start to the next', async () => {
    await expect(recordAnswers(server(room(), 'flaky'))).rejects.toThrow('its tool list changed between two starts');
  });

  it('is kept under the server name, its version and a hash of how it was asked and of its settings in the environment', () => {
    const one: LazyServer = { name: 'playwright-mcp', version: '0.0.83', probe: { command: '/node', args: ['cli.js', '--headless'] } };
    const file = answersFile(one, {});
    expect(dirname(file)).toBe(join(paths.data, 'mcp-answers', 'playwright-mcp'));
    expect(file).toMatch(/\/0\.0\.83-[0-9a-f]{12}\.json$/);
    expect(answersFile(one, { HOME: '/elsewhere', PATH: '/bin' })).toBe(file);
    expect(answersFile({ ...one, version: '0.0.84' }, {})).not.toBe(file);
    expect(answersFile({ ...one, probe: { ...one.probe, args: ['cli.js'] } }, {})).not.toBe(file);
    expect(answersFile({ ...one, probe: { ...one.probe, command: '/electron' } }, {})).not.toBe(file);
    const withCaps = answersFile(one, { PLAYWRIGHT_MCP_CAPS: 'vision' });
    expect(withCaps).not.toBe(file);
    expect(answersFile(one, { PLAYWRIGHT_MCP_CAPS: 'pdf' })).not.toBe(withCaps);
    // The values may be anything. Only a hash of them is in the name.
    expect(answersFile(one, { PLAYWRIGHT_MCP_SECRETS_FILE: 'hunter2' })).not.toContain('hunter2');
  });
});

describe('proving the front before threads get it', () => {
  it('says no, quietly, on an install with no omni-mcp', async () => {
    const dir = room();
    const fake = lazy(dir);
    expect(await prepareLazy(fake, null)).toBe(false);
    expect(lazyCommand(fake.name, server(dir))).toBeNull();
    expect(starts(dir)).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('asks the server, keeps the record and names the front once the front repeats it', async () => {
    const dir = room();
    const fake = lazy(dir);
    expect(await prepareLazy(fake, THROUGH)).toBe(true);
    const file = answersFile(fake);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ initialize: Object.fromEntries(VERSIONS.map((v) => [v, hello(v)])), tools: TOOLS, refused: { 'server/discover': NOT_FOUND } });
    expect(log).toHaveBeenCalledWith(`[mcp] ${fake.name} 1.0.0 starts on a thread's first call to it, behind ${THROUGH} lazy`);
    // Whatever a thread starts the server with goes after the front and its record.
    expect(lazyCommand(fake.name, { command: '/node', args: ['cli.js', '--output-dir', '/out'] })).toEqual({ command: THROUGH, args: ['lazy', file, '/node', 'cli.js', '--output-dir', '/out'] });
    expect(lazyCommand('another', server(dir))).toBeNull();
    // To make the record, and again through this front, which is the server.
    expect(starts(dir)).toHaveLength(ASKED + CHECKED);
  });

  it('reads the record it has at the next server start, and asks again when the file is not a record', async () => {
    const dir = room();
    const fake = lazy(dir);
    await prepareLazy(fake, THROUGH);
    expect(await prepareLazy(fake, THROUGH)).toBe(true);
    expect(starts(dir)).toHaveLength(ASKED + 2 * CHECKED);
    // Cut off, or made before the record held what the server does not have.
    for (const text of ['{"initialize":{}', JSON.stringify({ initialize: { '2025-06-18': hello('2025-06-18') }, tools: TOOLS })]) {
      const before = starts(dir).length;
      writeFileSync(answersFile(fake), text);
      expect(await prepareLazy(fake, THROUGH)).toBe(true);
      expect(starts(dir)).toHaveLength(before + ASKED + CHECKED);
    }
    expect(JSON.parse(readFileSync(answersFile(fake), 'utf8'))).toMatchObject({ tools: TOOLS });
  });

  it('keeps the direct start, with the reason in the log, when the front answers anything else or does not start', async () => {
    const dir = room();
    const fake = lazy(dir);
    const other = script('other', `exec ${process.execPath} ${SERVER} ${dir} other`);
    expect(await prepareLazy(fake, other)).toBe(false);
    expect(warn).toHaveBeenLastCalledWith(`[mcp] ${fake.name} starts with every thread, as before: ${other} lazy did not repeat the record`);
    expect(lazyCommand(fake.name, server(dir))).toBeNull();

    expect(await prepareLazy(fake, BROKEN)).toBe(false);
    expect(warn).toHaveBeenLastCalledWith(`[mcp] ${fake.name} starts with every thread, as before: it exited (1) before it answered`);
    expect(lazyCommand(fake.name, server(dir))).toBeNull();
  });

  it('takes the front back when a later check fails', async () => {
    const dir = room();
    const fake = lazy(dir);
    expect(await prepareLazy(fake, THROUGH)).toBe(true);
    expect(await prepareLazy(fake, BROKEN)).toBe(false);
    expect(lazyCommand(fake.name, server(dir))).toBeNull();
  });

  it('keeps the direct start for a server that cannot be asked, and writes no record', async () => {
    const dir = room();
    const fake = lazy(dir, 'exit');
    expect(await prepareLazy(fake, THROUGH)).toBe(false);
    expect(warn).toHaveBeenLastCalledWith(`[mcp] ${fake.name} starts with every thread, as before: it exited (3) before it answered`);
    expect(existsSync(answersFile(fake))).toBe(false);
  });

  it('goes back to the direct start when the record is gone, as after the data folder was cleaned', async () => {
    const dir = room();
    const fake = lazy(dir);
    await prepareLazy(fake, THROUGH);
    rmSync(answersFile(fake));
    expect(lazyCommand(fake.name, server(dir))).toBeNull();
  });

  it("removes the server's older records when it writes a new one, and no other server's", async () => {
    const dir = room();
    const old = lazy(dir, 'ok', '1.0.0', 'aging');
    const kept = lazy(dir, 'ok', '1.0.0', 'aging-too');
    await prepareLazy(old, THROUGH);
    await prepareLazy(kept, THROUGH);
    const next = { ...old, version: '1.0.1' };
    await prepareLazy(next, THROUGH);
    expect(existsSync(answersFile(old))).toBe(false);
    expect(readdirSync(dirname(answersFile(next)))).toEqual([answersFile(next).slice(dirname(answersFile(next)).length + 1)]);
    expect(existsSync(answersFile(kept))).toBe(true);
  });

  it.skipIf(!hasMcpBuild)('holds for omni-mcp itself: it repeats the record and starts no server to do it', async () => {
    const dir = room();
    const fake = lazy(dir);
    const binary = nativeMcpCandidate();
    expect(await prepareLazy(fake, binary)).toBe(true);
    expect(starts(dir)).toHaveLength(ASKED);
    const front = lazyCommand(fake.name, server(dir))!;
    expect(front.command).toBe(binary);
    for (const version of VERSIONS) expect(await handshake(front, version)).toEqual({ initialize: hello(version), tools: TOOLS });
    expect(await refusals(front)).toEqual({ 'server/discover': NOT_FOUND });
    expect(starts(dir)).toHaveLength(ASKED);
    // A version nobody asked the server about is the server's to answer.
    expect(await handshake(front, '1999-01-01')).toEqual({ initialize: hello('1999-01-01'), tools: TOOLS });
    expect(starts(dir)).toHaveLength(ASKED + 1);
  });

  it.skipIf(!hasMcpBuild)('leaves a method the server has to the server, so a newer server is not answered for', async () => {
    const dir = room();
    const fake = lazy(dir, 'discovers');
    expect(await prepareLazy(fake, nativeMcpCandidate())).toBe(true);
    expect(JSON.parse(readFileSync(answersFile(fake), 'utf8'))).toMatchObject({ refused: {} });
    // Making the record, and the check, which asks what a harness asks: that one question reached the server.
    expect(starts(dir)).toHaveLength(ASKED + 1);
  });
});

describe("the browser server in a thread's config", () => {
  const channel = { id: 'c', name: 'C', browser_headless: 1 } as Channel;
  const browser = () => buildMcpConfig({ threadId: 't', channel, browserBusy: true, omniUrl: 'http://127.0.0.1:4747' }).mcpServers['omni-browser']!;
  const original = { browser: config.browser, lazy: config.browserLazy };
  beforeEach(() => {
    config.browser = true;
    config.browserLazy = true;
  });
  afterAll(() => {
    config.browser = original.browser;
    config.browserLazy = original.lazy;
  });

  it('starts directly until the front is proven, then behind it with the same arguments and environment', async () => {
    const direct = browser();
    expect(direct.command).toBe(process.execPath);
    expect(direct.args.slice(0, 3)).toEqual([playwrightMcpBin(), '--output-dir', browserOutDir('t')]);

    const fake: LazyServer = { name: 'playwright-mcp', version: '0.0.0', probe: server(room()) };
    expect(await prepareLazy(fake, THROUGH)).toBe(true);
    expect(browser()).toEqual({ command: THROUGH, args: ['lazy', answersFile(fake), process.execPath, ...direct.args], env: direct.env });

    expect(await prepareLazy(fake, BROKEN)).toBe(false);
    expect(browser()).toEqual(direct);
  });

  it('is left to start directly with OMNI_BROWSER_LAZY=0 or no browser at all: nothing is asked or written', async () => {
    const records = () => (existsSync(join(paths.data, 'mcp-answers')) ? readdirSync(join(paths.data, 'mcp-answers'), { recursive: true }) : []);
    const before = records();
    config.browserLazy = false;
    await prepareBrowserMcp();
    config.browserLazy = true;
    config.browser = false;
    await prepareBrowserMcp();
    expect(records()).toEqual(before);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
