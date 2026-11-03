// The activity monitor (prototypes/activity-monitor): a sampler on :4791 and its dashboard in a window. The app
// starts the sampler on its own binary as Node unless a monitor already answers there, and stops only the one it
// started. Its window has a session of its own: whatever answers on the port gets
// none of the app's cookies, which sign in to the Omni API.
import { BrowserWindow, dialog } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AppContext } from './context.ts';
import { readTail, spawnServer, stopGroup, type Spawned } from './backend/process.ts';
import { bringForward } from './windows.ts';

export const MONITOR_PORT = 4791;
export const MONITOR_SCRIPT = 'prototypes/activity-monitor/sampler.mjs';
/** The page's <title>: how a probe tells the monitor from another program on the port. */
const MONITOR_TITLE = 'Omni Activity';
const START_TIMEOUT_MS = 10_000;
/** In memory, and no other window's: the monitor's page is whatever holds the port, which this app cannot vouch for. */
export const MONITOR_PARTITION = 'omni-monitor';

export type MonitorStart = { ok: true } | { ok: false; message: string };

let spawned: Spawned | null = null;
let starting: Promise<MonitorStart> | null = null;
let monitorWindow: BrowserWindow | null = null;

export function monitorUrl(port = MONITOR_PORT): string {
  return `http://127.0.0.1:${port}/`;
}

export function isMonitorPage(status: number, body: string): boolean {
  return status === 200 && body.slice(0, 2048).includes(`<title>${MONITOR_TITLE}</title>`);
}

async function answers(port: number): Promise<boolean> {
  try {
    const res = await fetch(monitorUrl(port), { signal: AbortSignal.timeout(1500) });
    return isMonitorPage(res.status, await res.text());
  } catch {
    return false;
  }
}

/** What the sampler reads: where the CLIs keep their transcripts, and the tools it samples the system with. */
const MONITOR_PASSTHROUGH = ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'PATH', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME'] as const;

/** The sampler's environment, on this app's binary acting as Node. */
export function monitorEnv(app: NodeJS.ProcessEnv, port: number): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of MONITOR_PASSTHROUGH) {
    const value = app[key];
    if (value) env[key] = value;
  }
  env.ELECTRON_RUN_AS_NODE = '1';
  env.MONITOR_PORT = String(port);
  return env;
}

/** True for a URL on the monitor's own origin. */
export function onMonitor(url: string, port = MONITOR_PORT): boolean {
  try {
    return new URL(url).origin === new URL(monitorUrl(port)).origin;
  } catch {
    return false;
  }
}

async function start(ctx: AppContext, port: number): Promise<MonitorStart> {
  // The sampler reads macOS tools (vm_stat, sysctl) and exits elsewhere, so elsewhere nothing on the port is it.
  if (process.platform !== 'darwin') return { ok: false, message: 'The activity monitor runs on macOS only.' };
  if (await answers(port)) return { ok: true };
  const script = join(ctx.paths.appRoot, MONITOR_SCRIPT);
  if (!existsSync(script)) return { ok: false, message: `${MONITOR_SCRIPT} is not in ${ctx.paths.appRoot}.` };
  const logFile = join(dirname(ctx.backend.config.logFile), 'monitor.log');
  let child: Spawned;
  try {
    child = spawnServer({ command: process.execPath, args: [script], cwd: ctx.paths.appRoot, env: monitorEnv(process.env, port), logFile });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  spawned = child;
  const end = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < end) {
    if (spawned !== child) return { ok: false, message: 'The activity monitor was stopped while starting.' };
    if (await answers(port)) return { ok: true };
    if (child.exited() !== null) {
      spawned = null;
      const last = readTail(logFile, 1);
      return { ok: false, message: `The activity monitor stopped while starting.${last ? ` ${last}` : ''}` };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { ok: false, message: `The activity monitor did not answer on port ${port} within ${START_TIMEOUT_MS / 1000} seconds.` };
}

/** Attaches to a monitor that answers, else starts one. Calls made while one starts share it. */
export function startActivityMonitor(ctx: AppContext, port = MONITOR_PORT): Promise<MonitorStart> {
  starting ??= start(ctx, port).finally(() => {
    starting = null;
  });
  return starting;
}

/** Stops a monitor this app started. One that was already there is left alone. */
export async function stopActivityMonitor(): Promise<void> {
  const child = spawned;
  spawned = null;
  if (child && child.exited() === null) await stopGroup(child.pid, 3000);
}

export function openActivityMonitor(ctx: AppContext): void {
  if (monitorWindow && !monitorWindow.isDestroyed()) {
    bringForward(monitorWindow);
    return;
  }
  void startActivityMonitor(ctx).then((result) => {
    if (!result.ok) {
      void dialog.showMessageBox({ type: 'warning', message: 'The activity monitor could not start', detail: result.message, noLink: true });
      return;
    }
    if (monitorWindow && !monitorWindow.isDestroyed()) {
      monitorWindow.focus();
      return;
    }
    const win = new BrowserWindow({
      width: 1100,
      height: 760,
      title: 'Omni Activity',
      icon: ctx.paths.icon ?? undefined,
      autoHideMenuBar: true,
      // Not an Omni page: no bridge preload, and not the app's session with its API cookies.
      webPreferences: { partition: MONITOR_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
      if (!onMonitor(url)) event.preventDefault();
    });
    win.on('closed', () => {
      if (monitorWindow === win) monitorWindow = null;
    });
    monitorWindow = win;
    void win.loadURL(monitorUrl());
  });
}
