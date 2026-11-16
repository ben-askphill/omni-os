// `omni doctor`: why Omni is not working, without needing the server. Every check reads this machine; the server is
// asked only whether it answers, and whether it takes the token.
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { OmniHttpError } from '@omni/client-core';
import { diskLevel, freeSize } from '@omni/shared/disk-space.ts';
import { flag, parseArgs } from '../args.ts';
import { client, connection, describeSource, type Connection } from '../connection.ts';
import { clip, json, when } from '../format.ts';
import { EXIT, UsageError, type Io } from '../io.ts';
import { VERSION } from '../version.ts';

export type Level = 'ok' | 'warn' | 'fail';

export interface Check {
  name: string;
  level: Level;
  detail: string;
  /** Lines to show under it: the end of the server log. */
  lines?: string[];
}

const PROBE_MS = 2000;
const LOGIN_MS = 10_000;

/** What answers on the port: the same probe the desktop app makes before it starts or attaches (apps/desktop/src/backend/launch.ts). */
export type Probe = { kind: 'free' } | { kind: 'slow' } | { kind: 'not-omni'; detail: string } | { kind: 'omni'; mine: boolean | null };

/** The proof an Omni server answers GET /api/auth/proof with: an HMAC of its port and the nonce under its token. */
export const proofFor = (token: string, port: number, nonce: string) => createHmac('sha256', token).update(`omni-proof:${port}:${nonce}`).digest('hex');

function errnoOf(err: unknown): string | undefined {
  const cause = (err as { cause?: { code?: string; errors?: { code?: string }[] } } | null)?.cause;
  return cause?.code ?? cause?.errors?.find((e) => e.code)?.code;
}

export async function probe(io: Io, conn: Connection): Promise<Probe> {
  const nonce = io.uuid().replace(/-/g, '');
  let status: number;
  let body: string;
  try {
    const res = await io.fetch(`${conn.baseUrl}/api/auth/proof?nonce=${nonce}`, { method: 'GET', headers: {}, redirect: 'manual', signal: AbortSignal.timeout(PROBE_MS) });
    status = res.status;
    body = await res.text();
  } catch (err) {
    if (errnoOf(err) === 'ECONNREFUSED') return { kind: 'free' };
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'slow' };
    return { kind: 'not-omni', detail: 'nothing answered as HTTP' };
  }
  let proof: unknown = null;
  try {
    proof = (JSON.parse(body) as { proof?: unknown }).proof;
  } catch {
    proof = null;
  }
  if (status !== 200 || typeof proof !== 'string') return { kind: 'not-omni', detail: `it answered ${status}, not an Omni proof` };
  const token = conn.token();
  // Through a tunnel or proxy the server signs its own port, not the one in OMNI_URL: only a local proof can be checked.
  if (!token || conn.remote) return { kind: 'omni', mine: null };
  return { kind: 'omni', mine: proof === proofFor(token, conn.port, nonce) };
}

function serverCheck(p: Probe, conn: Connection): Check {
  const at = conn.baseUrl;
  switch (p.kind) {
    case 'free':
      return { name: 'server', level: 'fail', detail: `nothing answers on ${at}: Omni is not running. Open the Omni app${conn.remote ? ' on that machine' : ''}.` };
    case 'slow':
      return { name: 'server', level: 'fail', detail: `${at} is taken but did not answer within ${PROBE_MS / 1000}s. If it is Omni, it is stuck or starting: see the log below.` };
    case 'not-omni':
      return { name: 'server', level: 'fail', detail: `${at} answers, but not as Omni (${p.detail}). Another program holds the port.` };
    case 'omni':
      if (p.mine === false) return { name: 'server', level: 'fail', detail: `${at} answers as Omni, but not with this token: another install, or the token changed.` };
      return { name: 'server', level: 'ok', detail: `Omni answers on ${at}` };
  }
}

async function tokenCheck(io: Io, conn: Connection, p: Probe): Promise<Check> {
  const source = conn.tokenSource;
  const where = describeSource(source);
  if (source.kind === 'none') return { name: 'token', level: 'fail', detail: `none found. ${where}.` };
  if (source.kind === 'file') {
    const st = io.stat(source.path);
    if (!st) return { name: 'token', level: 'fail', detail: `${where} does not exist. The server writes it on its first start.` };
    if (!conn.token()) return { name: 'token', level: 'fail', detail: `${where} is empty or unreadable.` };
    if (st.mode & 0o077) return { name: 'token', level: 'warn', detail: `${where} can be read by other users (mode ${(st.mode & 0o777).toString(8)}). It should be 600.` };
  }
  if (p.kind !== 'omni') return { name: 'token', level: 'ok', detail: `${where} (not checked: the server is not answering)` };
  // A wrong proof means whatever holds the port is not this install: it does not get the token.
  if (p.mine === false) return { name: 'token', level: 'ok', detail: `${where} (not sent: the server on that port is not this install)` };
  try {
    await client(io, conn).api.status();
    return { name: 'token', level: 'ok', detail: `${where}, and the server takes it` };
  } catch (err) {
    if (err instanceof OmniHttpError && err.failure.kind === 'http' && err.failure.status === 401) {
      return { name: 'token', level: 'fail', detail: `${where}: the server refused it. It was rotated or belongs to another install.` };
    }
    return { name: 'token', level: 'warn', detail: `${where}: the server did not say (${clip(err instanceof Error ? err.message : String(err), 80)})` };
  }
}

function dataCheck(io: Io, conn: Connection): Check {
  if (!conn.dataDir) return { name: 'data', level: 'warn', detail: "unknown. The desktop app's omni command knows it; elsewhere set OMNI_DATA_DIR." };
  if (!io.stat(conn.dataDir)?.dir) return { name: 'data', level: 'fail', detail: `${conn.dataDir} does not exist.` };
  if (!io.stat(join(conn.dataDir, 'omni.db'))) return { name: 'data', level: 'warn', detail: `${conn.dataDir} has no omni.db yet: the server has not started with it.` };
  return { name: 'data', level: 'ok', detail: conn.dataDir };
}

function diskChecks(io: Io, conn: Connection): Check[] {
  const tmp = io.env.TMPDIR || '/tmp';
  const places: [string, string][] = [
    [conn.dataDir ?? io.env.HOME ?? '/', conn.dataDir ? "Omni's data" : 'your home folder'],
    [tmp, 'the temp folder'],
  ];
  const seen = new Set<string>();
  const out: Check[] = [];
  for (const [path, what] of places) {
    const d = io.disk(path);
    if (!d) continue;
    // Two folders on one disk read the same: say it once.
    const key = `${d.free}:${d.total}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const level = diskLevel(d.free, d.total);
    const text = `${freeSize(d.free)} free of ${freeSize(d.total)} on the disk with ${what} (${path})`;
    out.push({ name: 'disk', level: level === 'ok' ? 'ok' : level === 'low' ? 'warn' : 'fail', detail: level === 'critical' ? `${text}. Threads stop working when it fills.` : text });
  }
  return out;
}

/** Claude Code: `claude auth status --json`, as Settings > Accounts reads it (apps/server/harness-accounts.ts). */
async function claudeCheck(io: Io): Promise<Check> {
  const r = await io.run('claude', ['auth', 'status', '--json'], LOGIN_MS);
  if (r.missing) return { name: 'claude', level: 'warn', detail: 'not installed (no claude on PATH)' };
  try {
    const s = JSON.parse(r.stdout) as { loggedIn?: unknown; authMethod?: unknown; subscriptionType?: unknown };
    if (s.loggedIn !== true) return { name: 'claude', level: 'fail', detail: 'signed out: run claude and sign in' };
    const how = [s.authMethod, s.subscriptionType].filter((x): x is string => typeof x === 'string' && !!x);
    return { name: 'claude', level: 'ok', detail: `signed in${how.length ? ` (${how.join(', ')})` : ''}` };
  } catch {
    return { name: 'claude', level: 'warn', detail: 'claude auth status did not answer' };
  }
}

async function codexCheck(io: Io): Promise<Check> {
  const r = await io.run('codex', ['login', 'status'], LOGIN_MS);
  if (r.missing) return { name: 'codex', level: 'warn', detail: 'not installed (no codex on PATH)' };
  // Only the kind of login is repeated: the line can carry a masked API key.
  const said = `${r.stdout}\n${r.stderr}`;
  const how = /chatgpt/i.test(said) ? ' (ChatGPT)' : /api key/i.test(said) ? ' (an API key, not the ChatGPT plan Omni runs on)' : '';
  if (r.code === 0) return { name: 'codex', level: how.includes('API key') ? 'warn' : 'ok', detail: `signed in${how}` };
  if (r.code === null) return { name: 'codex', level: 'warn', detail: 'codex login status did not answer' };
  return { name: 'codex', level: 'fail', detail: 'signed out: run codex login' };
}

async function ghCheck(io: Io): Promise<Check> {
  const r = await io.run('gh', ['auth', 'status', '--hostname', 'github.com'], LOGIN_MS);
  if (r.missing) return { name: 'gh', level: 'warn', detail: 'not installed (no gh on PATH): PR features need it' };
  // gh prints its status on stderr in older versions and stdout in newer ones. Only the account name is kept.
  const account = `${r.stdout}\n${r.stderr}`.match(/Logged in to github\.com (?:account|as) (\S+)/)?.[1];
  if (r.code === 0) return { name: 'gh', level: 'ok', detail: `signed in to github.com${account ? ` as ${account}` : ''}` };
  if (r.code === null) return { name: 'gh', level: 'warn', detail: 'gh auth status did not answer' };
  return { name: 'gh', level: 'fail', detail: 'signed out of github.com: run gh auth login' };
}

const LOG_LINES = 8;
const TROUBLE = /\b(error|fatal|uncaught|unhandled|EADDRINUSE|ENOSPC|EDQUOT|crash(ed)?|SIGSEGV|SIGKILL)\b/i;

function logCheck(io: Io, conn: Connection, serverDown: boolean): Check {
  if (!conn.logFile) return { name: 'log', level: 'warn', detail: "unknown. The desktop app's omni command knows where the server log is." };
  const st = io.stat(conn.logFile);
  if (!st) return { name: 'log', level: serverDown ? 'warn' : 'ok', detail: `${conn.logFile} does not exist yet` };
  const tail = (io.tail(conn.logFile, 16_000) ?? '').split('\n').filter((l) => l.trim()).slice(-LOG_LINES);
  const trouble = tail.some((l) => TROUBLE.test(l));
  const detail = `${conn.logFile}, last written ${when(new Date(st.mtimeMs).toISOString(), io.now())}`;
  const lines = serverDown || trouble ? tail.map((l) => clip(l, 200)) : undefined;
  return { name: 'log', level: trouble ? 'warn' : 'ok', detail: trouble ? `${detail}. Its last lines report trouble:` : detail, ...(lines && { lines }) };
}

function commandCheck(io: Io, conn: Connection): Check {
  if (!conn.app) return { name: 'omni', level: 'ok', detail: `${VERSION}, not run through the desktop app's command` };
  if (!io.stat(conn.app)) return { name: 'omni', level: 'fail', detail: `${conn.app} is gone. Open the Omni app once and it points this command at itself again.` };
  return { name: 'omni', level: 'ok', detail: `${VERSION}, runs on ${conn.app}` };
}

export async function runChecks(io: Io): Promise<Check[]> {
  const conn = connection(io);
  const p = await probe(io, conn);
  const [token, claude, codex, gh] = await Promise.all([tokenCheck(io, conn, p), claudeCheck(io), codexCheck(io), ghCheck(io)]);
  return [commandCheck(io, conn), serverCheck(p, conn), token, dataCheck(io, conn), ...diskChecks(io, conn), claude, codex, gh, logCheck(io, conn, p.kind !== 'omni')];
}

const LABEL: Record<Level, string> = { ok: 'ok', warn: 'warn', fail: 'FAIL' };

export function renderChecks(checks: Check[]): string {
  const width = Math.max(...checks.map((c) => c.name.length));
  return checks
    .map((c) => {
      const head = `${LABEL[c.level].padEnd(4)}  ${c.name.padEnd(width)}  ${c.detail}`;
      const under = (c.lines ?? []).map((l) => `${' '.repeat(width + 8)}| ${l}`);
      return [head, ...under].join('\n');
    })
    .join('\n') + '\n';
}

export async function doctorCommand(argv: string[], io: Io): Promise<number> {
  const p = parseArgs(argv, { json: {} }, 'doctor');
  if (p.positional.length) throw new UsageError(`unexpected ${p.positional[0]}`, 'doctor');
  const checks = await runChecks(io);
  const failed = checks.some((c) => c.level === 'fail');
  if (flag(p, 'json')) io.out(json({ ok: !failed, checks }));
  else io.out(renderChecks(checks));
  return failed ? EXIT.failed : EXIT.ok;
}
