import type { SyncEntity, SyncOp } from '../db.ts';

// The relay between Macs. The worker only talks to this interface: the Cloudflare one (apps/relay) in production,
// MemoryTransport in tests, so no test reaches the network.

/** One row of the relay's append-only `changes` log. */
export interface Change {
  machine_id: string;
  entity: SyncEntity;
  /** Thread and channel id, kv key, or the uid of an event, artifact or automation run. */
  entity_id: string;
  op: SyncOp;
  /** What the entity's handler serialized. Null for a delete. */
  data: unknown;
  /** When the write happened, ISO-8601 UTC with milliseconds ("…Z"). The last-writer-wins clock. */
  ts: string;
}

/** A change as the relay hands it back, numbered in commit order. */
export interface RemoteChange extends Change {
  seq: number;
}

export interface PullOptions {
  /** Only changes with a higher seq. */
  after: number;
  /** Leave out this machine's own changes. */
  excludeMachine: string;
  limit: number;
}

export interface SyncTransport {
  /** Append changes in order. Throws when the relay did not take them, so the outbox keeps them. */
  push(changes: Change[]): Promise<void>;
  /** Changes after a seq from other machines, oldest first. */
  pull(opts: PullOptions): Promise<RemoteChange[]>;
  /** Call onRemote when another machine pushes. Returns an unsubscribe. Optional: the timer still syncs without it. */
  subscribe?(excludeMachine: string, onRemote: () => void): () => void;
  /** File storage, by path inside this user's area: "blobs/<sha256>", "manifests/<thread>.json", "sessions/<harness>/<id>.jsonl". */
  putObject(path: string, body: Uint8Array, contentType?: string): Promise<void>;
  /** The object's bytes, or null when there is none. */
  getObject(path: string): Promise<Uint8Array | null>;
  hasObject(path: string): Promise<boolean>;
  /** The object's bytes and its version tag, or null when there is none. Optional: an older relay has no versions. */
  getObjectVersion?(path: string): Promise<{ body: Uint8Array; etag: string | null } | null>;
  /**
   * Write the object only while it is still the version `ifMatch` names, or, with null, only while there is none.
   * False when another write came first (HTTP 412). A relay that predates conditional writes writes it anyway.
   */
  putObjectIf?(path: string, body: Uint8Array, ifMatch: string | null, contentType?: string): Promise<boolean>;
}

/** Normalize a timestamp from anywhere ("+00:00", no milliseconds) to the local ISO form. */
export const isoTs = (ts: string) => new Date(ts).toISOString();

// ---------- in memory ----------

/** A relay in memory, for tests. Machines sharing one instance see each other's pushes. */
export class MemoryTransport implements SyncTransport {
  readonly changes: RemoteChange[] = [];
  readonly objects = new Map<string, Uint8Array>();
  private versions = new Map<string, number>();
  private version = 0;
  /** Runs once, just before the next conditional write checks its version: tests slip another Mac's write in there. */
  beforeConditionalPut: (() => Promise<void> | void) | null = null;
  /** Each push's changes, so tests can check batching. */
  readonly pushCalls: Change[][] = [];
  pullCalls = 0;
  private seq = 0;
  private failures: { left: number; message: string } = { left: 0, message: '' };
  private listeners = new Set<{ exclude: string; fn: () => void }>();

  /** Live subscriptions, so tests can check the worker lets go of them. */
  get subscribers() {
    return this.listeners.size;
  }

  /** Nudge every subscriber, as the relay's WebSocket does when its link comes back after a drop. */
  reconnect() {
    for (const l of this.listeners) queueMicrotask(l.fn);
  }

  /** Make the next n calls throw, as an unreachable relay would. */
  failNext(n: number, message = 'relay unavailable') {
    this.failures = { left: n, message };
  }

  private check() {
    if (this.failures.left > 0) {
      this.failures.left--;
      throw new Error(this.failures.message);
    }
  }

  async push(changes: Change[]) {
    this.check();
    this.pushCalls.push(changes);
    const machines = new Set<string>();
    for (const c of changes) {
      this.changes.push(structuredClone({ ...c, seq: ++this.seq }));
      machines.add(c.machine_id);
    }
    for (const l of this.listeners) if ([...machines].some((m) => m !== l.exclude)) queueMicrotask(l.fn);
  }

  async pull({ after, excludeMachine, limit }: PullOptions) {
    this.check();
    this.pullCalls++;
    return structuredClone(this.changes.filter((c) => c.seq > after && c.machine_id !== excludeMachine).slice(0, limit));
  }

  subscribe(excludeMachine: string, onRemote: () => void) {
    const l = { exclude: excludeMachine, fn: onRemote };
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  async putObject(path: string, body: Uint8Array) {
    this.check();
    this.objects.set(path, new Uint8Array(body));
    this.versions.set(path, ++this.version);
  }

  async getObjectVersion(path: string) {
    const body = await this.getObject(path);
    return body ? { body, etag: `v${this.versions.get(path)}` } : null;
  }

  async putObjectIf(path: string, body: Uint8Array, ifMatch: string | null) {
    this.check();
    const hook = this.beforeConditionalPut;
    this.beforeConditionalPut = null;
    await hook?.();
    const current = this.objects.has(path) ? `v${this.versions.get(path)}` : null;
    if (current !== ifMatch) return false;
    await this.putObject(path, body);
    return true;
  }

  async getObject(path: string) {
    this.check();
    const o = this.objects.get(path);
    return o ? new Uint8Array(o) : null;
  }

  async hasObject(path: string) {
    this.check();
    return this.objects.has(path);
  }
}

// ---------- Cloudflare ----------

export interface RelayTransportOptions {
  /** The Worker's address, like https://omni-relay.ben.workers.dev. */
  url: string;
  /** This machine's relay token, from the sign-in (setup.ts). */
  token: string;
  /** Stand-ins for tests. */
  fetch?: typeof fetch;
  WebSocket?: typeof WebSocket;
}

/** First wait before opening the WebSocket again after it dropped or failed. */
const SOCKET_RETRY_MS = 5_000;
/** How often the WebSocket pings, and how long it may stay silent before it counts as dead and opens again. */
const PING_MS = 30_000;
const SILENT_MS = 75_000;

/** The relay no longer takes this machine's token: signed out on the relay, or its user taken off. A new sign-in fixes it. */
export class SyncSignedOutError extends Error {
  readonly code = 'signed_out';
  constructor(detail: string) {
    super(`signed out of the relay (${detail}): sign in again in Settings, Sync`);
  }
}

export const isSignedOut = (err: unknown) => (err as { code?: unknown } | null)?.code === 'signed_out';

/** "blobs/<sha>" as a URL path, each part escaped. */
const objectUrl = (path: string) => `/v1/objects/${path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`;

/**
 * The Cloudflare relay (apps/relay): the change log, a WebSocket that says when another machine pushed, and files,
 * all under this machine's relay token. A 401 is SyncSignedOutError, so the status asks for a new sign-in instead
 * of the worker retrying a dead token.
 */
export function createRelayTransport(opts: RelayTransportOptions): SyncTransport {
  const base = opts.url.replace(/\/+$/, '');
  const fetchImpl = opts.fetch ?? fetch;
  const Socket = opts.WebSocket ?? WebSocket;

  async function call(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
    const { timeoutMs = 60_000, ...rest } = init;
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        ...rest,
        headers: { authorization: `Bearer ${opts.token}`, ...(rest.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new Error(`relay unreachable (${(err as Error).message})`);
    }
    if (res.status === 401) throw new SyncSignedOutError(await reason(res));
    return res;
  }

  async function reason(res: Response) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? `HTTP ${res.status}`;
  }

  async function ok(res: Response, what: string) {
    if (!res.ok) throw new Error(`${what} failed: ${await reason(res)}`);
    return res;
  }

  return {
    async push(changes) {
      await ok(await call('/v1/changes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ changes }) }), 'push');
    },

    async pull({ after, excludeMachine, limit }) {
      const q = new URLSearchParams({ after: String(after), exclude: excludeMachine, limit: String(limit) });
      const res = await ok(await call(`/v1/changes?${q}`), 'pull');
      const { changes } = (await res.json()) as { changes: RemoteChange[] };
      return changes.map((c) => ({ ...c, seq: Number(c.seq), ts: isoTs(c.ts) }));
    },

    subscribe(excludeMachine, onRemote) {
      let closed = false;
      let ws: WebSocket | null = null;
      let retry: NodeJS.Timeout | undefined;
      let ping: NodeJS.Timeout | undefined;
      let wait = SOCKET_RETRY_MS;
      let heardAt = 0;
      const url = `${base.replace(/^http/, 'ws')}/v1/subscribe?${new URLSearchParams({ exclude: excludeMachine })}`;

      const again = () => {
        clearInterval(ping);
        if (closed || retry) return;
        retry = setTimeout(() => ((retry = undefined), open()), wait);
        retry.unref?.();
        wait = Math.min(wait * 2, 5 * 60_000);
      };

      function open() {
        if (closed) return;
        let socket: WebSocket;
        try {
          // A WebSocket cannot carry an Authorization header: the token rides as a protocol, which the relay strips.
          socket = new Socket(url, ['omni-relay', `bearer.${opts.token}`]);
        } catch (err) {
          console.error('[sync] relay socket unavailable:', (err as Error).message);
          return again();
        }
        ws = socket;
        socket.onopen = () => {
          wait = SOCKET_RETRY_MS;
          heardAt = Date.now();
          // Pushes made while the link was down sent nothing, so a connect is a reason to sync too.
          onRemote();
          ping = setInterval(() => {
            if (Date.now() - heardAt > SILENT_MS) return socket.close();
            try {
              socket.send('ping');
            } catch {
              socket.close();
            }
          }, PING_MS);
          ping.unref?.();
        };
        socket.onmessage = (e) => {
          heardAt = Date.now();
          if (e.data === 'changes') onRemote();
        };
        socket.onclose = () => {
          if (ws === socket) ws = null;
          again();
        };
        socket.onerror = () => {
          // onclose follows and opens again.
        };
      }

      open();
      return () => {
        closed = true;
        clearTimeout(retry);
        clearInterval(ping);
        ws?.close();
        ws = null;
      };
    },

    async putObject(path, body, contentType = 'application/octet-stream') {
      await ok(await call(objectUrl(path), { method: 'PUT', headers: { 'content-type': contentType }, body: body as BodyInit, timeoutMs: 10 * 60_000 }), 'upload');
    },

    async getObject(path) {
      const res = await call(objectUrl(path), { timeoutMs: 10 * 60_000 });
      if (res.status === 404) return null;
      await ok(res, 'download');
      return new Uint8Array(await res.arrayBuffer());
    },

    async hasObject(path) {
      const res = await call(objectUrl(path), { method: 'HEAD' });
      if (res.status === 404) return false;
      await ok(res, 'check');
      return true;
    },

    async getObjectVersion(path) {
      const res = await call(objectUrl(path), { timeoutMs: 10 * 60_000 });
      if (res.status === 404) return null;
      await ok(res, 'download');
      return { body: new Uint8Array(await res.arrayBuffer()), etag: res.headers.get('etag') };
    },

    async putObjectIf(path, body, ifMatch, contentType = 'application/octet-stream') {
      const cond: Record<string, string> = ifMatch === null ? { 'if-none-match': '*' } : { 'if-match': ifMatch };
      const res = await call(objectUrl(path), { method: 'PUT', headers: { 'content-type': contentType, ...cond }, body: body as BodyInit, timeoutMs: 10 * 60_000 });
      if (res.status === 412) return false;
      await ok(res, 'upload');
      return true;
    },
  };
}

// ---------- signing in ----------

/** What GET /v1/info says: which Clerk app the relay trusts. */
export interface RelayInfo {
  issuer: string | null;
  clientId: string | null;
}

/** The relay's sign-in and sign-out calls, as setup.ts uses them. Tests pass a fake. */
export interface RelayAuth {
  /** Throws when the URL is not an Omni relay. */
  info(url: string): Promise<RelayInfo>;
  /** Trade a fresh Clerk ID token for this machine's relay token. Throws RelayRefusedError when the relay says no. */
  exchange(url: string, idToken: string, machine: string): Promise<{ token: string; user: { id: string; email: string | null } }>;
  /** End this machine's token on the relay. */
  revoke(url: string, token: string): Promise<void>;
}

/** The relay answered, and refused: an account not on its ALLOWED_USERS, or a token it would not take. */
export class RelayRefusedError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function relayAuth(fetchImpl: typeof fetch = fetch): RelayAuth {
  async function req(url: string, path: string, init: RequestInit = {}) {
    try {
      return await fetchImpl(`${url.replace(/\/+$/, '')}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      throw new Error(`Cannot reach the relay at ${url} (${(err as Error).message})`);
    }
  }
  return {
    async info(url) {
      const res = await req(url, '/v1/info');
      const body = (await res.json().catch(() => null)) as { service?: string; issuer?: string | null; clientId?: string | null } | null;
      if (!res.ok || body?.service !== 'omni-relay') throw new RelayRefusedError(`${url} is not an Omni relay. Deploy apps/relay and paste its URL`, 400);
      return { issuer: body.issuer ?? null, clientId: body.clientId ?? null };
    },
    async exchange(url, idToken, machine) {
      const res = await req(url, '/v1/auth/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken, machine }) });
      const body = (await res.json().catch(() => null)) as { token?: string; user?: { id: string; email: string | null }; error?: string } | null;
      if (!res.ok || !body?.token || !body.user) throw new RelayRefusedError(body?.error ?? `The relay answered HTTP ${res.status}`, res.status);
      return { token: body.token, user: body.user };
    },
    async revoke(url, token) {
      const res = await req(url, '/v1/auth/token', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
      // Already signed out there is as good as done.
      if (!res.ok && res.status !== 401) throw new Error(`The relay answered HTTP ${res.status}`);
    },
  };
}
