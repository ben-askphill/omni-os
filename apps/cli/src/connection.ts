// Which Omni the CLI talks to and with what token, from the environment alone.
//
// Inside an Omni thread the server sets OMNI_URL, OMNI_TOKEN or OMNI_TOKEN_FILE, OMNI_DATA_DIR and OMNI_THREAD_ID, as
// it does for its MCP servers. In a terminal the shim the desktop app writes (apps/desktop/src/cli-shim.ts) sets the
// install's facts instead: OMNI_APP (the app it runs on), OMNI_INSTALL_DATA_DIR, OMNI_INSTALL_LOG and
// OMNI_INSTALL_PORT. scripts/omni.sh sets OMNI_INSTALL_DATA_DIR to a checkout's data/. Nothing here guesses a path.
import { createHttpClient, createOmniApi, OmniHttpError, parseBaseUrl, type BaseUrl, type OmniApi } from '@omni/client-core';
import { join } from 'node:path';
import { CliError, type Io } from './io.ts';
import { PROBE_MS, probe } from './proof.ts';

export const DEFAULT_PORT = 4747;

export type TokenSource = { kind: 'env'; name: 'OMNI_TOKEN' } | { kind: 'file'; path: string; from: string } | { kind: 'none' };

export interface Connection {
  baseUrl: BaseUrl;
  /** The port on this machine, when the server is local. */
  port: number;
  /** OMNI_URL set the address, so it may be another machine. */
  remote: boolean;
  /**
   * The address is the install's port on this machine, not OMNI_URL: whatever holds that port proves it is this
   * install's Omni (GET /api/auth/proof) before it gets the token.
   */
  proveFirst: boolean;
  tokenSource: TokenSource;
  /** Read again on every request, so a rotated token file is picked up. */
  token(): string | null;
  dataDir: string | null;
  /** The thread an agent runs this in. */
  thread: string | null;
  /** The desktop app the shim runs on (the AppImage on Linux), when the shim ran it. */
  app: string | null;
  logFile: string | null;
}

const set = (v: string | undefined) => (v?.trim() ? v.trim() : null);

function portOf(text: string | null): number | null {
  if (!text) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

export function connection(io: Pick<Io, 'env' | 'readFile'>): Connection {
  const env = io.env;
  const port = portOf(set(env.OMNI_INSTALL_PORT)) ?? portOf(set(env.OMNI_PORT)) ?? DEFAULT_PORT;
  const url = set(env.OMNI_URL);
  const parsed = url ? parseBaseUrl(url) : null;
  if (url && !parsed) throw new CliError(`OMNI_URL is not an http(s) address: ${url}`);
  const baseUrl = parsed ?? (`http://127.0.0.1:${port}` as BaseUrl);
  const dataDir = set(env.OMNI_DATA_DIR) ?? set(env.OMNI_INSTALL_DATA_DIR);

  let tokenSource: TokenSource = { kind: 'none' };
  const envToken = set(env.OMNI_TOKEN);
  const tokenFile = set(env.OMNI_TOKEN_FILE);
  if (envToken) tokenSource = { kind: 'env', name: 'OMNI_TOKEN' };
  else if (tokenFile) tokenSource = { kind: 'file', path: tokenFile, from: 'OMNI_TOKEN_FILE' };
  else if (dataDir) tokenSource = { kind: 'file', path: join(dataDir, 'api-token'), from: set(env.OMNI_DATA_DIR) ? 'OMNI_DATA_DIR' : 'the install' };

  const source = tokenSource;
  const token = () => {
    if (source.kind === 'env') return envToken;
    if (source.kind === 'file') return set(io.readFile(source.path) ?? undefined);
    return null;
  };

  return {
    baseUrl,
    port: parsed ? (portOf(new URL(parsed).port) ?? (parsed.startsWith('https') ? 443 : 80)) : port,
    remote: !!parsed && !isLoopback(parsed),
    proveFirst: !parsed,
    tokenSource,
    token,
    dataDir,
    thread: set(env.OMNI_THREAD_ID),
    app: set(env.OMNI_APP),
    logFile: set(env.OMNI_INSTALL_LOG),
  };
}

export function isLoopback(url: string): boolean {
  const host = new URL(url).hostname;
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
}

/** Where the token comes from, in words, for errors and doctor. */
export function describeSource(source: TokenSource): string {
  if (source.kind === 'env') return 'OMNI_TOKEN';
  if (source.kind === 'file') return `${source.path} (${source.from})`;
  return 'nowhere: set OMNI_TOKEN, OMNI_TOKEN_FILE or OMNI_DATA_DIR';
}

export interface Client {
  conn: Connection;
  api: OmniApi;
  /** A thread's page in the Web UI. */
  link(route: string): string;
  /**
   * Makes sure the server may have the token, as before a request: for output that carries the token without a
   * request first (`open --pair`). Throws as a refused request would.
   */
  prove(): Promise<void>;
  /** Drops a passed proof, so the next request proves the server again: before each poll of a `--wait`. */
  forget(): void;
}

/**
 * How long a passed proof covers further requests, on the monotonic clock: the requests one command makes together.
 * A `--wait` also drops the proof before each poll (wait.ts), so a server replaced between polls never gets the token.
 */
export const PROOF_FRESH_MS = 250;

/**
 * Another program, or another install's Omni, can hold the install's port while this one is not running. On that
 * address the token goes only to a server that proved it holds the same token: before a request, unless a proof
 * passed within PROOF_FRESH_MS and the connection has not dropped since. With no token there is nothing to prove
 * with, so nothing is sent at all. `proven` says a probe just passed.
 */
export function client(io: Io, conn: Connection = connection(io), o: { proven?: boolean } = {}): Client {
  let provenAt: number | null = o.proven ? io.clock() : null;
  const fresh = () => provenAt !== null && io.clock() - provenAt < PROOF_FRESH_MS;
  let proving: Promise<void> | null = null;
  async function check(): Promise<void> {
    const p = await probe(io, conn);
    if (p.kind === 'omni' && p.mine) {
      provenAt = io.clock();
      return;
    }
    // Nothing listens, or nothing answers yet: an unreachable server, which `--wait` waits through. Nothing is sent.
    if (p.kind === 'free') throw new OmniHttpError({ kind: 'unreachable', detail: 'connection refused' });
    if (p.kind === 'slow') throw new OmniHttpError({ kind: 'unreachable', detail: `no answer within ${PROBE_MS / 1000}s` });
    const who = p.kind === 'omni' ? "answers as Omni, but not as this install's" : `answers, but not as Omni (${p.detail})`;
    throw new CliError(`${conn.baseUrl} ${who}: another install or another program holds the port. The token was not sent. omni doctor says more.`);
  }
  async function prove(): Promise<void> {
    if (!conn.proveFirst) return;
    // Without the token the proof cannot be checked, and the server would refuse the request anyway: a prompt or a
    // message must not go out to whatever holds the port.
    if (!conn.token()) throw new CliError(`No API token for ${conn.baseUrl}: ${describeSource(conn.tokenSource)}. Nothing was sent. omni doctor checks it.`);
    if (fresh()) return;
    // Requests made together share one probe.
    proving ??= check().finally(() => {
      proving = null;
    });
    await proving;
  }
  // client-core reads the token before each request, outside its own error handling, so a refusal here stops the
  // request unsent.
  async function token(): Promise<string | null> {
    await prove();
    return conn.token();
  }
  const fetch: Io['fetch'] = async (url, init) => {
    try {
      return await io.fetch(url, init);
    } catch (err) {
      // The server went away: whatever answers next proves itself again.
      provenAt = null;
      throw err;
    }
  };
  const http = createHttpClient({ baseUrl: conn.baseUrl, token, fetch, timeoutMs: 30_000 });
  return {
    conn,
    api: createOmniApi(http),
    link: (route) => `${conn.baseUrl}/${route}`,
    prove,
    forget: () => void (provenAt = null),
  };
}
