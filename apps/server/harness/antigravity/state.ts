// What state Antigravity is in on this machine: the one reader the catalog, Settings > Accounts and the skills hint
// all read (spec #977). Today it is backed by a bring-your-own `agy`. A managed install or an in-app sign-in can
// replace what is behind it later without touching its callers.
//
// A check starts `agy acp` in a scratch folder and speaks ACP to it:
// - `initialize` gives the version (agentInfo.version, without the agy_acp_server_ prefix, as T3 Code reads it).
// - `authenticate` with the Google account method (oauth-personal), never an API key, Gemini Enterprise or the Agent
//   Platform. Success is ready. Error -32000, or agy trying to open a sign-in link, is signed out.
//   SUBSCRIPTION_REQUIRED is no subscription.
// - No check ever opens a browser. agy on Linux and macOS starts `xdg-open` or `open` from PATH and ignores BROWSER,
//   so the check puts a folder of its own first on PATH whose openers only write the link down. BROWSER points at the
//   same helper for any agy that reads it.
// - agy's own log (--log-file, into the scratch folder) says "authenticated successfully as <email>". That line is
//   the account's email: read from what agy prints, never from the file its Google sign-in lives in.
// - Once signed in, the check opens one session in the scratch folder to read the model list and each model's effort
//   levels (models.ts), then deletes what agy wrote for that session id (conversations/<id>.db and brain/<id>/ in its
//   home), and only those. The list is kept on disk; a check that cannot read one keeps the last list.
//   The scratch folder goes when it ends.
//
// Starting agy is heavy, so a check runs only when asked (catalog-service.ts): at server start, on Check again and
// Check for new models, when a thread starts, and on demand while the harness is down. The last reading is kept.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { harnessEnv } from '../env-guard.ts';
import { AcpClient, AcpError, AcpExited, AcpTimeout } from '../acp/client.ts';
import { antigravityBin } from './bin.ts';
import { keepModels, lastModels, readModels, type AgyModel } from './models.ts';

/** The oldest agy Omni runs: T3 Code's lower bound. Older runtimes hide non-Gemini models from clients off their allowlist. */
export const MIN_VERSION = '1.5.1';
/** The method that signs agy in with the Google account it was signed in with in a terminal. */
export const GOOGLE_METHOD = 'oauth-personal';
/** agy prints this on stdout, then the link, when it wants a sign-in it cannot do itself (T3 Code). */
const LINK_PREFIX = 'Open the following link to authenticate the ACP server: ';

/** How long agy may take to start and answer initialize. Its one-file runtime unpacks on every launch. */
export const START_MS = 30_000;
/** How long sign-in may take once agy has started. A signed-in agy answers in about a second. */
export const AUTH_MS = 20_000;
/** OMNI_ANTIGRAVITY_CHECK_MS caps both, for a test or a machine where agy is known to be slow. */
const checkMs = (fallback: number) => Number(process.env.OMNI_ANTIGRAVITY_CHECK_MS) || fallback;

export type AntigravityStateKind = 'not-installed' | 'too-old' | 'signed-out' | 'no-subscription' | 'not-answering' | 'ready';

export interface AntigravityState {
  state: AntigravityStateKind;
  /** The binary the check ran, or would run. */
  bin: string | null;
  /** What agy reported in initialize. */
  version: string | null;
  /** Why it cannot run, and how to fix that. Unset when ready. */
  fix?: string;
  /** Worth knowing while it runs: a major version Omni was not tested on. */
  note?: string;
  /** The Google account agy signed in as, from its own log. Null when it did not say. */
  email: string | null;
  /** The plan agy reports for the account ("Google AI Pro"). */
  tier: string | null;
  /** The models agy offers this account, with their effort levels: the last list read, kept across a failed check. */
  models: AgyModel[];
  /** agy cannot see the skills in ~/.agents/skills. Never makes the harness unavailable. */
  hint?: string;
  /** agy tried to open a sign-in link. The link is kept here only, never sent to a client. */
  signInLink?: string;
  checkedAt: number;
}

export const FIX = {
  notInstalled: 'Omni found no agy on its PATH. Install the Antigravity CLI or set OMNI_ANTIGRAVITY_BIN to its path',
  tooOld: (found: string) => `agy ${found} is older than ${MIN_VERSION}, the version Omni needs. Run agy update in a terminal`,
  noGoogleSignIn: (found: string) => `agy ${found} does not offer Log in with Google over ACP. Run agy update in a terminal`,
  unreadableVersion: 'agy did not report a version Omni can read. Run agy update in a terminal',
  signedOut: 'agy is not signed in on this machine. Run agy in a terminal once and sign in with Google',
  noSubscription: 'Google says the account agy is signed in with has no Antigravity subscription. Run agy in a terminal and sign in with an account that has one',
  wontRun: (bin: string, why: string) => `Omni could not run ${bin} (${why}). Set OMNI_ANTIGRAVITY_BIN to an agy that runs`,
  exited: (method: string, last: string) => `agy acp exited before it answered ${method}${last ? `: ${last}` : ''}. Run agy in a terminal to see why`,
  silent: (method: string, ms: number, last: string) => `agy acp did not answer ${method} within ${ms / 1000} s${last ? `. It last printed: ${last}` : ''}. Run agy in a terminal to see why`,
  failed: (method: string, message: string) => `agy answered ${method} with an error: ${message}`,
};

export const UNTESTED_NOTE = (version: string) => `agy ${version} is a newer major version than Omni was tested on`;

/** The skills hint, worded once for Settings > Models. */
export const SKILLS_HINT = 'agy does not see your skills in ~/.agents/skills. Link them for it: ln -s ~/.agents/skills ~/.gemini/antigravity-cli/skills';

/** The home agy keeps its conversations in. */
export const agyHome = (home = homedir()) => join(home, '.gemini', 'antigravity-cli');

/** Remove what agy wrote for one session id, and nothing else. */
export function removeSessionFiles(sessionId: string, home = homedir()) {
  if (!/^[\w.-]+$/.test(sessionId)) return;
  const root = agyHome(home);
  rmSync(join(root, 'conversations', `${sessionId}.db`), { force: true });
  rmSync(join(root, 'brain', sessionId), { recursive: true, force: true });
}

/** "agy_acp_server_1.5.16" or "1.5.16" as [1, 5, 16], or null. */
export function parseVersion(v: string | null | undefined): number[] | null {
  const m = /^(?:agy_acp_server_)?v?(\d+)\.(\d+)\.(\d+)/.exec((v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const older = (a: number[], b: number[]) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};

/** The last non-empty line a process printed, short enough for a fix. */
const lastLine = (text: string) => (text.trim().split('\n').pop() ?? '').trim().slice(0, 200);

/** The system CA bundle agy's bundled runtime needs on Linux when SSL_CERT_FILE is unset (T3 Code found it looks elsewhere). */
function caBundle(env: NodeJS.ProcessEnv): string | undefined {
  if (process.platform !== 'linux' || env.SSL_CERT_FILE) return undefined;
  return [env.NIX_SSL_CERT_FILE, '/etc/ssl/certs/ca-certificates.crt', '/etc/ssl/certs/ca-bundle.crt', '/etc/pki/tls/certs/ca-bundle.crt', '/etc/ssl/cert.pem'].find(
    (p) => !!p && p.startsWith('/') && existsSync(p),
  );
}

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Every name a CLI uses to open a link. Each writes the link to `linkFile` and opens nothing. */
const OPENERS = ['xdg-open', 'open', 'x-www-browser', 'www-browser', 'sensible-browser', 'gio'];

/** A folder of openers that record a link and open nothing, for the front of agy's PATH. */
export function writeOpeners(dir: string, linkFile: string): string {
  mkdirSync(dir, { recursive: true });
  // `gio open <url>` passes the subcommand first: keep only what looks like a link.
  const script = `#!/bin/sh\nfor a in "$@"; do case "$a" in *://*) printf '%s\\n' "$a" >> ${shQuote(linkFile)};; esac; done\nexit 0\n`;
  for (const name of OPENERS) writeFileSync(join(dir, name), script, { mode: 0o755 });
  return join(dir, 'xdg-open');
}

/**
 * The environment an agy process gets: Omni's harness guard (no Google API keys or Vertex settings, whatever their
 * source), the recording openers first on PATH, and the system CA bundle on Linux.
 */
export function antigravityEnv(openers: string, secrets: Record<string, string> = {}, extra: Record<string, string> = {}, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = harnessEnv('antigravity', extra, secrets, base);
  env.PATH = `${openers}${delimiter}${env.PATH ?? ''}`;
  env.BROWSER = join(openers, 'xdg-open');
  const ca = caBundle(env);
  if (ca) env.SSL_CERT_FILE = ca;
  return env;
}

/**
 * Whether agy can see the skills in ~/.agents/skills: one of its home skills folders is that folder (a link), or has
 * every skill in it. The hint when it cannot, or undefined (also when ~/.agents/skills holds none).
 */
export function skillsHint(home = homedir()): string | undefined {
  const source = join(home, '.agents', 'skills');
  const names = (dir: string): string[] | null => {
    try {
      // A skill is a folder (a link to one counts) that holds a SKILL.md: a stray folder is not one.
      return readdirSync(dir).filter((n) => !n.startsWith('.') && existsSync(join(dir, n, 'SKILL.md')) && statSync(join(dir, n)).isDirectory());
    } catch {
      return null;
    }
  };
  const skills = names(source);
  if (!skills?.length) return undefined;
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return null;
    }
  };
  const src = real(source);
  for (const dir of [join(home, '.gemini', 'antigravity-cli', 'skills'), join(home, '.gemini', 'config', 'skills')]) {
    if (src && real(dir) === src) return undefined;
    const there = new Set(names(dir) ?? []);
    if (there.size && skills.every((s) => there.has(s))) return undefined;
  }
  return SKILLS_HINT;
}

/** The email in agy's log line "authenticated successfully as <email>", the last one when it says it twice. */
export function emailFromLog(log: string): string | null {
  const all = [...log.matchAll(/authenticated successfully as ([^\s,;]+@[^\s,;]+)/g)];
  return all.length ? all[all.length - 1][1] : null;
}

const read = (p: string) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

export interface CheckOptions {
  /** The environment Omni runs with (process.env by default): where the binary is looked up, before the guard. */
  env?: NodeJS.ProcessEnv;
  /** Channel and global secret values, as a thread would get them. The guard still wins over them. */
  secrets?: Record<string, string>;
  /** Where agy runs. A fresh scratch folder by default. */
  cwd?: string;
  startMs?: number;
  authMs?: number;
}

/** Run one check now. Never rejects. */
export async function checkAntigravity(opts: CheckOptions = {}): Promise<AntigravityState> {
  const base = opts.env ?? process.env;
  const at = () => Date.now();
  const hint = skillsHint(base.HOME || homedir());
  const reading = (s: Omit<AntigravityState, 'checkedAt' | 'email' | 'tier' | 'version' | 'bin' | 'models'> & Partial<AntigravityState>): AntigravityState => ({
    bin: null,
    version: null,
    email: null,
    tier: null,
    models: lastModels(),
    ...(hint && { hint }),
    ...s,
    checkedAt: at(),
  });
  const bin = antigravityBin(base);
  if (!bin) return reading({ state: 'not-installed', fix: FIX.notInstalled });

  const scratch = mkdtempSync(join(tmpdir(), 'omni-agy-check-'));
  const cwd = opts.cwd ?? join(scratch, 'work');
  mkdirSync(cwd, { recursive: true });
  const linkFile = join(scratch, 'sign-in-link');
  const logFile = join(scratch, 'acp.log');
  const openers = join(scratch, 'bin');
  writeOpeners(openers, linkFile);

  let stderr = '';
  let textLink: string | undefined;
  let spawnError: NodeJS.ErrnoException | undefined;
  const client = new AcpClient({
    bin,
    args: ['acp', '--log-file', logFile],
    cwd,
    env: antigravityEnv(openers, opts.secrets, {}, base),
    onStderr: (d) => void (stderr = (stderr + d).slice(-4000)),
    onText: (line) => {
      if (line.startsWith(LINK_PREFIX)) textLink ??= line.slice(LINK_PREFIX.length).trim();
    },
  });
  client.child.on('error', (e: NodeJS.ErrnoException) => void (spawnError ??= e));
  const link = () => textLink ?? (read(linkFile).trim().split('\n')[0] || undefined);

  /** A request that also ends as soon as agy tries to open a sign-in link. */
  const ask = <T>(method: string, params: unknown, ms: number) =>
    new Promise<T | 'link'>((resolve, reject) => {
      const poll = setInterval(() => {
        if (link()) {
          clearInterval(poll);
          resolve('link');
        }
      }, 50);
      client.request<T>(method, params, ms).then(
        (v) => (clearInterval(poll), resolve(v)),
        (e) => (clearInterval(poll), reject(e)),
      );
    });

  const signedOut = (version: string) => reading({ state: 'signed-out', bin, version, fix: FIX.signedOut, signInLink: link() });
  let method = 'initialize';
  try {
    const init = await ask<{ agentInfo?: { version?: unknown }; authMethods?: { id?: unknown }[] }>(
      'initialize',
      { protocolVersion: 1, clientInfo: { name: 'omni-os', version: '0.1.0' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } },
      opts.startMs ?? checkMs(START_MS),
    );
    if (init === 'link') return signedOut('');
    const raw = typeof init?.agentInfo?.version === 'string' ? init.agentInfo.version : null;
    const parsed = parseVersion(raw);
    const version = parsed ? parsed.join('.') : raw;
    if (!parsed) return reading({ state: 'too-old', bin, version, fix: version ? FIX.tooOld(version) : FIX.unreadableVersion });
    if (older(parsed, parseVersion(MIN_VERSION)!)) return reading({ state: 'too-old', bin, version, fix: FIX.tooOld(version!) });
    if (Array.isArray(init.authMethods) && !init.authMethods.some((m) => m?.id === GOOGLE_METHOD)) return reading({ state: 'too-old', bin, version, fix: FIX.noGoogleSignIn(version!) });
    const note = parsed[0] > 1 ? UNTESTED_NOTE(version!) : undefined;

    method = 'authenticate';
    const auth = await ask<{ _meta?: { antigravity?: { tier?: { name?: unknown } } } }>('authenticate', { methodId: GOOGLE_METHOD }, opts.authMs ?? checkMs(AUTH_MS));
    if (auth === 'link') return signedOut(version!);
    const tierName = auth?._meta?.antigravity?.tier?.name;
    let email = emailFromLog(read(logFile));
    for (let i = 0; !email && i < 3; i++) {
      await new Promise((r) => setTimeout(r, 100));
      email = emailFromLog(read(logFile));
    }
    const models = await readSessionModels(client, cwd, base.HOME || homedir());
    return reading({ state: 'ready', bin, version, email, tier: typeof tierName === 'string' ? tierName : null, ...(models.length ? { models } : {}), ...(note && { note }) });
  } catch (e) {
    const last = lastLine(stderr);
    if (spawnError) {
      const code = spawnError.code ?? spawnError.message;
      return code === 'ENOENT' ? reading({ state: 'not-installed', bin, fix: FIX.notInstalled }) : reading({ state: 'not-answering', bin, fix: FIX.wontRun(bin, code) });
    }
    if (e instanceof AcpError) {
      if (/SUBSCRIPTION_REQUIRED/.test(`${e.message} ${JSON.stringify(e.data ?? '')}`)) return reading({ state: 'no-subscription', bin, fix: FIX.noSubscription });
      if (method === 'authenticate' && e.code === -32000) return reading({ state: 'signed-out', bin, fix: FIX.signedOut, signInLink: link() });
      return reading({ state: 'not-answering', bin, fix: FIX.failed(method, e.message.slice(0, 200)) });
    }
    if (e instanceof AcpTimeout) return reading({ state: 'not-answering', bin, fix: FIX.silent(method, e.ms, last) });
    if (e instanceof AcpExited) return reading({ state: 'not-answering', bin, fix: FIX.exited(method, last) });
    return reading({ state: 'not-answering', bin, fix: FIX.failed(method, e instanceof Error ? e.message : String(e)) });
  } finally {
    await client.stop();
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Open a session in `cwd`, read the models, and delete what agy wrote for it. Empty when agy will not open one: the
 * harness still runs on the list it had.
 */
async function readSessionModels(client: AcpClient, cwd: string, home: string): Promise<AgyModel[]> {
  let sessionId: string | undefined;
  try {
    const opened = await client.request<{ sessionId?: unknown }>('session/new', { cwd, mcpServers: [] }, NEW_MS());
    if (typeof opened?.sessionId !== 'string') return [];
    sessionId = opened.sessionId;
    const models = await readModels(client, sessionId, opened);
    keepModels(models);
    return models;
  } catch {
    return [];
  } finally {
    if (sessionId) removeSessionFiles(sessionId, home);
  }
}

const NEW_MS = () => checkMs(30_000);

let last: AntigravityState | null = null;
let running: Promise<AntigravityState> | null = null;
const listeners = new Set<(s: AntigravityState) => void>();

/** Hear every check's reading as it is kept (antigravity-usage.ts reads the allowances once agy is ready). */
export function onAntigravityChecked(fn: (s: AntigravityState) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Check now and keep the reading. A call while a check runs joins it. */
export function refreshAntigravity(opts: CheckOptions = {}): Promise<AntigravityState> {
  running ??= checkAntigravity(opts)
    .then((s) => {
      last = s;
      for (const fn of listeners) {
        try {
          fn(s);
        } catch (err) {
          console.error('[antigravity] a check listener failed:', (err as Error).message);
        }
      }
      return s;
    })
    .finally(() => {
      running = null;
    });
  return running;
}

/**
 * A thread's agy tried to open a sign-in link: the harness is signed out on this machine until a check says otherwise.
 * The link itself is dropped, never kept or sent to a client.
 */
export function markSignedOut() {
  last = { ...(last ?? { bin: null, version: null, email: null, tier: null, models: lastModels() }), state: 'signed-out', fix: FIX.signedOut, checkedAt: Date.now() };
}

/** The last reading, or null before the first check. */
export const antigravityState = (): AntigravityState | null => last;

/** For tests: forget the last reading. */
export function resetAntigravityState() {
  last = null;
}
