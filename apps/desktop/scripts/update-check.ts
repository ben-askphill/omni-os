// The app's self-update, end to end on Linux: builds this checkout as two AppImages (0.1.0, and 0.1.1 as the
// update), serves 0.1.1 from a local feed, and runs each way of installing it against a copy of 0.1.0 that starts
// its own server, with a turn running on fake-claude where a case needs one. Every case checks that the app never
// installs while a server it started keeps running, and that a relaunched app starts a server of its own.
//
//   npx tsx scripts/update-check.ts [--old <0.1.0 AppImage> --feed <folder with latest-linux.yml>] [--only <case>]
//
// --old and --feed skip the builds. A build for --old must name the feed this runs, OMNI_UPDATE_URL below.
// Exits 0 when every case passed. It never touches port 4747 or a checkout's data/.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DesktopBridge, DesktopUpdateView } from '@omni/shared/desktop-bridge.ts';
import type { ElectronApplication, Page } from 'playwright';
import { tokenFile } from '../src/backend/launch.ts';

const DESKTOP = resolve(import.meta.dirname, '..');
const FAKE_CLAUDE = resolve(DESKTOP, '../../packages/test-fixtures/fake-claude.mjs');
const FEED_PORT = 47_901;
const APP_PORT = 47_911;
const FEED_URL = `http://127.0.0.1:${FEED_PORT}/`;

type Trigger = 'relaunch' | 'quit';

interface Case {
  name: string;
  trigger: Trigger;
  /** How long the turn started before the trigger runs, or null for none. */
  turnMs: number | null;
  /** The button the quit or update question gets: the first of these it offers, else Cancel. */
  prefer: string[];
  expect: Partial<Outcome>;
}

interface Outcome {
  /** The buttons of the question the app asked, or null when it asked none. */
  asked: string[] | null;
  installed: boolean;
  oldServerAlive: boolean;
  /** The 0.1.0 app still runs. */
  appOpen: boolean;
  /** A new app answers on the port with a server it started, or false when none does. */
  relaunched: boolean;
  /** How the case's turn ended, as the relaunched app's server reports it: done when it was let finish. */
  turn: string | null;
}

const CASES: Case[] = [
  {
    name: 'relaunch with a turn running offers no Keep Server Running',
    trigger: 'relaunch',
    turnMs: 600_000,
    prefer: ['Keep Server Running'],
    expect: { asked: ['Update When They Finish', 'Stop Them and Update', 'Cancel'], installed: false, oldServerAlive: true, appOpen: true },
  },
  {
    name: 'relaunch, Stop Them and Update',
    trigger: 'relaunch',
    turnMs: 600_000,
    prefer: ['Stop Them and Update'],
    expect: { installed: true, oldServerAlive: false, appOpen: false, relaunched: true, turn: 'stopped' },
  },
  {
    name: 'relaunch, Update When They Finish',
    trigger: 'relaunch',
    turnMs: 15_000,
    prefer: ['Update When They Finish'],
    expect: { installed: true, oldServerAlive: false, appOpen: false, relaunched: true, turn: 'done' },
  },
  {
    name: 'relaunch with no turn running',
    trigger: 'relaunch',
    turnMs: null,
    prefer: ['Cancel'],
    expect: { asked: null, installed: true, oldServerAlive: false, appOpen: false, relaunched: true },
  },
  {
    name: 'quit, Keep Server Running',
    trigger: 'quit',
    turnMs: 600_000,
    prefer: ['Keep Server Running'],
    expect: { installed: false, oldServerAlive: true, appOpen: false, relaunched: false },
  },
  {
    name: 'quit, Stop Them and Quit',
    trigger: 'quit',
    turnMs: 600_000,
    prefer: ['Stop Them and Quit'],
    expect: { installed: true, oldServerAlive: false, appOpen: false, relaunched: false },
  },
  {
    name: 'quit with no turn running',
    trigger: 'quit',
    turnMs: null,
    prefer: ['Cancel'],
    expect: { asked: null, installed: true, oldServerAlive: false, appOpen: false, relaunched: false },
  },
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function until<T>(what: string, ms: number, probe: () => Promise<T | null | undefined | false> | T | null | undefined | false): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await probe();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function sha(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Stops the process group a server leads, which takes its harness CLIs with it. */
function stopGroup(pid: number): void {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, 'SIGKILL');
    } catch {
      // Gone already.
    }
  }
}

function build(version: string, out: string): string {
  const result = spawnSync('npx', ['--no-install', 'tsx', 'scripts/dist.ts', '--platform', 'linux', '--arch', 'x64', '--host-glibc', '--', `-c.extraMetadata.version=${version}`], {
    cwd: DESKTOP,
    stdio: 'inherit',
    env: { ...process.env, OMNI_UPDATE_URL: FEED_URL },
  });
  if (result.status !== 0) throw new Error(`the ${version} build failed`);
  mkdirSync(out, { recursive: true });
  const name = `Omni-${version}-linux-x86_64.AppImage`;
  copyFileSync(join(DESKTOP, 'release', name), join(out, name));
  if (existsSync(join(DESKTOP, 'release', 'latest-linux.yml'))) copyFileSync(join(DESKTOP, 'release', 'latest-linux.yml'), join(out, 'latest-linux.yml'));
  return join(out, name);
}

function serveFeed(dir: string): Promise<Server> {
  const server = createServer((req, res) => {
    const file = join(dir, decodeURIComponent(new URL(req.url ?? '/', FEED_URL).pathname).replace(/^\/+/, ''));
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    const size = statSync(file).size;
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1, 'accept-ranges': 'bytes' });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-length': size, 'accept-ranges': 'bytes' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok, fail) => server.once('error', fail).listen(FEED_PORT, '127.0.0.1', () => ok(server)));
}

interface Status {
  running?: number;
  server?: { pid?: number };
}

async function status(dataDir: string): Promise<Status | null> {
  try {
    const token = readFileSync(tokenFile(dataDir), 'utf8').trim();
    const res = await fetch(`http://127.0.0.1:${APP_PORT}/api/status`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) });
    return res.ok ? ((await res.json()) as Status) : null;
  } catch {
    return null;
  }
}

/** Starts a turn of `ms` on fake-claude and returns its thread's id. */
async function startTurn(dataDir: string, ms: number): Promise<string> {
  const token = readFileSync(tokenFile(dataDir), 'utf8').trim();
  const res = await fetch(`http://127.0.0.1:${APP_PORT}/api/threads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ channel: 'conductor', role: 'conductor', prompt: `TOOL:${ms}` }),
  });
  if (!res.ok) throw new Error(`could not start a turn: ${res.status} ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };
  await until('the turn to run', 30_000, async () => ((await status(dataDir))?.running ?? 0) > 0);
  return id;
}

async function threadStatus(dataDir: string, id: string): Promise<string | null> {
  try {
    const token = readFileSync(tokenFile(dataDir), 'utf8').trim();
    const res = await fetch(`http://127.0.0.1:${APP_PORT}/api/threads?limit=200`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    const threads = (await res.json()) as { id: string; status: string }[];
    return threads.find((t) => t.id === id)?.status ?? null;
  } catch {
    return null;
  }
}

/** True when `pid` runs for this case: its command line or environment names the case's data dir. */
function ofCase(pid: number, dataDir: string): boolean {
  if (pid <= 1 || !alive(pid)) return false;
  try {
    return [`/proc/${pid}/cmdline`, `/proc/${pid}/environ`].some((file) => readFileSync(file).toString().includes(dataDir));
  } catch {
    return false;
  }
}

/** The pid in a server note the app wrote (`server-<port>.json`), or null. */
function notedServer(userData: string): number | null {
  try {
    const pid = (JSON.parse(readFileSync(join(userData, `server-${APP_PORT}.json`), 'utf8')) as { pid?: unknown }).pid;
    return typeof pid === 'number' ? pid : null;
  } catch {
    return null;
  }
}

/** The pid in Chromium's single-instance lock, `<host>-<pid>`, of whichever app holds that user-data dir. */
function lockHolder(userData: string): number | null {
  try {
    const pid = Number(readlinkSync(join(userData, 'SingletonLock')).split('-').pop());
    return Number.isInteger(pid) && alive(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function runCase(test: Case, oldApp: string, newApp: string, root: string): Promise<{ outcome: Outcome; log: string }> {
  const dir = mkdtempSync(join(root, 'case-'));
  const home = join(dir, 'home');
  const bin = join(dir, 'bin');
  const dataDir = join(dir, 'data');
  const userData = join(dir, 'user-data');
  const appImage = join(dir, 'app', 'Omni.AppImage');
  for (const d of [home, bin, dataDir, join(dir, 'app')]) mkdirSync(d, { recursive: true });
  copyFileSync(oldApp, appImage);
  chmodSync(appImage, 0o755);
  const oldSha = sha(appImage);
  const newSha = sha(newApp);
  // The server takes PATH from the login shell. This home's puts fake-claude first, so no turn spends a plan.
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_CLAUDE}" "$@"\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  writeFileSync(join(home, '.bash_profile'), `export PATH="${bin}:/usr/local/bin:/usr/bin:/bin"\n`);
  writeFileSync(join(home, '.bashrc'), '');

  const env: Record<string, string> = {};
  for (const key of ['DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_SESSION_TYPE', 'LANG']) {
    if (process.env[key]) env[key] = process.env[key] as string;
  }
  Object.assign(env, { HOME: home, SHELL: '/bin/bash', PATH: '/usr/local/bin:/usr/bin:/bin', XDG_CACHE_HOME: join(home, '.cache'), XDG_CONFIG_HOME: join(home, '.config') });

  const log: string[] = [];
  const { _electron } = await import('playwright');
  const app: ElectronApplication = await _electron.launch({
    executablePath: appImage,
    args: ['--port', String(APP_PORT), '--data-dir', dataDir, `--user-data-dir=${userData}`],
    env,
    timeout: 60_000,
  });
  app.process().stdout?.on('data', (d: Buffer) => log.push(d.toString()));
  app.process().stderr?.on('data', (d: Buffer) => log.push(d.toString()));
  const exited = new Promise<void>((r) => app.process().once('exit', () => r()));
  let appGone = false;
  void exited.then(() => {
    appGone = true;
  });

  let oldServer = 0;
  let relaunchedServer = 0;
  try {
    const ready = await until('the server', 60_000, () => status(dataDir));
    oldServer = ready.server?.pid ?? 0;
    const page: Page = await until('the main window', 30_000, () => app.windows().find((w) => !w.url().startsWith('devtools:')));
    await until('the update to download', 120_000, async () => {
      const view = await page.evaluate(() => (window as unknown as { omniDesktop: DesktopBridge }).omniDesktop.updates.get() as Promise<DesktopUpdateView>);
      if (view.state === 'error') throw new Error(`the update failed: ${view.message}`);
      return view.state === 'ready';
    });
    const turn = test.turnMs === null ? null : await startTurn(dataDir, test.turnMs);

    const askedFile = join(dir, 'asked.json');
    await app.evaluate(
      ({ dialog }, input) => {
        const fs = process.getBuiltinModule('node:fs');
        dialog.showMessageBox = (async (...args: unknown[]) => {
          const options = args.at(-1) as Electron.MessageBoxOptions;
          const buttons = options.buttons ?? [];
          fs.writeFileSync(input.askedFile, JSON.stringify(buttons));
          const choice = input.prefer.find((b) => buttons.includes(b)) ?? 'Cancel';
          return { response: Math.max(0, buttons.indexOf(choice)), checkboxChecked: false };
        }) as typeof dialog.showMessageBox;
      },
      { askedFile, prefer: test.prefer },
    );
    if (test.trigger === 'relaunch') {
      await page.evaluate(() => (window as unknown as { omniDesktop: DesktopBridge }).omniDesktop.updates.install());
    } else {
      await app.evaluate(({ app: electronApp }) => electronApp.quit());
    }

    // A wait for turns to finish holds the app open until the turn ends, then it goes.
    const settleMs = test.turnMs !== null && test.turnMs < 60_000 ? test.turnMs + 30_000 : 20_000;
    await Promise.race([exited, sleep(settleMs)]);
    if (appGone) {
      // The relaunched copy, if any, takes the instance lock and starts a server of its own.
      await sleep(3000);
      relaunchedServer = await until('a relaunched app with its own server', 30_000, async () => {
        const pid = lockHolder(userData) ? (await status(dataDir))?.server?.pid : undefined;
        return pid && pid !== oldServer ? pid : null;
      }).catch(() => 0);
    }
    const outcome: Outcome = {
      asked: existsSync(askedFile) ? (JSON.parse(readFileSync(askedFile, 'utf8')) as string[]) : null,
      installed: sha(appImage) === newSha && oldSha !== newSha,
      oldServerAlive: alive(oldServer),
      appOpen: !appGone,
      relaunched: relaunchedServer > 0 && relaunchedServer !== oldServer,
      turn: turn && relaunchedServer ? await threadStatus(dataDir, turn) : null,
    };
    return { outcome, log: log.join('') };
  } finally {
    if (!appGone) app.process().kill('SIGKILL');
    // A relaunch still on its way takes the lock and starts its server a moment later.
    await sleep(2000);
    for (const pid of [lockHolder(userData), notedServer(userData), oldServer, relaunchedServer]) {
      if (pid && ofCase(pid, dataDir)) stopGroup(pid);
    }
    await sleep(500);
  }
}

function differences(want: Partial<Outcome>, got: Outcome): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(want) as [keyof Outcome, unknown][]) {
    if (JSON.stringify(got[key]) !== JSON.stringify(value)) out.push(`${key}: want ${JSON.stringify(value)}, got ${JSON.stringify(got[key])}`);
  }
  if (got.installed && got.oldServerAlive) out.push('installed while the server it started kept running');
  return out;
}

async function main(argv: string[]): Promise<number> {
  if (process.platform !== 'linux') {
    console.error('update-check: Linux only. Squirrel.Mac installs only a signed app.');
    return 2;
  }
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = mkdtempSync(join(tmpdir(), 'omni-update-check-'));
  const feed = arg('--feed') ? resolve(arg('--feed') as string) : join(root, 'feed');
  const oldApp = arg('--old') ? resolve(arg('--old') as string) : null;
  const only = arg('--only');
  const old = oldApp ?? build('0.1.0', join(root, 'old'));
  if (!arg('--feed')) build('0.1.1', feed);
  const yml = readFileSync(join(feed, 'latest-linux.yml'), 'utf8');
  const newApp = join(feed, yml.match(/^path:\s*(\S+)/m)?.[1] ?? '');
  const server = await serveFeed(feed);
  let failed = 0;
  try {
    for (const test of CASES.filter((c) => !only || c.name.includes(only))) {
      try {
        const { outcome, log } = await runCase(test, old, newApp, root);
        const diff = differences(test.expect, outcome);
        console.log(`${diff.length ? 'FAIL' : 'ok  '} ${test.name}`);
        for (const line of diff) console.log(`       ${line}`);
        if (diff.length) {
          failed++;
          console.log(log.split('\n').filter((l) => l.includes('[omni]')).map((l) => `       | ${l}`).join('\n'));
        }
      } catch (err) {
        failed++;
        console.log(`FAIL ${test.name}\n       ${(err as Error).message}`);
      }
    }
  } finally {
    server.close();
  }
  if (!failed) rmSync(root, { recursive: true, force: true });
  else console.log(`update-check: cases and logs kept in ${root}`);
  console.log(`update-check: ${failed ? `${failed} failed` : 'every case passed'}`);
  return failed ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error('update-check:', err);
    process.exit(1);
  },
);
