import type { SupabaseClient } from '@supabase/supabase-js';
import type { SyncEntity, SyncOp } from '../db.ts';

// The relay between Macs. The worker only talks to this interface: the Supabase one in production,
// MemoryTransport in tests, so no test reaches the network. See supabase/migrations/0001_changes.sql.

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
}

/** Normalize a timestamp from anywhere (Postgres gives "+00:00" and microseconds) to the local ISO form. */
export const isoTs = (ts: string) => new Date(ts).toISOString();

// ---------- in memory ----------

/** A relay in memory, for tests. Machines sharing one instance see each other's pushes. */
export class MemoryTransport implements SyncTransport {
  readonly changes: RemoteChange[] = [];
  readonly objects = new Map<string, Uint8Array>();
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

  /** Nudge every subscriber, as Realtime does when its link comes back after a drop. */
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

// ---------- Supabase ----------

export interface SupabaseTransportOptions {
  url: string;
  anonKey: string;
  /** Ben's refresh token. Supabase rotates it on every refresh, so onRefreshToken must store the new one. */
  refreshToken: string;
  onRefreshToken: (token: string) => void | Promise<void>;
  /** Stands in for @supabase/supabase-js's createClient in tests. */
  createClient?: (url: string, key: string, options: object) => SupabaseClient;
}

const BUCKET = 'omni';
/** First wait before trying Realtime again after a failed sign-in. */
const REALTIME_RETRY_MS = 5_000;

/** The relay no longer takes this machine's refresh token: revoked, used twice, or its user is gone. A new sign-in fixes it. */
export class SyncSignedOutError extends Error {
  readonly code = 'signed_out';
  constructor(detail: string) {
    super(`signed out of the relay (${detail}): sign in again in Settings, Sync`);
  }
}

export const isSignedOut = (err: unknown) => (err as { code?: unknown } | null)?.code === 'signed_out';

type AuthFailure = { name?: string; message: string; status?: number; code?: string };
const SIGNED_OUT_CODES = new Set([
  'refresh_token_not_found', 'refresh_token_already_used', 'session_not_found', 'session_expired', 'user_not_found', 'user_banned', 'bad_jwt',
]);

/** A refresh refused for good, not a network blip or a server error the backoff should ride out. */
function refreshRefused(e: AuthFailure) {
  if (e.name === 'AuthRetryableFetchError') return false;
  if (e.code && SIGNED_OUT_CODES.has(e.code)) return true;
  return !!e.status && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
}

/** An access token PostgREST or Storage would not take. A new one from the refresh token fixes it. */
function tokenRejected(e: { message?: string; code?: string } | null | undefined) {
  if (!e) return false;
  if (e.code === 'PGRST301' || e.code === 'PGRST303') return true;
  return /jwt expired|invalid jwt|token is expired/i.test(e.message ?? '');
}

/**
 * The Supabase relay: the `changes` table (pushed through the omni_push function so one user's rows commit in
 * seq order), Realtime for the nudge, and the `omni` bucket under "<user id>/". Signs in lazily on first use,
 * so a boot while offline still starts, and the worker's backoff retries. No service-role key, ever.
 *
 * Tokens: every refresh rotates the refresh token, and the new one goes to onRefreshToken, whether the refresh
 * was the sign-in or supabase-js's own timer. A request refused for an expired access token signs in again
 * from the newest refresh token and runs once more. A refresh token the relay refuses throws SyncSignedOutError,
 * so the status asks for a new sign-in instead of the worker retrying a dead token.
 */
export function createSupabaseTransport(opts: SupabaseTransportOptions): SyncTransport {
  let client: SupabaseClient | null = null;
  let userId: string | null = null;
  let refreshToken = opts.refreshToken;
  let signingIn: Promise<void> | null = null;
  /** Stores one at a time, in rotation order: a slow store finishing last would leave a used token in the Keychain. */
  let storing: Promise<void> = Promise.resolve();

  function keep(token: string | undefined) {
    if (!token || token === refreshToken) return;
    refreshToken = token;
    storing = storing
      .then(() => opts.onRefreshToken(token))
      .catch((err) => console.error('[sync] could not store the new refresh token:', (err as Error).message));
  }

  const quiet = (c: SupabaseClient) => void Promise.resolve(c.auth.stopAutoRefresh?.()).catch(() => {});

  /** Forget the session, so the next call signs in again from the newest refresh token. */
  function reset(c: SupabaseClient) {
    if (c !== client) return;
    client = null;
    userId = null;
    quiet(c);
  }

  async function session(): Promise<SupabaseClient> {
    if (client && userId) return client;
    signingIn ??= (async () => {
      const create = opts.createClient ?? (await import('@supabase/supabase-js')).createClient;
      const c = create(opts.url, opts.anonKey, {
        auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
      });
      c.auth.onAuthStateChange((event, s) => {
        keep(s?.refresh_token);
        // supabase-js gave up refreshing on its own: start over on the next call, which then says why.
        if (event === 'SIGNED_OUT') reset(c);
      });
      const { data, error } = await c.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.user) {
        quiet(c);
        if (error && refreshRefused(error)) throw new SyncSignedOutError(error.message);
        throw new Error(`sign-in failed: ${error?.message ?? 'no user'}`);
      }
      keep(data.session?.refresh_token);
      client = c;
      userId = data.user.id;
    })().finally(() => (signingIn = null));
    await signingIn;
    return client!;
  }

  /** Run a request, and once more with a new session when the relay refused the access token. */
  async function call<R extends { error: { message?: string; code?: string } | null }>(run: (c: SupabaseClient) => PromiseLike<R>): Promise<R> {
    const c = await session();
    const res = await run(c);
    if (!tokenRejected(res.error)) return res;
    reset(c);
    return run(await session());
  }

  const objectPath = (path: string) => `${userId}/${path.replace(/^\/+/, '')}`;

  return {
    async push(changes) {
      const { error } = await call((c) => c.rpc('omni_push', { changes }));
      if (error) throw new Error(`push failed: ${error.message}`);
    },

    async pull({ after, excludeMachine, limit }) {
      const { data, error } = await call((c) =>
        c
          .from('changes')
          .select('seq, machine_id, entity, entity_id, op, data, ts')
          .gt('seq', after)
          .neq('machine_id', excludeMachine)
          .order('seq', { ascending: true })
          .limit(limit),
      );
      if (error) throw new Error(`pull failed: ${error.message}`);
      return (data ?? []).map((r) => ({ ...r, seq: Number(r.seq), ts: isoTs(r.ts) })) as RemoteChange[];
    },

    subscribe(excludeMachine, onRemote) {
      let off = () => {};
      let closed = false;
      let retry: NodeJS.Timeout | undefined;
      let wait = REALTIME_RETRY_MS;
      // Offline at boot, sign-in fails: try again, doubling up to 5 min, so Realtime comes up with the network.
      const open = () =>
        session()
          .then((c) => {
            if (closed) return;
            const channel = c
              .channel(`omni-changes-${excludeMachine}`)
              .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'changes', filter: `machine_id=neq.${excludeMachine}` },
                (p) => {
                  if ((p.new as { machine_id?: string }).machine_id !== excludeMachine) onRemote();
                },
              )
              // Joined, at first and again each time the client rejoins after a drop. Pushes made while the link
              // was down sent no event, so a join is a reason to sync too.
              .subscribe((status) => {
                if (status === 'SUBSCRIBED') onRemote();
              });
            off = () => void c.removeChannel(channel);
          })
          .catch((err) => {
            if (closed) return;
            console.error(`[sync] realtime unavailable, retrying in ${Math.round(wait / 1000)}s:`, (err as Error).message);
            retry = setTimeout(open, wait);
            retry.unref();
            wait = Math.min(wait * 2, 5 * 60_000);
          });
      void open();
      return () => {
        closed = true;
        clearTimeout(retry);
        off();
      };
    },

    async putObject(path, body, contentType = 'application/octet-stream') {
      const { error } = await call((c) => c.storage.from(BUCKET).upload(objectPath(path), body, { upsert: true, contentType }));
      if (error) throw new Error(`upload failed: ${error.message}`);
    },

    async getObject(path) {
      const { data, error } = await call((c) => c.storage.from(BUCKET).download(objectPath(path)));
      if (error) {
        if (/not.?found|404/i.test(error.message) || (error as { status?: number }).status === 404) return null;
        throw new Error(`download failed: ${error.message}`);
      }
      return new Uint8Array(await data.arrayBuffer());
    },

    async hasObject(path) {
      const name = path.slice(path.lastIndexOf('/') + 1);
      const { data, error } = await call((c) => {
        const full = objectPath(path);
        return c.storage.from(BUCKET).list(full.slice(0, full.lastIndexOf('/')), { search: name, limit: 100 });
      });
      if (error) throw new Error(`list failed: ${error.message}`);
      return (data ?? []).some((o) => o.name === name);
    },
  };
}
