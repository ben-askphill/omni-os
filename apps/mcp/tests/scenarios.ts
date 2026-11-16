// Runs one recorded scenario against a stdio MCP server: a scripted stand-in for Omni's API on a local port, the
// server as a child process, the scenario's lines on its stdin, and what came back. The scenarios and what they
// expect live in packages/test-fixtures/native/mcp, where crates/omni-mcp/tests/goldens.rs runs the same files
// against the Rust servers, so both implementations are held to one record.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/** One scripted answer of the stand-in API. The n-th request gets the n-th entry. */
export interface ApiEntry {
  status?: number;
  /** The body as JSON. */
  json?: unknown;
  /** The body as given, for an answer that is not JSON. */
  text?: string;
  /** Never answer. The request stays open until the server under test gives up or exits. */
  hang?: boolean;
  /** Close the connection without answering. */
  drop?: boolean;
  /** Answer this long after the request arrived. */
  delayMs?: number;
}

export type Step =
  | { send: unknown }
  | { raw: string }
  | { waitRequests: number }
  | { waitResponse: string | number }
  | { writeTokenFile: string }
  | { sleepMs: number };

export interface SeenRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Parsed JSON, the raw text when it is not JSON, or null for no body. */
  body: unknown;
  /** A request left hanging: whether the server under test closed it before the scenario ended. */
  closedByClient?: boolean;
}

export interface Expected {
  /** JSON-RPC messages the server wrote, sorted by id. */
  responses: unknown[];
  requests: SeenRequest[];
  exit: number | null;
}

export interface Scenario {
  name: string;
  /** Which server: ask, render or threads. */
  server: string;
  env?: Record<string, string>;
  /** Written to a file that OMNI_TOKEN_FILE names. */
  tokenFile?: string;
  api?: ApiEntry[];
  steps: Step[];
  /** Ids of requests that get no answer (cancelled ones). */
  silent?: (string | number)[];
  /** How long to keep listening after the last expected answer, to see that nothing else comes. */
  settleMs?: number;
  expected?: Expected;
}

/** The headers both implementations must send the same. The rest (user-agent, accept) belong to the HTTP client. */
const HEADERS = ['authorization', 'content-type', 'x-omni-thread'];

const TIMEOUT_MS = 15_000;

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

async function until(what: string, done: () => boolean): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

const idKey = (id: unknown) => JSON.stringify(id);

/** By id as JSON text, compared unit by unit, so the Rust runner sorts the same without a locale. */
function byId(a: { id?: unknown }, b: { id?: unknown }): number {
  const x = idKey(a.id) ?? '';
  const y = idKey(b.id) ?? '';
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Runs `command` as the scenario's server and answers what it did. */
export async function runScenario(scenario: Scenario, command: { bin: string; args: string[] }): Promise<Expected> {
  const dir = mkdtempSync(join(tmpdir(), 'omni-mcp-scenario-'));
  const tokenFile = join(dir, 'api-token');
  if (scenario.tokenFile !== undefined) writeFileSync(tokenFile, scenario.tokenFile);

  const seen: SeenRequest[] = [];
  const script = [...(scenario.api ?? [])];
  const api = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const text = await readBody(req);
      const entry = script.shift() ?? { status: 500, json: { error: 'The scenario scripted no answer for this request.' } };
      const request: SeenRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: Object.fromEntries(HEADERS.flatMap((h) => (typeof req.headers[h] === 'string' ? [[h, req.headers[h]]] : []))),
        body: parseBody(text),
      };
      seen.push(request);
      if (entry.hang) {
        request.closedByClient = false;
        res.on('close', () => {
          request.closedByClient = true;
        });
        return;
      }
      if (entry.drop) {
        req.socket.destroy();
        return;
      }
      if (entry.delayMs) await sleep(entry.delayMs);
      const body = entry.text ?? JSON.stringify(entry.json ?? {});
      res.writeHead(entry.status ?? 200, { 'content-type': entry.text === undefined ? 'application/json' : 'text/plain', connection: 'close' });
      res.end(body);
    })();
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const port = (api.address() as AddressInfo).port;

  const child = spawn(command.bin, command.args, {
    // Nothing of the machine's own Omni reaches the server under test.
    env: {
      PATH: process.env.PATH,
      HOME: dir,
      OMNI_URL: `http://127.0.0.1:${port}`,
      ...(scenario.tokenFile !== undefined && { OMNI_TOKEN_FILE: tokenFile }),
      ...scenario.env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const responses: { id?: unknown }[] = [];
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8');
    for (;;) {
      const at = out.indexOf('\n');
      if (at < 0) break;
      const line = out.slice(0, at);
      out = out.slice(at + 1);
      if (line.trim()) responses.push(JSON.parse(line) as { id?: unknown });
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    err += chunk.toString('utf8');
  });
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));

  try {
    const wanted: string[] = [];
    const silent = new Set((scenario.silent ?? []).map(idKey));
    const answered = (id: unknown) => responses.some((r) => idKey(r.id) === idKey(id));
    for (const step of scenario.steps) {
      if ('send' in step) {
        const message = step.send as { id?: unknown; method?: unknown } | null;
        if (message && typeof message === 'object' && 'id' in message && typeof message.method === 'string' && !silent.has(idKey(message.id))) wanted.push(idKey(message.id));
        child.stdin.write(`${JSON.stringify(step.send)}\n`);
      } else if ('raw' in step) child.stdin.write(`${step.raw}\n`);
      else if ('waitRequests' in step) await until(`${step.waitRequests} API requests`, () => seen.length >= step.waitRequests);
      else if ('waitResponse' in step) await until(`the answer to ${step.waitResponse}`, () => answered(step.waitResponse));
      else if ('writeTokenFile' in step) writeFileSync(tokenFile, step.writeTokenFile);
      else await sleep(step.sleepMs);
    }
    await until(`answers to ${wanted.join(', ')}`, () => wanted.every((id) => responses.some((r) => idKey(r.id) === id)));
    if (scenario.settleMs) await sleep(scenario.settleMs);
    // Read before stdin closes: after it, the server exits and every open request closes with it.
    const requests = seen.map((r) => ({ ...r }));
    child.stdin.end();
    const exit = await Promise.race([exited, sleep(TIMEOUT_MS).then(() => 'timeout' as const)]);
    if (exit === 'timeout') throw new Error('the server did not exit when its stdin closed');
    return { responses: [...responses].sort(byId), requests, exit };
  } catch (error) {
    throw new Error(`${scenario.name}: ${(error as Error).message}\nstderr: ${err}\nstdout so far: ${JSON.stringify(responses)}`);
  } finally {
    child.kill('SIGKILL');
    api.closeAllConnections();
    api.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
