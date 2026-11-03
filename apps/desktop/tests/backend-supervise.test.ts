// Backend against real processes: a fake Omni server script it starts on this test's Node, and an in-process
// server it attaches to. The fake answers /api/auth/proof as Omni does, and /exit?code=N exits with N.
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Backend, isRecordedServer, parseRecord, type BackendState } from '../src/backend/index.ts';
import { exitMessage, probePort, proofFor } from '../src/backend/launch.ts';
import { exitCode, stopGroup } from '../src/backend/process.ts';

const TOKEN = 'e'.repeat(64);

const FAKE_SERVER = `
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const port = Number(process.env.OMNI_PORT);
const dir = process.env.OMNI_DATA_DIR;
appendFileSync(join(dir, 'starts'), 'x');
console.log('fake server starting on', port, 'as', process.env.OMNI_SUPERVISOR);
if (existsSync(join(dir, 'crash'))) {
  console.error('boom: cannot open the database');
  process.exit(3);
}
const token = readFileSync(join(dir, 'api-token'), 'utf8').trim();
createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/api/auth/proof') {
    const proof = createHmac('sha256', token).update('omni-proof:' + port + ':' + url.searchParams.get('nonce')).digest('hex');
    res.end(JSON.stringify({ proof }));
    return;
  }
  if (url.pathname === '/api/status') {
    if (req.headers.authorization !== 'Bearer ' + token) { res.statusCode = 401; res.end('{}'); return; }
    res.end(JSON.stringify({ running: 0, server: { pid: process.pid } }));
    return;
  }
  if (url.pathname === '/exit') {
    const code = Number(url.searchParams.get('code'));
    console.error('exiting with', code);
    res.end('{}');
    setTimeout(() => process.exit(code), 20);
    return;
  }
  res.statusCode = 404;
  res.end('{}');
}).listen(port, '127.0.0.1');
`;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

interface Rig {
  backend: Backend;
  root: string;
  dataDir: string;
  logFile: string;
  recordFile: string;
  shimDir: string;
  port: number;
  advance: (ms: number) => void;
  /** Another launch of the app on the same port, data dir and note: a later start of the app. */
  relaunch: () => Backend;
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function rig(loginPath: () => Promise<string | null> = async () => process.env.PATH ?? '/usr/bin:/bin'): Promise<Rig> {
  const root = mkdtempSync(join(tmpdir(), 'omni-backend-'));
  const appRoot = join(root, 'app');
  const dataDir = join(root, 'data');
  mkdirSync(join(appRoot, 'apps', 'server'), { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(appRoot, 'apps', 'server', 'index.mjs'), FAKE_SERVER);
  writeFileSync(join(dataDir, 'api-token'), TOKEN);
  const port = await freePort();
  let clock = 1_000_000;
  const logFile = join(root, 'logs', 'server.log');
  const recordFile = join(root, 'userData', `server-${port}.json`);
  const shimDir = join(root, 'userData', 'bin');
  const backends: Backend[] = [];
  const make = () => {
    const backend = new Backend(
      { port, dataDir, logFile, bundled: true, appRoot, binary: process.execPath, shimDir, recordFile, home: root },
      { now: () => clock, loginPath, watchMs: 100 },
    );
    backends.push(backend);
    return backend;
  };
  const backend = make();
  cleanups.push(async () => {
    for (const b of backends) await b.stop();
    rmSync(root, { recursive: true, force: true });
  });
  return { backend, root, dataDir, logFile, recordFile, shimDir, port, advance: (ms) => (clock += ms), relaunch: make };
}

function next(backend: Backend, kind: BackendState['kind'], timeoutMs = 15_000): Promise<BackendState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`no ${kind} state within ${timeoutMs}ms; now ${backend.current.kind}`));
    }, timeoutMs);
    const off = backend.onState((state) => {
      if (state.kind !== kind) return;
      clearTimeout(timer);
      off();
      resolve(state);
    });
  });
}

const starts = (r: Rig) => readFileSync(join(r.dataDir, 'starts'), 'utf8').length;
const exitWith = (r: Rig, code: number) => fetch(`http://127.0.0.1:${r.port}/exit?code=${code}`).then((res) => res.text());

describe('Backend', () => {
  it('attaches to a server that proves it holds this install token, and leaves it running on stop', async () => {
    const r = await rig();
    const server: Server = createServer((req, res) => {
      const nonce = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('nonce') ?? '';
      res.end(JSON.stringify({ proof: proofFor(TOKEN, r.port, nonce) }));
    });
    await new Promise<void>((resolve) => server.listen(r.port, '127.0.0.1', () => resolve()));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));

    expect(await r.backend.start()).toEqual({ kind: 'ready' });
    expect(r.backend.info().startedHere).toBe(false);
    await r.backend.stop();
    expect(r.backend.current.kind).toBe('stopped');
    expect((await probePort(r.port, TOKEN)).kind).toBe('omni');
  });

  it('starts a server on a free port, with the data dir and supervisor it was given', async () => {
    const r = await rig();
    expect(r.backend.hasBeenReady).toBe(false);
    expect(await r.backend.start()).toEqual({ kind: 'ready' });
    expect(r.backend.info()).toMatchObject({ port: r.port, dataDir: r.dataDir, startedHere: true });
    expect(r.backend.hasBeenReady).toBe(true);
    expect(readFileSync(r.logFile, 'utf8')).toContain(`fake server starting on ${r.port} as desktop`);
    await r.backend.stop();
    expect((await probePort(r.port, TOKEN)).kind).toBe('free');
  });

  it('starts the server again after it exits with 75 having run long enough', async () => {
    const r = await rig();
    await r.backend.start();
    r.advance(60_000);
    const restarting = next(r.backend, 'restarting');
    const ready = next(r.backend, 'ready');
    await exitWith(r, 75);
    await restarting;
    expect(await ready).toEqual({ kind: 'ready' });
    expect(starts(r)).toBe(2);
    expect((await probePort(r.port, TOKEN)).kind).toBe('omni');
  });

  it('does not start again when 75 comes right after a start', async () => {
    const r = await rig();
    await r.backend.start();
    const failed = next(r.backend, 'failed');
    await exitWith(r, 75);
    expect(await failed).toMatchObject({ kind: 'failed', message: 'The server stopped with exit code 75.' });
    expect(starts(r)).toBe(1);
  });

  it('ends in failed with the log tail when the server crashes after ready', async () => {
    const r = await rig();
    await r.backend.start();
    r.advance(60_000);
    const failed = next(r.backend, 'failed');
    await exitWith(r, 1);
    const state = await failed;
    expect(state).toMatchObject({ kind: 'failed', message: 'The server stopped with exit code 1.' });
    if (state.kind === 'failed') expect(state.logTail).toContain('exiting with 1');
    expect(r.backend.info().startedHere).toBe(false);
  });

  it('ends in failed with the log tail when the server crashes while starting', async () => {
    const r = await rig();
    writeFileSync(join(r.dataDir, 'crash'), '');
    const state = await r.backend.start();
    expect(state).toMatchObject({ kind: 'failed', message: 'The server stopped while starting, with exit code 3.' });
    if (state.kind === 'failed') expect(state.logTail).toContain('boom: cannot open the database');
    expect(r.backend.hasBeenReady).toBe(false);

    rmSync(join(r.dataDir, 'crash'));
    expect(await r.backend.restart()).toEqual({ kind: 'ready' });
  });

  it('starts nothing when stopped while it reads the login shell PATH', async () => {
    let release: (path: string) => void = () => {};
    const r = await rig(() => new Promise((resolve) => (release = resolve)));
    const starting = r.backend.start();
    await vi.waitFor(() => expect(r.backend.current.kind).toBe('starting'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    await r.backend.stop();
    release(process.env.PATH ?? '/usr/bin:/bin');
    expect(await starting).toEqual({ kind: 'stopped' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await probePort(r.port, TOKEN)).kind).toBe('free');
  });

  it('leaves one server, which stop stops, when restarts overlap a start', async () => {
    let release: (path: string) => void = () => {};
    const r = await rig(() => new Promise((resolve) => (release = resolve)));
    const first = r.backend.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = r.backend.restart();
    const third = r.backend.restart();
    release(process.env.PATH ?? '/usr/bin:/bin');
    const states = await Promise.all([first, second, third]);
    expect(states.at(-1)).toEqual({ kind: 'ready' });
    expect(r.backend.current).toEqual({ kind: 'ready' });
    expect(states.some((state) => state.kind === 'failed')).toBe(false);
    expect(starts(r)).toBe(1);
    await r.backend.stop();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await probePort(r.port, TOKEN)).kind).toBe('free');
  });

  it('knows a server an earlier launch started and left running as its own, and stops it on stop', async () => {
    const r = await rig();
    await r.backend.start();
    expect(r.backend.info().startedHere).toBe(true);
    expect(JSON.parse(readFileSync(r.recordFile, 'utf8'))).toEqual({ pid: expect.any(Number), port: r.port, dataDir: r.dataDir });
    // Quit with Keep Server Running: the app goes, and the server and its note stay.
    const later = r.relaunch();
    expect(await later.start()).toEqual({ kind: 'ready' });
    expect(later.info().startedHere).toBe(true);
    expect(starts(r)).toBe(1);
    await later.stop();
    await vi.waitFor(async () => expect((await probePort(r.port, TOKEN)).kind).toBe('free'));
    expect(existsSync(r.recordFile)).toBe(false);
  });

  it('knows its noted server still runs before a later launch has adopted it', async () => {
    const r = await rig();
    await r.backend.start();
    const later = r.relaunch();
    expect(later.info().startedHere).toBe(false);
    expect(later.recordedServerUp()).toBe(true);
    await r.backend.stop();
    expect(later.recordedServerUp()).toBe(false);
  });

  it('treats a server whose pid is not the noted one as started elsewhere', async () => {
    const r = await rig();
    await r.backend.start();
    const record = JSON.parse(readFileSync(r.recordFile, 'utf8'));
    writeFileSync(r.recordFile, JSON.stringify({ ...record, pid: record.pid + 100_000 }));
    const later = r.relaunch();
    await later.start();
    expect(later.info().startedHere).toBe(false);
    await later.stop();
    expect((await probePort(r.port, TOKEN)).kind).toBe('omni');
  });

  it('ends in failed when a server it attached to stops answering', async () => {
    const r = await rig();
    await r.backend.start();
    const later = r.relaunch();
    await later.start();
    const failed = next(later, 'failed');
    await stopGroup(JSON.parse(readFileSync(r.recordFile, 'utf8')).pid, 3000);
    expect(await failed).toMatchObject({ kind: 'failed', message: `The server on port ${r.port} stopped answering.` });
    expect(later.info().startedHere).toBe(false);
    expect(later.current.kind).toBe('failed');
    // Try Again starts a server of its own.
    expect(await later.restart()).toEqual({ kind: 'ready' });
    expect(later.info().startedHere).toBe(true);
  });

  it('writes the node shim when it starts a server, and not when it attaches', async () => {
    const r = await rig();
    const server: Server = createServer((req, res) => {
      const nonce = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('nonce') ?? '';
      res.end(JSON.stringify({ proof: proofFor(TOKEN, r.port, nonce) }));
    });
    await new Promise<void>((resolve) => server.listen(r.port, '127.0.0.1', () => resolve()));
    await r.backend.start();
    expect(existsSync(join(r.shimDir, 'node'))).toBe(false);
    await r.backend.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await r.backend.start();
    expect(readFileSync(join(r.shimDir, 'node'), 'utf8')).toContain(process.execPath);
  });

  it('says a server killed by a signal was killed, not that it stopped', async () => {
    const r = await rig();
    await r.backend.start();
    r.advance(60_000);
    const failed = next(r.backend, 'failed');
    process.kill(-JSON.parse(readFileSync(r.recordFile, 'utf8')).pid, 'SIGKILL');
    expect(await failed).toMatchObject({ kind: 'failed', message: 'The server was killed by SIGKILL.' });
  });

  it('refuses a port held by something that is not Omni', async () => {
    const r = await rig();
    const server = createServer((_req, res) => res.end('hello'));
    await new Promise<void>((resolve) => server.listen(r.port, '127.0.0.1', () => resolve()));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const state = await r.backend.start();
    expect(state.kind).toBe('failed');
    if (state.kind === 'failed') expect(state.message).toContain(`Port ${r.port} answers, but not as an Omni server.`);
  });
});

describe('exit codes and the server note', () => {
  it('reports a signal as a shell does, and words a crash as one', () => {
    expect(exitCode(0, null)).toBe(0);
    expect(exitCode(3, null)).toBe(3);
    expect(exitCode(null, 'SIGKILL')).toBe(137);
    expect(exitMessage(0)).toBe('The server stopped.');
    expect(exitMessage(137, 'SIGKILL')).toBe('The server was killed by SIGKILL.');
    expect(exitMessage(139, 'SIGSEGV')).toBe('The server crashed (SIGSEGV).');
  });

  it('matches a note only to the server on its port, data dir and pid', () => {
    const record = parseRecord({ pid: 4242, port: 4747, dataDir: '/d' });
    expect(record).toEqual({ pid: 4242, port: 4747, dataDir: '/d' });
    expect(isRecordedServer(record, { port: 4747, dataDir: '/d', pid: 4242 })).toBe(true);
    expect(isRecordedServer(record, { port: 4747, dataDir: '/d', pid: 4243 })).toBe(false);
    expect(isRecordedServer(record, { port: 4748, dataDir: '/d', pid: 4242 })).toBe(false);
    expect(isRecordedServer(record, { port: 4747, dataDir: '/e', pid: 4242 })).toBe(false);
    expect(isRecordedServer(null, { port: 4747, dataDir: '/d', pid: 4242 })).toBe(false);
    for (const raw of [null, 'x', { pid: 1, port: 4747, dataDir: '/d' }, { pid: '4242', port: 4747, dataDir: '/d' }, { pid: 4242, port: 4747 }]) {
      expect(parseRecord(raw)).toBeNull();
    }
  });
});
