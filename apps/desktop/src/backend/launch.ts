// How the desktop app decides to start or attach, and the environment of the server it starts (ADR 0010): a proof
// that the process on the port holds this install's token, or a free port.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';

/** PATH from a login shell, between markers, so a shell that echoes the command cannot fake it. */
export function extractPath(output: string, id: string): string | null {
  const start = output.indexOf(`OMNISTART${id}\n`);
  if (start < 0) return null;
  const from = start + `OMNISTART${id}\n`.length;
  const end = output.indexOf(`\nOMNIEND${id}`, from);
  if (end < 0) return null;
  const path = output.slice(from, end);
  if (!path || path.includes('\n')) return null;
  return path;
}

export function fallbackPath(home: string): string {
  return [`${home}/.local/share/mise/shims`, `${home}/.local/bin`, '/usr/local/bin', '/usr/bin', '/bin'].join(':');
}

const PASSTHROUGH = [
  'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL',
  'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
  'XDG_CURRENT_DESKTOP', 'XDG_SESSION_TYPE', 'XDG_DATA_DIRS', 'XDG_CONFIG_DIRS',
] as const;

/** Billing keys never go to the server. The server runs harnesses on the plans you are signed in to. */
export function blockedEnvKey(key: string): boolean {
  return key.startsWith('ANTHROPIC_') || key.endsWith('_API_KEY') || key.endsWith('_AUTH_TOKEN') || key === 'OPENAI_BASE_URL';
}

/** The server's environment: a few of ours, PATH, the port and the data dir. Nothing else, and no billing keys. */
export function childEnv(app: NodeJS.ProcessEnv, input: { path: string; port: number; dataDir: string }): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASSTHROUGH) {
    const value = app[key];
    if (value && !blockedEnvKey(key)) env[key] = value;
  }
  env.PATH = input.path;
  env.NODE_ENV = 'production';
  env.NODE_OPTIONS = '--disable-warning=ExperimentalWarning';
  env.OMNI_PORT = String(input.port);
  env.OMNI_DATA_DIR = input.dataDir;
  // The app starts the server again when it exits with RESTART_EXIT_CODE.
  env.OMNI_SUPERVISOR = 'desktop';
  // The server runs on this app's own binary, which acts as Node only when told.
  env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}

/** The server's exit code after the Web UI's Update (apps/server/update.ts): start it again. */
export const RESTART_EXIT_CODE = 75;

/** Start the server again after it exited: only for Update's code, and not for one that asks again at once. */
export function shouldRestart(code: number | null, ranMs: number): boolean {
  return code === RESTART_EXIT_CODE && ranMs >= 10_000;
}

export function proofFor(token: string, port: number, nonce: string): string {
  return createHmac('sha256', token).update(`omni-proof:${port}:${nonce}`).digest('hex');
}

export function proofMatches(token: string, port: number, nonce: string, given: string): boolean {
  const expected = Buffer.from(proofFor(token, port, nonce));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export type Probe =
  | { kind: 'free' }
  | { kind: 'omni' }
  | { kind: 'not-omni'; detail: string }
  /** Something holds the port but did not answer within the probe's timeout: often Omni itself, busy or just restarted. */
  | { kind: 'slow' }
  | { kind: 'not-this-install' }
  | { kind: 'no-token' };

export function classifyAnswer(input: { token: string | null; port: number; nonce: string; status: number; body: string }): Probe {
  let parsed: { proof?: unknown } | null = null;
  try {
    parsed = JSON.parse(input.body) as { proof?: unknown };
  } catch {
    parsed = null;
  }
  const proof = typeof parsed?.proof === 'string' ? parsed.proof : null;
  if (input.status !== 200 || !proof) return { kind: 'not-omni', detail: 'the answer was not an Omni proof' };
  if (!input.token) return { kind: 'no-token' };
  if (!proofMatches(input.token, input.port, input.nonce, proof)) return { kind: 'not-this-install' };
  return { kind: 'omni' };
}

function errnoOf(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const cause = (err as { cause?: { code?: string; errors?: { code?: string }[] } }).cause;
  if (cause?.code) return cause.code;
  return cause?.errors?.find((item) => item.code)?.code;
}

export async function probePort(port: number, token: string | null, fetchImpl: typeof fetch = fetch): Promise<Probe> {
  const nonce = randomBytes(32).toString('hex');
  let response: Response;
  try {
    response = await fetchImpl(`http://127.0.0.1:${port}/api/auth/proof?nonce=${nonce}`, { signal: AbortSignal.timeout(2000) });
  } catch (err) {
    if (errnoOf(err) === 'ECONNREFUSED') return { kind: 'free' };
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'slow' };
    return { kind: 'not-omni', detail: 'nothing answered as HTTP' };
  }
  const body = await response.text();
  return classifyAnswer({ token, port, nonce, status: response.status, body });
}

export type Decision = { action: 'start' } | { action: 'attach' } | { action: 'fail'; message: string };

function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const capital = trimmed[0].toUpperCase() + trimmed.slice(1);
  const last = trimmed[trimmed.length - 1];
  return last === '.' || last === '!' || last === '?' ? capital : `${capital}.`;
}

export function decide(probe: Probe, port: number): Decision {
  switch (probe.kind) {
    case 'free':
      return { action: 'start' };
    case 'omni':
      return { action: 'attach' };
    case 'not-omni':
      return { action: 'fail', message: `Port ${port} answers, but not as an Omni server. ${sentence(probe.detail)} Stop that program, or pick another port.` };
    case 'slow':
      return { action: 'fail', message: `Port ${port} is taken, but did not answer within 30 seconds. If it is Omni, check its log; otherwise stop that program, or pick another port.` };
    case 'not-this-install':
      return { action: 'fail', message: `Port ${port} answers, but not as this install's Omni. It does not know this data dir's token. Stop that server, or pick another port.` };
    case 'no-token':
      return { action: 'fail', message: `Port ${port} answers as an Omni server, and this data dir has no api-token yet. Stop that server, or pick another port.` };
    default:
      return assertNever(probe);
  }
}

export type CheckoutProblem = 'missing' | 'dependencies';

/** Development runs the server from a checkout: it needs the source and its node_modules. */
export function checkoutProblem(repo: string, exists: (path: string) => boolean): CheckoutProblem | null {
  if (!exists(join(repo, 'apps/server/index.ts'))) return 'missing';
  if (!exists(join(repo, 'node_modules/tsx/package.json'))) return 'dependencies';
  return null;
}

export function checkoutMessage(problem: CheckoutProblem, repo: string): string {
  switch (problem) {
    case 'missing':
      return `No Omni checkout at ${repo}.`;
    case 'dependencies':
      return `The checkout at ${repo} has no node_modules. Run npm install --include=dev there, then start again.`;
    default:
      return assertNever(problem);
  }
}

export function tokenFile(dataDir: string): string {
  return join(dataDir, 'api-token');
}

/** How to start the server: the packaged bundle, or the checkout's TypeScript through tsx. Both on this app's binary. */
export function serverCommand(input: { bundled: boolean; appRoot: string }): { args: string[]; cwd: string } {
  if (input.bundled) return { args: [join(input.appRoot, 'apps', 'server', 'index.mjs')], cwd: input.appRoot };
  return { args: ['--import', 'tsx', 'apps/server/index.ts'], cwd: input.appRoot };
}

/**
 * Probes until the answer is not `slow`: a server that was just restarted, or is stalled on disk, can take several
 * seconds to answer. Gives up after `attempts` probes and returns the last answer.
 */
export async function settleProbe(probe: () => Promise<Probe>, sleep: (ms: number) => Promise<void>, attempts = 15): Promise<Probe> {
  let last = await probe();
  for (let i = 1; i < attempts && last.kind === 'slow'; i++) {
    await sleep(250);
    last = await probe();
  }
  return last;
}

export interface WaitInput {
  probe: () => Promise<Probe>;
  exited: () => number | null;
  sleep: (ms: number) => Promise<void>;
  attempts: number;
  port: number;
  logTail: () => string;
  cancelled: () => boolean;
}

export type WaitResult = { ok: true } | { ok: false; message: string; logTail: string };

export async function waitForReady(input: WaitInput): Promise<WaitResult> {
  const fail = (message: string): WaitResult => ({ ok: false, message, logTail: input.logTail().trim() });
  let last: Probe = { kind: 'free' };
  for (let i = 0; i < input.attempts; i++) {
    if (input.cancelled()) return { ok: false, message: 'Start cancelled.', logTail: '' };
    const code = input.exited();
    if (code !== null) return fail(code === 0 ? 'The server stopped while starting.' : `The server stopped while starting, with exit code ${code}.`);
    last = await input.probe();
    if (last.kind === 'omni') return { ok: true };
    if (last.kind === 'not-omni' || last.kind === 'not-this-install') {
      const decision = decide(last, input.port);
      return fail(decision.action === 'fail' ? decision.message : 'The server on that port is not this install.');
    }
    await input.sleep(250);
  }
  if (last.kind === 'no-token') {
    const decision = decide(last, input.port);
    return fail(decision.action === 'fail' ? decision.message : 'This data dir has no token yet.');
  }
  return fail('The server did not answer within 30 seconds.');
}

/** Why the server stopped on its own after it was ready. A signal is a crash or a kill, not a stop of its own. */
export function exitMessage(code: number, signal: NodeJS.Signals | null = null): string {
  if (signal) return signal === 'SIGSEGV' || signal === 'SIGBUS' || signal === 'SIGABRT' || signal === 'SIGILL' ? `The server crashed (${signal}).` : `The server was killed by ${signal}.`;
  return code === 0 ? 'The server stopped.' : `The server stopped with exit code ${code}.`;
}

function assertNever(value: never): never {
  throw new Error(`unhandled ${JSON.stringify(value)}`);
}
