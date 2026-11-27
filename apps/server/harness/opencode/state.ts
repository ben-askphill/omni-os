// What state OpenCode is in on this machine: the one reader the catalog and Settings > Accounts read (spec
// docs/plans/2026-11-27-opencode-harness.md section 6). Shaped like antigravity/state.ts.
//
// A check starts `opencode acp` in a scratch folder and speaks ACP to it:
// - `initialize` gives the version (agentInfo.version). OpenCode 2.3.0 is the oldest Omni runs, and a 1.x answer is the
//   other program that shares the name (`opencode-ai`): refused, with the fix.
// - The free Zen models need no account and no key, so there is no signed-out state. One session is opened to read the
//   model list and each Zen model's effort levels (models.ts), then deleted (`session/delete`), so a check leaves nothing
//   in OpenCode's database. The list is kept on disk; a check that cannot read one keeps the last list.
// - Starting OpenCode is heavy, so a check runs only when asked (catalog-service.ts), as Antigravity's does.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpClient, AcpError, AcpExited, AcpTimeout } from '../acp/client.ts';
import { parseVersion } from '../antigravity/state.ts';
import { opencodeBin } from './bin.ts';
import { configContent } from './config.ts';
import { opencodeEnv } from './env.ts';
import { keepModels, lastModels, readModels, type OpenCodeModel } from './models.ts';

/** The oldest OpenCode Omni runs: the version this support was tested on. */
export const MIN_VERSION = '2.3.0';
export const START_MS = 30_000;
const checkMs = (fallback: number) => Number(process.env.OMNI_OPENCODE_CHECK_MS) || fallback;

export type OpenCodeStateKind = 'not-installed' | 'too-old' | 'not-answering' | 'ready';

export interface OpenCodeState {
  state: OpenCodeStateKind;
  bin: string | null;
  version: string | null;
  fix?: string;
  /** Worth knowing while it runs: a major version Omni was not tested on. */
  note?: string;
  /** The models OpenCode offers, with the Zen ones first: the last list read, kept across a failed check. */
  models: OpenCodeModel[];
  checkedAt: number;
}

export const FIX = {
  notInstalled: 'Omni found no opencode on its PATH. Install OpenCode 2 with npm install -g @opencode/cli, or set OMNI_OPENCODE_BIN to its path',
  tooOld: (found: string) => `opencode ${found} is older than ${MIN_VERSION}, the version Omni needs. Run npm install -g @opencode/cli@latest`,
  v1: (found: string) => `opencode ${found} is OpenCode 1 (the opencode-ai package), which Omni does not run. Install OpenCode 2 with npm install -g @opencode/cli, and make sure it comes first on PATH`,
  unreadableVersion: 'opencode did not report a version Omni can read. Run npm install -g @opencode/cli@latest',
  wontRun: (bin: string, why: string) => `Omni could not run ${bin} (${why}). Set OMNI_OPENCODE_BIN to an opencode that runs`,
  exited: (last: string) => `opencode acp exited before it answered${last ? `: ${last}` : ''}. Run opencode in a terminal to see why`,
  silent: (ms: number, last: string) => `opencode acp did not answer within ${ms / 1000} s${last ? `. It last printed: ${last}` : ''}. Run opencode in a terminal to see why`,
  failed: (method: string, message: string) => `opencode answered ${method} with an error: ${message}`,
};

export const UNTESTED_NOTE = (version: string) => `opencode ${version} is a newer major version than Omni was tested on`;

const older = (a: number[], b: number[]) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};
const lastLine = (text: string) => (text.trim().split('\n').pop() ?? '').trim().slice(0, 200);

export interface CheckOptions {
  env?: NodeJS.ProcessEnv;
  secrets?: Record<string, string>;
  cwd?: string;
  startMs?: number;
}

/** Run one check now. Never rejects. */
export async function checkOpenCode(opts: CheckOptions = {}): Promise<OpenCodeState> {
  const base = opts.env ?? process.env;
  const reading = (s: Omit<OpenCodeState, 'checkedAt' | 'version' | 'bin' | 'models'> & Partial<OpenCodeState>): OpenCodeState => ({ bin: null, version: null, models: lastModels(), ...s, checkedAt: Date.now() });
  const bin = opencodeBin(base);
  if (!bin) return reading({ state: 'not-installed', fix: FIX.notInstalled });

  const scratch = mkdtempSync(join(tmpdir(), 'omni-opencode-check-'));
  const cwd = opts.cwd ?? join(scratch, 'work');
  mkdirSync(cwd, { recursive: true });
  let stderr = '';
  let spawnError: NodeJS.ErrnoException | undefined;
  const client = new AcpClient({
    bin,
    args: ['acp'],
    cwd,
    env: opencodeEnv({ OPENCODE_CONFIG_CONTENT: configContent({ held: true, delegateOnly: false, noEdits: false, readOnly: true }) }, opts.secrets, base),
    onStderr: (d) => void (stderr = (stderr + d).slice(-4000)),
  });
  client.child.on('error', (e: NodeJS.ErrnoException) => void (spawnError ??= e));
  let method = 'initialize';
  try {
    const init = await client.request<{ agentInfo?: { version?: unknown } }>(
      'initialize',
      { protocolVersion: 1, clientInfo: { name: 'omni-os', version: '0.1.0' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } },
      opts.startMs ?? checkMs(START_MS),
    );
    const raw = typeof init?.agentInfo?.version === 'string' ? init.agentInfo.version : null;
    const parsed = parseVersion(raw);
    const version = parsed ? parsed.join('.') : raw;
    if (!parsed) return reading({ state: 'too-old', bin, version, fix: FIX.unreadableVersion });
    if (parsed[0] < 2) return reading({ state: 'too-old', bin, version, fix: FIX.v1(version!) });
    if (older(parsed, parseVersion(MIN_VERSION)!)) return reading({ state: 'too-old', bin, version, fix: FIX.tooOld(version!) });
    const note = parsed[0] > 2 ? UNTESTED_NOTE(version!) : undefined;
    method = 'session/new';
    const models = await readSessionModels(client, cwd);
    return reading({ state: 'ready', bin, version, ...(models.length ? { models } : {}), ...(note && { note }) });
  } catch (e) {
    const last = lastLine(stderr);
    if (spawnError) {
      const code = spawnError.code ?? spawnError.message;
      return code === 'ENOENT' ? reading({ state: 'not-installed', bin, fix: FIX.notInstalled }) : reading({ state: 'not-answering', bin, fix: FIX.wontRun(bin, code) });
    }
    if (e instanceof AcpError) return reading({ state: 'not-answering', bin, fix: FIX.failed(method, e.message.slice(0, 200)) });
    if (e instanceof AcpTimeout) return reading({ state: 'not-answering', bin, fix: FIX.silent(e.ms, last) });
    if (e instanceof AcpExited) return reading({ state: 'not-answering', bin, fix: FIX.exited(last) });
    return reading({ state: 'not-answering', bin, fix: FIX.failed(method, e instanceof Error ? e.message : String(e)) });
  } finally {
    await client.stop();
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Open a session in `cwd`, read the models, and delete the session. Empty when OpenCode will not open one. */
async function readSessionModels(client: AcpClient, cwd: string): Promise<OpenCodeModel[]> {
  let sessionId: string | undefined;
  try {
    const opened = await client.request<{ sessionId?: unknown }>('session/new', { cwd, mcpServers: [] }, checkMs(30_000));
    if (typeof opened?.sessionId !== 'string') return [];
    sessionId = opened.sessionId;
    const models = await readModels(client, sessionId, opened);
    keepModels(models);
    return models;
  } catch {
    return [];
  } finally {
    if (sessionId) await client.request('session/delete', { sessionId }, 5_000).catch(() => {});
  }
}

let last: OpenCodeState | null = null;
let running: Promise<OpenCodeState> | null = null;

/** Check now and keep the reading. A call while a check runs joins it. */
export function refreshOpenCode(opts: CheckOptions = {}): Promise<OpenCodeState> {
  running ??= checkOpenCode(opts)
    .then((s) => (last = s))
    .finally(() => {
      running = null;
    });
  return running;
}

/** The last reading, or null before the first check. */
export const opencodeState = (): OpenCodeState | null => last;

/** For tests: forget the last reading. */
export function resetOpenCodeState() {
  last = null;
}
