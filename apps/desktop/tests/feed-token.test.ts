import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_DESKTOP_SETTINGS } from '@omni/shared/desktop-bridge.ts';
import { proofFor } from '../src/backend/launch.ts';

// The install's token from the main process (the notifications feed, Needs you, every Backend.api call) goes only to a
// server that just proved it holds it. A server the app attached to can exit and leave its port to another program
// for the seconds before the backend's watchdog notices, and the feed keeps retrying in that time.
vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null },
  Notification: class {
    static isSupported() {
      return true;
    }
    on() {}
    show() {}
    close() {}
  },
}));
vi.mock('../src/windows.ts', () => ({ omniWindows: () => [] }));
vi.mock('../src/handle.ts', () => ({ handle: () => undefined }));

const { Backend } = await import('../src/backend/index.ts');
const { installNotifications } = await import('../src/notifications.ts');
type Ctx = Parameters<typeof installNotifications>[0];

const TOKEN = 'f'.repeat(64);
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function listen(server: Server, port = 0): Promise<number> {
  await new Promise<void>((done) => server.listen(port, '127.0.0.1', () => done()));
  cleanups.push(() => new Promise<void>((done) => (server.closeAllConnections(), server.close(() => done()))));
  return (server.address() as AddressInfo).port;
}

/** Holds a feed open with one event, as the server's /api/feed does. */
function feed(res: import('node:http').ServerResponse) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write('data: {"type":"needs_you"}\n\n');
}

describe("the install's token from the main process", () => {
  it('never reaches a program that takes the port after the server the app attached to exits', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omni-feed-token-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'api-token'), TOKEN);

    // This install's Omni, which the app attaches to.
    let fed: () => void = () => undefined;
    const followed = new Promise<void>((done) => (fed = done));
    let port = 0;
    const omni = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/api/auth/proof') return void res.end(JSON.stringify({ proof: proofFor(TOKEN, port, url.searchParams.get('nonce') ?? '') }));
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return void res.writeHead(401).end('{}');
      if (url.pathname === '/api/feed') return void (feed(res), fed());
      res.end(url.pathname === '/api/channels' ? '[]' : '{"items":[]}');
    });
    port = await listen(omni);

    // A watchdog slower than the feed's first retries: the gap the token must not cross.
    const backend = new Backend(
      { port, dataDir, logFile: join(root, 'server.log'), bundled: true, appRoot: root, binary: process.execPath, shimDir: null, recordFile: null, home: root },
      { loginPath: async () => null, watchMs: 60_000 },
    );
    cleanups.push(() => backend.stop());
    expect(await backend.start()).toEqual({ kind: 'ready' });
    const ctx = { backend, settings: { get: () => DEFAULT_DESKTOP_SETTINGS }, paths: { icon: null }, showMain: () => undefined } as unknown as Ctx;
    installNotifications(ctx);
    await followed;

    // The server exits, and another program takes its port at once.
    await new Promise<void>((done) => (omni.closeAllConnections(), omni.close(() => done())));
    const seen: string[] = [];
    const other = createServer((req, res) => {
      seen.push(`${req.method} ${new URL(req.url ?? '/', 'http://127.0.0.1').pathname} ${req.headers.authorization ?? 'no token'}`);
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/api/auth/proof') return void res.end(JSON.stringify({ proof: 'not-a-proof' }));
      if (url.pathname === '/api/feed') return void feed(res);
      res.end(url.pathname === '/api/channels' ? '[]' : '{"items":[]}');
    });
    await listen(other, port);

    // The feed retries after 1 s and again 2 s later, while the backend still counts the server as ready.
    await sleep(3_500);
    expect(backend.current.kind).toBe('ready');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((line) => !line.endsWith('no token'))).toEqual([]);
    expect(seen.every((line) => line.startsWith('GET /api/auth/proof '))).toBe(true);
    // Any other call from the main process in that gap refuses rather than send it.
    await expect(backend.api('/api/status')).rejects.toThrow(`the server on port ${port} did not prove it is this install`);
    expect(seen.filter((line) => !line.endsWith('no token'))).toEqual([]);
  }, 15_000);
});
