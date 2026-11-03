// The desktop app's QA harness: runs a JSON script of steps against the app with Playwright's Electron driver and
// writes a PNG per screenshot step and qa.json to --out. It replaces the SwiftUI app's QARunner and keeps its step
// names where they carry over (ADR 0010). README.md, "QA harness", lists the steps.
//
//   npx tsx scripts/qa.ts --script run.json --out <dir> [--app <packaged app>] [--port N] [--data-dir <dir>]
//                         [--appearance light|dark] [--zoom 1.2] [--size 1320x860] [--app-url http://127.0.0.1:<vite port>]
//
// The app attaches to a QA stack's server (scripts/qa-stack.sh up), never port 4747 or a checkout's data/. Exits 0
// when every step passed, 1 when one failed or the app would not start, 2 for a bad script or a refused target.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DesktopBridge, DesktopCommand } from '@omni/shared/desktop-bridge.ts';
import type { ElectronApplication, Page } from 'playwright';
import { type Probe, probePort, tokenFile } from '../src/backend/launch.ts';
import { EVENT } from '../src/ipc.ts';

export const LIVE_PORT = 4747;
const DEFAULT_TIMEOUT_MS = 10_000;

/** The commands a `command` step may send. The page ignores one it does not know, so a typo would pass silently. */
export const QA_COMMANDS = ['new-thread', 'go-to', 'search', 'home', 'settings'] as const satisfies readonly DesktopCommand[];

export type Appearance = 'light' | 'dark';
export type WindowTarget = 'main' | 'quick-prompt' | 'newest';
export interface Size {
  width: number;
  height: number;
}

export type QAStep =
  | { kind: 'route'; route: string }
  | { kind: 'click'; selector: string; timeoutMs: number }
  | { kind: 'fill'; selector: string; text: string; timeoutMs: number }
  | { kind: 'type'; text: string }
  | { kind: 'press'; key: string }
  | { kind: 'wait'; ms: number }
  | { kind: 'waitFor'; selector: string; timeoutMs: number }
  | { kind: 'expect'; selector: string; text: string | null; timeoutMs: number }
  | { kind: 'command'; command: DesktopCommand }
  | { kind: 'menu'; path: string[] }
  | { kind: 'window'; target: WindowTarget; timeoutMs: number }
  | { kind: 'openWindow'; route: string; timeoutMs: number }
  | { kind: 'appearance'; appearance: Appearance }
  | { kind: 'zoom'; factor: number }
  | { kind: 'size'; size: Size }
  | { kind: 'screenshot'; name: string }
  | { kind: 'quit' };

export interface QAScript {
  port: number;
  dataDir: string;
  /** Load the UI from here (the QA stack's Vite) instead of the server's built apps/web/dist. */
  appUrl: string | null;
  appearance: Appearance | null;
  zoom: number | null;
  size: Size | null;
  steps: QAStep[];
}

export interface QAArgs {
  script: string;
  out: string;
  /** A packaged app: Omni.app, its binary, or an AppImage. Null runs this checkout's dev build. */
  app: string | null;
  overrides: { port?: number; dataDir?: string; appUrl?: string; appearance?: Appearance; zoom?: number; size?: Size };
}

type Result<T> = T | { error: string };
const isError = <T>(value: Result<T>): value is { error: string } =>
  typeof value === 'object' && value !== null && 'error' in value && typeof (value as { error: unknown }).error === 'string';

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

function parsePort(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

function parseAppUrl(v: unknown): string | null {
  return typeof v === 'string' && /^https?:\/\/[^\s/]+\/?$/.test(v) ? v.replace(/\/+$/, '') : null;
}

function parseAppearance(v: unknown): Appearance | null {
  return v === 'light' || v === 'dark' ? v : null;
}

function parseZoom(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0.5 && n <= 3 ? n : null;
}

/** `[w, h]`, `{width, height}` or `"WxH"`. */
export function parseSize(v: unknown): Size | null {
  let w: unknown;
  let h: unknown;
  if (Array.isArray(v)) [w, h] = v;
  else if (typeof v === 'string') [w, h] = v.split('x').map(Number);
  else if (obj(v)) ({ width: w, height: h } = obj(v) as { width?: unknown; height?: unknown });
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 320 && n <= 8000;
  return ok(w) && ok(h) ? { width: w, height: h } : null;
}

/** Timeouts are in seconds, as in the SwiftUI app's harness. */
function timeoutOf(raw: Record<string, unknown>, fallback = DEFAULT_TIMEOUT_MS): Result<number> {
  if (raw.timeout === undefined) return fallback;
  return typeof raw.timeout === 'number' && raw.timeout > 0 && raw.timeout <= 600 ? raw.timeout * 1000 : { error: 'timeout is seconds, from 0 to 600' };
}

function hashRoute(v: unknown): string | null {
  return typeof v === 'string' && v.startsWith('#/') && !/[\s<>"'`\\]/.test(v) ? v : null;
}

/**
 * What to use instead of a wait condition from the SwiftUI app's harness, or null. Here a wait takes a selector, and
 * an old condition would parse as one and only fail at its timeout, so it is refused up front.
 */
export function swiftUICondition(value: string): string | null {
  const [name, arg] = value.includes(':') ? [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)] : [value, null];
  const instead =
    name === 'sidebarLoaded' && arg === null ? 'a sidebar row: {"wait": "[data-channel-id]"}'
    : name === 'channel' && arg ? `its sidebar row: {"wait": "[data-channel-id=\\"${arg}\\"]"}`
    : name === 'thread' && arg ? `{"openThread": "${arg}"} or {"route": "#/t/${arg}"}, then a selector from the transcript`
    : (name === 'serverState' || name === 'connection') && arg ? 'nothing: the harness attaches only to a running server, so drop the step'
    : name === 'browserFrame' && arg === null ? 'a selector in the Browser tab'
    : null;
  return instead ? `"${value}" is a SwiftUI harness condition; a wait here takes a Playwright selector. Use ${instead}` : null;
}

const STEP_KEYS = [
  'route', 'click', 'fill', 'type', 'press', 'wait', 'sleep', 'expect', 'command', 'menu', 'window', 'openWindow',
  'openThread', 'appearance', 'zoom', 'size', 'screenshot', 'snapshot', 'quit',
] as const;

/** One step of a script. Each step is an object with one action key, as in the SwiftUI app's harness. */
export function parseStep(raw: unknown): Result<QAStep> {
  const step = obj(raw);
  if (!step) return { error: 'a step is an object such as {"route": "#/settings"}' };
  const keys = Object.keys(step).filter((k) => (STEP_KEYS as readonly string[]).includes(k));
  if (keys.length !== 1) return { error: `a step needs exactly one of ${STEP_KEYS.join(', ')}` };
  const key = keys[0] as (typeof STEP_KEYS)[number];
  const value = step[key];
  const inner = obj(value);
  switch (key) {
    case 'route': {
      const route = hashRoute(value);
      return route ? { kind: 'route', route } : { error: 'route needs a hash route such as #/settings' };
    }
    case 'click': {
      const selector = text(value);
      const timeoutMs = timeoutOf(step);
      if (isError(timeoutMs)) return timeoutMs;
      return selector ? { kind: 'click', selector, timeoutMs } : { error: 'click needs a selector' };
    }
    case 'fill': {
      const selector = text(inner?.selector);
      if (!inner || !selector || typeof inner.text !== 'string') return { error: 'fill needs {"selector": "...", "text": "..."}' };
      const timeoutMs = timeoutOf(inner);
      if (isError(timeoutMs)) return timeoutMs;
      return { kind: 'fill', selector, text: inner.text, timeoutMs };
    }
    case 'type':
      return typeof value === 'string' ? { kind: 'type', text: value } : { error: 'type needs the text to type' };
    case 'press': {
      const key = text(value);
      return key ? { kind: 'press', key } : { error: 'press needs a key such as Enter or Control+K' };
    }
    case 'wait': {
      if (typeof value === 'number') return value >= 0 && value <= 600_000 ? { kind: 'wait', ms: value } : { error: 'wait takes 0 to 600000 ms' };
      const selector = typeof value === 'string' ? text(value) : text(inner?.for);
      if (!selector) return { error: 'wait needs ms, a selector, or {"for": "<selector>", "timeout": <seconds>}' };
      const old = swiftUICondition(selector);
      if (old) return { error: old };
      const timeoutMs = inner ? timeoutOf(inner) : DEFAULT_TIMEOUT_MS;
      if (isError(timeoutMs)) return timeoutMs;
      return { kind: 'waitFor', selector, timeoutMs };
    }
    case 'sleep':
      return typeof value === 'number' && value >= 0 && value <= 600 ? { kind: 'wait', ms: value * 1000 } : { error: 'sleep takes seconds, from 0 to 600' };
    case 'expect': {
      if (typeof value === 'string' && value) return { kind: 'expect', selector: value, text: null, timeoutMs: DEFAULT_TIMEOUT_MS };
      const selector = text(inner?.selector);
      if (!inner || !selector) return { error: 'expect needs a selector, or {"selector": "...", "text": "..."}' };
      if (inner.text !== undefined && typeof inner.text !== 'string') return { error: 'expect text must be a string' };
      const timeoutMs = timeoutOf(inner);
      if (isError(timeoutMs)) return timeoutMs;
      return { kind: 'expect', selector, text: typeof inner.text === 'string' ? inner.text : null, timeoutMs };
    }
    case 'command':
      return (QA_COMMANDS as readonly unknown[]).includes(value)
        ? { kind: 'command', command: value as DesktopCommand }
        : { error: `command is one of ${QA_COMMANDS.join(', ')}` };
    case 'menu': {
      const path = typeof value === 'string' ? value.split('>').map((part) => part.trim()).filter(Boolean) : [];
      return path.length >= 2 ? { kind: 'menu', path } : { error: 'menu needs a path such as "View > Zoom In"' };
    }
    case 'window': {
      const timeoutMs = timeoutOf(step);
      if (isError(timeoutMs)) return timeoutMs;
      return value === 'main' || value === 'quick-prompt' || value === 'newest'
        ? { kind: 'window', target: value, timeoutMs }
        : { error: 'window is main, quick-prompt or newest' };
    }
    case 'openWindow': {
      const route = hashRoute(value);
      const timeoutMs = timeoutOf(step);
      if (isError(timeoutMs)) return timeoutMs;
      return route ? { kind: 'openWindow', route, timeoutMs } : { error: 'openWindow needs a hash route such as #/t/<id>' };
    }
    case 'openThread': {
      const id = text(value);
      const timeoutMs = timeoutOf(step);
      if (isError(timeoutMs)) return timeoutMs;
      return id && /^[\w-]+$/.test(id) ? { kind: 'openWindow', route: `#/t/${id}`, timeoutMs } : { error: 'openThread needs a thread id' };
    }
    case 'appearance': {
      const appearance = parseAppearance(value);
      return appearance ? { kind: 'appearance', appearance } : { error: 'appearance is light or dark' };
    }
    case 'zoom': {
      const factor = parseZoom(value);
      return factor !== null ? { kind: 'zoom', factor } : { error: 'zoom is a factor such as 1.2' };
    }
    case 'size': {
      const size = parseSize(value);
      return size ? { kind: 'size', size } : { error: 'size is [width, height] in pixels, each 320 to 8000' };
    }
    case 'screenshot':
    case 'snapshot': {
      const name = text(value);
      return name && /^[\w.-]+$/.test(name) && !name.startsWith('.') ? { kind: 'screenshot', name } : { error: `${key} needs a file name of letters, digits, dots and dashes` };
    }
    case 'quit':
      return value === true ? { kind: 'quit' } : { error: 'quit takes true' };
  }
}

/** A script: a list of steps, or an object with `steps` and the run's settings. Flags win over the script. */
export function parseScript(raw: unknown, overrides: QAArgs['overrides'] = {}): Result<QAScript> {
  const root = Array.isArray(raw) ? { steps: raw } : obj(raw);
  if (!root || !Array.isArray(root.steps)) return { error: 'the script is a list of steps, or {"port": ..., "dataDir": ..., "steps": [...]}' };
  const port = overrides.port ?? parsePort(root.port);
  if (port === null) return { error: 'the script needs a port (or --port): the QA stack server to attach to' };
  const dataDir = overrides.dataDir ?? text(root.dataDir);
  if (!dataDir) return { error: 'the script needs a dataDir (or --data-dir): the QA stack data dir, $QA_DIR/data' };
  const appUrl = overrides.appUrl ?? (root.appUrl === undefined ? null : parseAppUrl(root.appUrl));
  if (appUrl === null && root.appUrl !== undefined && !overrides.appUrl) return { error: 'appUrl is an http(s) URL such as http://127.0.0.1:4786' };
  const appearance = overrides.appearance ?? (root.appearance === undefined ? null : parseAppearance(root.appearance));
  if (appearance === null && root.appearance !== undefined && !overrides.appearance) return { error: 'appearance is light or dark' };
  const zoom = overrides.zoom ?? (root.zoom === undefined ? null : parseZoom(root.zoom));
  if (zoom === null && root.zoom !== undefined && overrides.zoom === undefined) return { error: 'zoom is a factor such as 1.2' };
  const size = overrides.size ?? (root.size === undefined ? null : parseSize(root.size));
  if (size === null && root.size !== undefined && !overrides.size) return { error: 'size is [width, height] in pixels, each 320 to 8000' };
  const steps: QAStep[] = [];
  for (const [i, item] of root.steps.entries()) {
    const step = parseStep(item);
    if (isError(step)) return { error: `step ${i + 1}: ${step.error}` };
    steps.push(step);
  }
  if (steps.length === 0) return { error: 'the script has no steps' };
  return { port, dataDir, appUrl, appearance, zoom, size, steps };
}

export function parseArgs(argv: readonly string[]): Result<QAArgs> {
  const out: QAArgs = { script: '', out: '', app: null, overrides: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const value = (): string | undefined => (eq > 0 ? arg.slice(eq + 1) : argv[++i]);
    switch (flag) {
      case '--script': {
        const v = value();
        if (!v) return { error: '--script needs a path or the JSON itself' };
        out.script = v;
        break;
      }
      case '--out': {
        const v = value();
        if (!v) return { error: '--out needs a folder' };
        out.out = v;
        break;
      }
      case '--app': {
        const v = value();
        if (!v) return { error: '--app needs the packaged app' };
        out.app = v;
        break;
      }
      case '--port': {
        const port = parsePort(value());
        if (port === null) return { error: '--port needs a port from 1 to 65535' };
        out.overrides.port = port;
        break;
      }
      case '--data-dir': {
        const v = value();
        if (!v) return { error: '--data-dir needs a path' };
        out.overrides.dataDir = v;
        break;
      }
      case '--appearance': {
        const appearance = parseAppearance(value());
        if (!appearance) return { error: '--appearance is light or dark' };
        out.overrides.appearance = appearance;
        break;
      }
      case '--zoom': {
        const zoom = parseZoom(value());
        if (zoom === null) return { error: '--zoom is a factor such as 1.2' };
        out.overrides.zoom = zoom;
        break;
      }
      case '--app-url': {
        const appUrl = parseAppUrl(value());
        if (!appUrl) return { error: '--app-url is an http(s) URL such as http://127.0.0.1:4786' };
        out.overrides.appUrl = appUrl;
        break;
      }
      case '--size': {
        const size = parseSize(value());
        if (!size) return { error: '--size is WIDTHxHEIGHT, such as 1320x860' };
        out.overrides.size = size;
        break;
      }
      default:
        return { error: `unknown argument ${arg}` };
    }
  }
  if (!out.script) return { error: '--script is required' };
  if (!out.out) return { error: '--out is required' };
  return out;
}

/** The script's JSON: given inline (it starts with { or [) or as a path to a file. */
export function readScriptSource(source: string, read: (path: string) => string): Result<unknown> {
  const trimmed = source.trim();
  let body = trimmed;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    try {
      body = read(source);
    } catch {
      return { error: `cannot read the script at ${source}` };
    }
  }
  try {
    return JSON.parse(body) as unknown;
  } catch (err) {
    return { error: `the script is not JSON: ${(err as Error).message}` };
  }
}

/**
 * Why the run must not start, or null. Port 4747 is the live server. A checkout's data/ is a live install's state:
 * an app pointed at it on a free port would start a second server on it with the real CLIs.
 */
export function refusal(script: Pick<QAScript, 'port' | 'dataDir'>, liveDataDirs: readonly string[], real: (p: string) => string = (p) => p): string | null {
  if (script.port === LIVE_PORT) return `refusing port ${LIVE_PORT}, that is the live server. Start a QA stack on another port: QA_SERVER_PORT=<port> scripts/qa-stack.sh up`;
  const dataDir = real(resolve(script.dataDir));
  const live = liveDataDirs.map((dir) => real(resolve(dir)));
  if (live.includes(dataDir)) return `refusing ${script.dataDir}, that is a checkout's live data dir. Pass the QA stack's ($QA_DIR/data)`;
  return null;
}

/**
 * Why the run must not launch the app, given what answers on the port, or null. The harness only attaches: the dev
 * build on a free port, or beside a server it cannot prove is this data dir's, would start a server of its own with
 * the real harness CLIs.
 */
export function attachRefusal(probe: Probe, port: number, dataDir: string): string | null {
  if (probe.kind === 'omni') return null;
  const why =
    probe.kind === 'free' ? 'nothing answers there'
    : probe.kind === 'no-token' ? `${dataDir} has no api-token`
    : probe.kind === 'not-this-install' ? `the server there does not hold ${dataDir}'s token`
    : probe.kind === 'slow' ? 'something holds the port but did not answer in time'
    : `it is not an Omni server: ${probe.detail}`;
  return `no QA server on port ${port} that owns ${dataDir} (${why}). Start one with QA_SERVER_PORT=${port} scripts/qa-stack.sh up and pass its data dir`;
}

function gitCommonDir(repo: string): string | null {
  const git = spawnSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
  return git.status === 0 && git.stdout.trim() ? git.stdout.trim() : null;
}

/** Where the dev build's checkout and the main checkout keep their live data. A worktree's common dir is the main checkout's .git. */
export function liveDataDirs(repo: string, commonDir: (repo: string) => string | null = gitCommonDir): string[] {
  const dirs = [join(repo, 'data')];
  const common = commonDir(repo);
  if (common) dirs.push(join(dirname(common), 'data'));
  return [...new Set(dirs)];
}

function realOrSame(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The executable of a packaged app: Omni.app's binary, or the path itself (an AppImage or a binary). */
export function appExecutable(path: string, list: (dir: string) => string[] = readdirSync): string {
  if (!path.replace(/\/+$/, '').endsWith('.app')) return path;
  const macos = join(path, 'Contents', 'MacOS');
  const names = list(macos);
  return join(macos, names.includes('Omni') ? 'Omni' : names[0]);
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StepReport {
  step: number;
  action: string;
  ok: boolean;
  ms: number;
  error: string | null;
  files: string[];
}

interface Report {
  ok: boolean;
  error: string | null;
  app: { executable: string | null; packaged: boolean };
  port: number | null;
  dataDir: string | null;
  steps: StepReport[];
  facts: { route: string | null; windows: { url: string; title: string; bounds: Bounds | null; zoom: number | null }[] };
  pageErrors: string[];
}

const DESKTOP = resolve(import.meta.dirname, '..');
const REPO = resolve(DESKTOP, '../..');

function writeReport(out: string, report: Report): void {
  writeFileSync(join(out, 'qa.json'), `${JSON.stringify(report, null, 2)}\n`);
}

function bail(out: string | null, report: Report, message: string, code: number): never {
  report.ok = false;
  report.error = message;
  console.error(`qa: ${message}`);
  if (out) {
    mkdirSync(out, { recursive: true });
    writeReport(out, report);
  }
  process.exit(code);
}

async function main(argv: readonly string[]): Promise<number> {
  const report: Report = { ok: true, error: null, app: { executable: null, packaged: false }, port: null, dataDir: null, steps: [], facts: { route: null, windows: [] }, pageErrors: [] };
  const args = parseArgs(argv);
  if (isError(args)) bail(null, report, args.error, 2);
  const out = resolve(args.out);
  const raw = readScriptSource(args.script, (p) => readFileSync(p, 'utf8'));
  if (isError(raw)) bail(out, report, raw.error, 2);
  const script = parseScript(raw, args.overrides);
  if (isError(script)) bail(out, report, script.error, 2);
  const rawSteps = (Array.isArray(raw) ? raw : (raw as { steps: unknown[] }).steps) as unknown[];
  report.port = script.port;
  report.dataDir = resolve(script.dataDir);
  const refused = refusal(script, liveDataDirs(REPO), realOrSame);
  if (refused) bail(out, report, refused, 2);

  // Only attach. A dev build on a free port would start a server from this checkout with the real harness CLIs.
  let token: string | null = null;
  try {
    token = readFileSync(tokenFile(report.dataDir), 'utf8').trim();
  } catch {
    token = null;
  }
  const notAttached = attachRefusal(await probePort(script.port, token), script.port, report.dataDir);
  if (notAttached) bail(out, report, notAttached, 2);

  mkdirSync(out, { recursive: true });
  const require = createRequire(import.meta.url);
  let executablePath: string;
  const launchArgs: string[] = [];
  if (args.app) {
    executablePath = appExecutable(resolve(args.app));
    report.app = { executable: executablePath, packaged: true };
  } else {
    await import('./build.ts');
    const ensure = spawnSync(process.execPath, [join(DESKTOP, 'scripts/ensure-electron.mjs')], { stdio: 'inherit' });
    if (ensure.status !== 0) bail(out, report, 'could not fetch the electron binary', 1);
    executablePath = require('electron') as string;
    launchArgs.push(DESKTOP);
    report.app = { executable: executablePath, packaged: false };
  }
  // Its own user-data folder: the run's settings, Web tab logins and single-instance lock stay out of the real app's.
  launchArgs.push('--port', String(script.port), '--data-dir', report.dataDir, `--user-data-dir=${join(out, 'user-data')}`);
  if (script.appUrl) launchArgs.push('--app-url', script.appUrl);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'OMNI_TOKEN' && key !== 'ELECTRON_RUN_AS_NODE' && key !== 'NODE_OPTIONS') env[key] = value;
  }

  const { _electron } = await import('playwright');
  let app: ElectronApplication;
  try {
    // Playwright emulates a light scheme unless told otherwise; without --appearance the run shows the OS's.
    app = await _electron.launch({ executablePath, args: launchArgs, cwd: DESKTOP, env, timeout: 60_000, colorScheme: null });
  } catch (err) {
    bail(out, report, `the app did not start: ${(err as Error).message}`, 1);
  }
  const log: string[] = [];
  app.process().stdout?.on('data', (d: Buffer) => log.push(d.toString()));
  app.process().stderr?.on('data', (d: Buffer) => log.push(d.toString()));

  const watched = new WeakSet<Page>();
  const watch = (page: Page) => {
    if (watched.has(page)) return;
    watched.add(page);
    page.on('pageerror', (err) => report.pageErrors.length < 50 && report.pageErrors.push(`${page.url()}: ${err.message}`));
  };
  app.on('window', watch);

  const browserWindow = (page: Page) => app.browserWindow(page);
  let appearance = script.appearance;
  const style = async (page: Page) => {
    watch(page);
    if (appearance) await page.emulateMedia({ colorScheme: appearance });
  };

  let current: Page | null = null;
  const facts = async () => {
    const windows = app.windows();
    report.facts.windows = await Promise.all(
      windows.map(async (w) => {
        const shape = await app
          .browserWindow(w)
          .then((h) => h.evaluate((win) => ({ bounds: win.getContentBounds(), zoom: win.webContents.getZoomFactor() })))
          .catch(() => ({ bounds: null, zoom: null }));
        return { url: w.url(), title: await w.title().catch(() => ''), ...shape };
      }),
    );
    report.facts.route = current && !current.isClosed() ? new URL(current.url()).hash || null : null;
  };

  try {
    const first = await app.firstWindow({ timeout: 60_000 });
    // The window opens on /api/auth/desktop-pair, which sends it on to the Web UI.
    const uiOrigin = script.appUrl ? new URL(script.appUrl).origin : null;
    await first.waitForURL((url) => !url.pathname.startsWith('/api/') && (!uiOrigin || url.origin === uiOrigin), { timeout: 30_000 });
    await first.waitForSelector('#root > *', { timeout: 30_000 });
    current = first;
    if (script.size) {
      const size = script.size;
      await (await browserWindow(first)).evaluate((win, s) => win.setSize(s.width, s.height), size);
    }
    if (appearance) {
      const mode = appearance;
      await app.evaluate(({ nativeTheme }, m) => {
        nativeTheme.themeSource = m;
      }, mode);
    }
    await style(first);
    if (script.zoom !== null) await setZoom(app, first, script.zoom);
  } catch (err) {
    report.ok = false;
    report.error = `the first window did not load: ${(err as Error).message}`;
  }

  const mainPage = current;
  const shown = (page: Page) =>
    app
      .browserWindow(page)
      .then((h) => h.evaluate((w) => w.isVisible()))
      .catch(() => false);
  // Quick Prompt's panel stays loaded while hidden, so the window step waits for it to show.
  const pick = async (target: WindowTarget, timeoutMs: number): Promise<Page> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const open = app.windows().filter((w) => !w.isClosed() && !w.url().startsWith('devtools://'));
      let found: Page | null = null;
      if (target === 'main') found = mainPage && !mainPage.isClosed() ? mainPage : null;
      else {
        const candidates = target === 'quick-prompt' ? open.filter((w) => new URL(w.url()).hash.startsWith('#/quick-prompt')) : open.reverse();
        for (const w of candidates) if (!found && (await shown(w))) found = w;
      }
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`no ${target} window on screen`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  if (report.error === null) {
    for (const [i, step] of script.steps.entries()) {
      const started = Date.now();
      const result: StepReport = { step: i + 1, action: JSON.stringify(rawSteps[i]), ok: true, ms: 0, error: null, files: [] };
      const act = async (): Promise<void> => {
        const page = current;
        if (!page || page.isClosed()) throw new Error('the current window is closed; pick another with a window step');
        switch (step.kind) {
          case 'route':
            await page.evaluate((route) => {
              window.location.hash = route.slice(1);
            }, step.route);
            await page.waitForFunction((route) => window.location.hash === route, step.route, { timeout: DEFAULT_TIMEOUT_MS });
            break;
          case 'click':
            await page.locator(step.selector).first().click({ timeout: step.timeoutMs });
            break;
          case 'fill':
            await page.locator(step.selector).first().fill(step.text, { timeout: step.timeoutMs });
            break;
          case 'type':
            await page.keyboard.type(step.text);
            break;
          case 'press':
            await page.keyboard.press(step.key);
            break;
          case 'wait':
            await page.waitForTimeout(step.ms);
            break;
          case 'waitFor':
            await page.locator(step.selector).first().waitFor({ state: 'visible', timeout: step.timeoutMs });
            break;
          case 'expect': {
            const target = page.locator(step.selector).first();
            await target.waitFor({ state: 'visible', timeout: step.timeoutMs });
            if (step.text !== null) {
              const want = step.text;
              const deadline = Date.now() + step.timeoutMs;
              let seen = '';
              for (;;) {
                seen = (await target.innerText()).trim();
                if (seen.includes(want)) break;
                if (Date.now() > deadline) throw new Error(`${step.selector} shows "${seen.slice(0, 200)}", not "${want}"`);
                await page.waitForTimeout(100);
              }
            }
            break;
          }
          case 'command':
            await (await browserWindow(page)).evaluate((win, payload) => win.webContents.send(payload.channel, payload.event), {
              channel: EVENT,
              event: { type: 'command' as const, command: step.command },
            });
            break;
          case 'menu': {
            const id = await (await browserWindow(page)).evaluate((win) => win.id);
            // No named helpers inside these: tsx wraps them in a __name call that the main process does not define.
            const tree = await app.evaluate(({ Menu }) => {
              const root: MenuNode[] = [];
              const queue = [{ from: Menu.getApplicationMenu()?.items ?? [], into: root }];
              for (let next = queue.shift(); next; next = queue.shift()) {
                for (const it of next.from) {
                  const node: MenuNode = { label: it.label, visible: it.visible, enabled: it.enabled, items: [] };
                  next.into.push(node);
                  if (it.submenu) queue.push({ from: it.submenu.items, into: node.items });
                }
              }
              return root;
            });
            const indices = resolveMenuPath(tree, step.path);
            if (isError(indices)) throw new Error(indices.error);
            const error = await app.evaluate(({ BrowserWindow, Menu }, input) => {
              let items = Menu.getApplicationMenu()?.items ?? [];
              let item: (typeof items)[number] | undefined;
              for (const i of input.indices) {
                item = items[i];
                items = item?.submenu?.items ?? [];
              }
              if (!item) return 'the menu changed under the step';
              const win = BrowserWindow.fromId(input.id) ?? undefined;
              item.click(undefined, win, win?.webContents);
              return null;
            }, { indices, id });
            if (error) throw new Error(error);
            break;
          }
          case 'window':
            current = await pick(step.target, step.timeoutMs);
            await current.waitForLoadState('domcontentloaded');
            await style(current);
            await current.bringToFront();
            break;
          case 'openWindow': {
            const opened = app.waitForEvent('window', { timeout: step.timeoutMs });
            await page.evaluate((route) => {
              const bridge = (window as unknown as { omniDesktop?: DesktopBridge }).omniDesktop;
              if (!bridge) throw new Error('this window has no desktop bridge');
              bridge.openWindow(route);
            }, step.route);
            current = await opened;
            await current.waitForLoadState('domcontentloaded');
            await current.waitForSelector('#root > *', { timeout: step.timeoutMs });
            await style(current);
            break;
          }
          case 'appearance': {
            appearance = step.appearance;
            const mode = step.appearance;
            await app.evaluate(({ nativeTheme }, m) => {
              nativeTheme.themeSource = m;
            }, mode);
            for (const w of app.windows()) if (!w.isClosed()) await style(w);
            break;
          }
          case 'zoom':
            await setZoom(app, page, step.factor);
            break;
          case 'size': {
            const size = step.size;
            await (await browserWindow(page)).evaluate((win, s) => win.setSize(s.width, s.height), size);
            break;
          }
          case 'screenshot': {
            const win = await browserWindow(page);
            // A hidden window draws no frames, so its frame wait and its capture would never answer.
            if (!(await win.evaluate((w) => w.isVisible() && !w.isMinimized()))) throw new Error('the window is hidden or minimized; show it or pick another with a window step');
            // A blank window is a failed load, not a screenshot worth keeping.
            const drawn = await page.evaluate(() => {
              const body = document.body;
              return !!body && (body.innerText.trim().length > 0 || !!body.querySelector('img, svg, canvas, video'));
            });
            // Two frames, so the capture holds what the last step changed and not the frame before it. A window the OS
            // reports as covered may draw no frames until the capture wakes it, so the wait is capped and not required.
            await withDeadline(page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))), 2_000, 'no frame').catch(() => {});
            // The window's own capture: Playwright's page.screenshot crops a zoomed page to its CSS viewport.
            const png = await withDeadline(
              win.evaluate(async (w) => (await w.webContents.capturePage()).toPNG().toString('base64')),
              15_000,
              'the window capture did not answer in 15s',
            );
            const file = join(out, `${step.name}.png`);
            writeFileSync(file, Buffer.from(png, 'base64'));
            result.files.push(file);
            if (!drawn) throw new Error('the window drew nothing');
            break;
          }
          case 'quit':
            break;
        }
      };
      try {
        const ceiling = stepCeilingMs(step);
        await withDeadline(act(), ceiling, `the step did not finish within ${ceiling / 1000}s`);
      } catch (err) {
        result.ok = false;
        result.error = (err as Error).message.split('\n')[0];
        report.ok = false;
      }
      result.ms = Date.now() - started;
      report.steps.push(result);
      await withDeadline(facts(), 10_000, 'facts').catch(() => {});
      writeReport(out, report);
      const mark = result.ok ? 'ok  ' : 'FAIL';
      console.log(`${mark} ${String(i + 1).padStart(2)} ${result.action}${result.error ? `: ${result.error}` : ''} (${result.ms}ms)`);
      if (step.kind === 'quit') break;
    }
  }

  await withDeadline(facts(), 10_000, 'facts').catch(() => {});
  writeReport(out, report);
  writeFileSync(join(out, 'main.log'), log.join(''));
  // A quit dialog (turns running) could hold close() open, so the app gets ten seconds and then is killed by its pid.
  const child = app.process();
  await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  if (report.error) console.error(`qa: ${report.error}`);
  console.log(`qa: ${report.ok ? 'passed' : 'failed'}, report in ${join(out, 'qa.json')}`);
  return report.ok ? 0 : 1;
}

/** A menu label as the menu step compares it: no mnemonic &, no trailing ellipsis, any case. */
export function menuLabel(label: string): string {
  return label.replace(/&/g, '').replace(/(\.\.\.|…)$/, '').trim().toLowerCase();
}

export interface MenuNode {
  label: string;
  visible: boolean;
  enabled: boolean;
  items: MenuNode[];
}

/** The index of each item along a menu path, or why the path does not reach an enabled item. */
export function resolveMenuPath(menu: readonly MenuNode[], path: readonly string[]): Result<number[]> {
  let items = menu;
  const indices: number[] = [];
  for (const [n, part] of path.entries()) {
    const want = menuLabel(part);
    const i = items.findIndex((it) => it.visible && menuLabel(it.label) === want);
    if (i < 0) return { error: `no menu item "${part}" (have: ${items.filter((it) => it.visible && it.label).map((it) => it.label).join(', ')})` };
    indices.push(i);
    if (n === path.length - 1) return items[i].enabled ? indices : { error: `"${part}" is disabled` };
    items = items[i].items;
  }
  return { error: 'empty menu path' };
}

/** A step's ceiling: its own timeout twice (expect and openWindow wait twice), or its sleep, plus a grace. */
export function stepCeilingMs(step: QAStep): number {
  const own = 'timeoutMs' in step ? 2 * step.timeoutMs : step.kind === 'wait' ? step.ms : DEFAULT_TIMEOUT_MS;
  return own + 30_000;
}

/** The work, or a rejection with `what` once `ms` pass. The work keeps running; a late failure of it is dropped. */
export function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  work.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(what)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Through the bridge, as the View menu does, so the setting and the window agree; then on the window directly. */
async function setZoom(app: ElectronApplication, page: Page, factor: number): Promise<void> {
  await page.evaluate(async (z) => {
    const bridge = (window as unknown as { omniDesktop?: DesktopBridge }).omniDesktop;
    if (bridge) await bridge.settings.set({ zoom: z });
  }, factor);
  await (await app.browserWindow(page)).evaluate((win, z) => win.webContents.setZoomFactor(z), factor);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error('qa:', err);
      process.exit(1);
    },
  );
}
