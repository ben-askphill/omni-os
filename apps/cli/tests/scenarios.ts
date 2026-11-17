// Runs one recorded scenario against the omni command as a process: a temp folder with the files and stand-in
// programs the scenario names, a scripted stand-in for Omni's API on a local port, and what the command printed,
// asked the API and started. The scenarios and what they expect live in packages/test-fixtures/native/cli, where
// crates/omni-cli/tests/goldens.rs runs the same files against the Rust binary, so both are held to one record.
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { WIRE_FIXTURES } from '@omni/test-fixtures';

/** One scripted answer of the stand-in API. */
export interface Reply {
  status?: number;
  /**
   * The body as JSON. A string such as "{{now-100s}}" in it becomes that time, as the server writes one, and `{dir}`
   * in a string becomes the temp folder.
   */
  json?: unknown;
  /** The body is this recorded answer of the real server, from packages/test-fixtures/wire. */
  wire?: string;
  /** The body as given, for an answer that is not JSON. */
  text?: string;
  /** Defaults to application/json for `json` and text/plain for `text`. */
  contentType?: string;
  headers?: Record<string, string>;
  /** Answer this much later: past the time a proof covers, so the next request proves the server again. */
  delayMs?: number;
  /** Never answer. */
  hang?: boolean;
  /** Close the connection without answering. */
  drop?: boolean;
  /** Write these bytes in place of an HTTP answer, then close. */
  raw?: string;
}

export interface Route {
  method: string;
  /** The request's path with its query, or what it starts with when `prefix` is set. */
  path: string;
  prefix?: boolean;
  /** One per call in turn. The last one repeats. */
  replies: Reply[];
}

/** A program on the command's PATH: what it prints and exits with. `record` keeps the arguments it was started with. */
export interface Program {
  stdout?: string;
  stderr?: string;
  exit?: number;
  record?: boolean;
}

export interface FileSpec {
  text: string;
  /** Octal, such as "600". */
  mode?: string;
  /** Last written this long ago. */
  agoMs?: number;
}

export interface SeenRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Parsed JSON, the raw text when it is not JSON, or null for no body. */
  body: unknown;
}

export interface Expected {
  stdout: string;
  stderr: string;
  exit: number | null;
  requests: SeenRequest[];
  /** The arguments each recording program was started with, by its name. */
  launched: Record<string, string[]>;
}

export interface Scenario {
  name: string;
  args: string[];
  /** Piped in. Without it the command reads an empty pipe. */
  stdin?: string;
  /**
   * How the command finds the server. `url`: OMNI_URL names the stand-in, as inside a thread. `port`: OMNI_INSTALL_PORT
   * does, as from the desktop app's shim, so the command asks for a proof first. `closed-url` and `closed-port` are the
   * same with nothing listening. `none` sets neither: the scenario's `env` says.
   */
  address?: 'url' | 'port' | 'closed-url' | 'closed-port' | 'none';
  /** `{dir}` is the temp folder, `{url}` the stand-in's address and `{port}` its port. */
  env?: Record<string, string>;
  files?: Record<string, FileSpec>;
  dirs?: string[];
  /** Under the temp folder. */
  cwd?: string;
  /** By name, put in the one folder on the command's PATH. */
  programs?: Record<string, Program>;
  /** The token the stand-in signs GET /api/auth/proof with, or "wrong" for a proof that never matches. */
  proof?: string;
  routes?: Route[];
  expected?: Expected;
}

/** The headers both implementations must send the same. The rest (user-agent, accept-encoding) belong to the HTTP client. */
const HEADERS = ['accept', 'authorization', 'content-type'];

const TIMEOUT_MS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PLACEHOLDER = /^\{\{now([+-]\d+)(ms|s|m|h|d)\}\}$/;
const UNIT = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** The scenario's times, as the server would have written them `now`, and its paths under the temp folder. */
function filled(value: unknown, now: number, dir: string): unknown {
  if (typeof value === 'string') {
    const m = PLACEHOLDER.exec(value);
    return m ? new Date(now + Number(m[1]) * UNIT[m[2] as keyof typeof UNIT]).toISOString() : value.replaceAll('{dir}', dir);
  }
  if (Array.isArray(value)) return value.map((v) => filled(v, now, dir));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, filled(v, now, dir)]));
  return value;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The ids the command makes up itself (a new thread's, a message's) are random: the record holds a placeholder. */
function withoutRandomIds(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const out: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const key of ['id', 'request_id']) if (typeof out[key] === 'string' && UUID.test(out[key])) out[key] = '{uuid}';
  return out;
}

const sh = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

/** A stand-in program as a shell script that needs nothing on PATH. */
function programScript(p: Program): string {
  const lines = ['#!/bin/sh'];
  if (p.record) lines.push('for a in "$@"; do printf \'%s\\n\' "$a"; done > "$0.args"');
  if (p.stdout) lines.push(`printf '%s' ${sh(p.stdout)}`);
  if (p.stderr) lines.push(`printf '%s' ${sh(p.stderr)} >&2`);
  lines.push(`exit ${p.exit ?? 0}`);
  return `${lines.join('\n')}\n`;
}

/** A port nothing listens on: taken, then given back. */
async function closedPort(): Promise<number> {
  const server = createTcpServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/**
 * `omni doctor` reads how full this machine's disks are, which no record can hold: its disk lines are left out. A
 * full disk fails the command on its own, so the exit code is what the other checks give.
 */
function withoutDisks(stdout: string, exit: number | null): { stdout: string; exit: number | null } {
  // Only a run that got as far as its checks: a wrong command line or the help text has none.
  if ((exit !== 0 && exit !== 1) || !/^(\{|(ok|warn|FAIL) )/.test(stdout)) return { stdout, exit };
  if (stdout.startsWith('{')) {
    try {
      const report = JSON.parse(stdout) as { ok: boolean; checks: { name: string; level: string }[] };
      const checks = report.checks.filter((c) => c.name !== 'disk');
      const ok = !checks.some((c) => c.level === 'fail');
      return { stdout: `${JSON.stringify({ ...report, ok, checks }, null, 2)}\n`, exit: ok ? 0 : 1 };
    } catch {
      return { stdout, exit };
    }
  }
  const lines = stdout.split('\n').filter((l) => !/^(ok|warn|FAIL) +disk +/.test(l));
  return { stdout: lines.join('\n'), exit: lines.some((l) => l.startsWith('FAIL')) ? 1 : 0 };
}

/** Runs `command` with the scenario's arguments and answers what it did. */
export async function runScenario(scenario: Scenario, command: { bin: string; args: string[] }): Promise<Expected> {
  // The real path: the command prints its working folder as the system names it.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'omni-cli-scenario-')));
  const now = Date.now();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  for (const d of scenario.dirs ?? []) mkdirSync(join(dir, d), { recursive: true });
  for (const [path, spec] of Object.entries(scenario.files ?? {})) {
    const file = join(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, spec.text);
    if (spec.mode) chmodSync(file, Number.parseInt(spec.mode, 8));
    if (spec.agoMs !== undefined) utimesSync(file, (now - spec.agoMs) / 1000, (now - spec.agoMs) / 1000);
  }
  for (const [name, program] of Object.entries(scenario.programs ?? {})) {
    writeFileSync(join(bin, name), programScript(program));
    chmodSync(join(bin, name), 0o755);
  }

  const seen: SeenRequest[] = [];
  const calls = new Map<Route, number>();
  const api = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const text = await readBody(req);
      const url = req.url ?? '';
      seen.push({
        method: req.method ?? '',
        url: url.replace(/^(\/api\/auth\/proof\?nonce=)[0-9a-f]{32}$/, '$1{nonce}'),
        headers: Object.fromEntries(HEADERS.flatMap((h) => (typeof req.headers[h] === 'string' ? [[h, req.headers[h]]] : []))),
        body: withoutRandomIds(parseBody(text)),
      });
      const route = (scenario.routes ?? []).find((r) => r.method === req.method && (r.prefix ? url.startsWith(r.path) : url === r.path));
      let reply: Reply;
      if (route) {
        const n = calls.get(route) ?? 0;
        calls.set(route, n + 1);
        reply = route.replies[Math.min(n, route.replies.length - 1)];
      } else if (scenario.proof !== undefined && req.method === 'GET' && url.startsWith('/api/auth/proof?nonce=')) {
        const nonce = url.slice('/api/auth/proof?nonce='.length);
        const proof = scenario.proof === 'wrong' ? 'deadbeef' : createHmac('sha256', scenario.proof).update(`omni-proof:${port}:${nonce}`).digest('hex');
        reply = { json: { proof } };
      } else {
        reply = { status: 500, json: { error: 'The scenario scripted no answer for this request.' } };
      }
      if (reply.hang) return;
      if (reply.drop) return void req.socket.destroy();
      if (reply.raw !== undefined) return void req.socket.end(reply.raw);
      if (reply.delayMs) await sleep(reply.delayMs);
      const body = reply.wire ? readFileSync(join(WIRE_FIXTURES, reply.wire), 'utf8') : (reply.text ?? JSON.stringify(filled(reply.json ?? {}, now, dir)));
      res.writeHead(reply.status ?? 200, { 'content-type': reply.contentType ?? (reply.text === undefined ? 'application/json' : 'text/plain'), connection: 'close', ...reply.headers });
      res.end(body);
    })();
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const address = scenario.address ?? 'url';
  const port = address.startsWith('closed') ? await closedPort() : (api.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;
  const placed = (text: string) => text.replaceAll('{dir}', dir).replaceAll('{url}', url).replaceAll('{port}', String(port));
  const recorded = (text: string) => text.replaceAll(url, '{url}').replaceAll(dir, '{dir}');

  const child = spawn(command.bin, [...command.args, ...scenario.args], {
    cwd: scenario.cwd ? join(dir, scenario.cwd) : dir,
    // Nothing of the machine's own Omni reaches the command, and the only programs it finds are the scenario's.
    env: {
      PATH: bin,
      HOME: dir,
      ...(address === 'none' ? {} : address.endsWith('url') ? { OMNI_URL: url } : { OMNI_INSTALL_PORT: String(port) }),
      ...Object.fromEntries(Object.entries(scenario.env ?? {}).map(([k, v]) => [k, placed(v)])),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
  child.stdin.on('error', () => {});
  child.stdin.end(scenario.stdin ?? '');
  const exited = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)));

  try {
    let exit = await Promise.race([exited, sleep(TIMEOUT_MS).then(() => 'timeout' as const)]);
    if (exit === 'timeout') throw new Error('the command did not exit');
    // A started program outlives the command: its arguments are there a moment later.
    const recording = Object.entries(scenario.programs ?? {}).filter(([, p]) => p.record);
    if (recording.length) await sleep(300);
    const launched: Record<string, string[]> = {};
    for (const file of readdirSync(bin)) {
      if (!file.endsWith('.args') || !existsSync(join(bin, file))) continue;
      const name = file.slice(0, -'.args'.length);
      // A browser is `open` on a Mac and `xdg-open` elsewhere.
      launched[name === 'open' || name === 'xdg-open' ? 'browser' : name] = recorded(readFileSync(join(bin, file), 'utf8')).split('\n').slice(0, -1);
    }
    let stdout = out;
    if (scenario.args[0] === 'doctor') ({ stdout, exit } = withoutDisks(stdout, exit));
    return {
      stdout: recorded(stdout),
      stderr: recorded(err),
      exit,
      requests: seen.map((r) => ({ ...r, url: recorded(r.url), body: typeof r.body === 'string' ? recorded(r.body) : r.body })),
      launched,
    };
  } catch (error) {
    throw new Error(`${scenario.name}: ${(error as Error).message}\nstderr: ${err}\nstdout: ${out}`);
  } finally {
    child.kill('SIGKILL');
    api.closeAllConnections();
    api.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
