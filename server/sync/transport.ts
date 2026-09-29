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
}

const BUCKET = 'omni';
/** First wait before trying Realtime again after a failed sign-in. */
const REALTIME_RETRY_MS = 5_000;

/**
 * The Supabase relay: the `changes` table (pushed through the omni_push function so one user's rows commit in
 * seq order), Realtime for the nudge, and the `omni` bucket under "<user id>/". Signs in lazily on first use,
 * so a boot while offline still starts, and the worker's backoff retries. No service-role key, ever.
 */
export function createSupabaseTransport(opts: SupabaseTransportOptions): SyncTransport {
  let client: SupabaseClient | null = null;
  let userId: string | null = null;
  let refreshToken = opts.refreshToken;
  let signingIn: Promise<void> | null = null;

  async function session(): Promise<SupabaseClient> {
    if (client && userId) return client;
    signingIn ??= (async () => {
      const { createClient } = await import('@supabase/supabase-js');
      const c = createClient(opts.url, opts.anonKey, {
        auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
      });
      c.auth.onAuthStateChange((_event, s) => {
        if (s?.refresh_token && s.refresh_token !== refreshToken) {
          refreshToken = s.refresh_token;
          Promise.resolve(opts.onRefreshToken(refreshToken)).catch((err) =>
            console.error('[sync] could not store the new refresh token:', (err as Error).message),
          );
        }
      });
      const { data, error } = await c.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.user) throw new Error(`sign-in failed: ${error?.message ?? 'no user'}`);
      client = c;
      userId = data.user.id;
    })().finally(() => (signingIn = null));
    await signingIn;
    return client!;
  }

  const objectPath = (path: string) => `${userId}/${path.replace(/^\/+/, '')}`;

  return {
    async push(changes) {
      const c = await session();
      const { error } = await c.rpc('omni_push', { changes });
      if (error) throw new Error(`push failed: ${error.message}`);
    },

    async pull({ after, excludeMachine, limit }) {
      const c = await session();
      const { data, error } = await c
        .from('changes')
        .select('seq, machine_id, entity, entity_id, op, data, ts')
        .gt('seq', after)
        .neq('machine_id', excludeMachine)
        .order('seq', { ascending: true })
        .limit(limit);
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
      const c = await session();
      const { error } = await c.storage.from(BUCKET).upload(objectPath(path), body, { upsert: true, contentType });
      if (error) throw new Error(`upload failed: ${error.message}`);
    },

    async getObject(path) {
      const c = await session();
      const { data, error } = await c.storage.from(BUCKET).download(objectPath(path));
      if (error) {
        if (/not.?found|404/i.test(error.message) || (error as { status?: number }).status === 404) return null;
        throw new Error(`download failed: ${error.message}`);
      }
      return new Uint8Array(await data.arrayBuffer());
    },

    async hasObject(path) {
      const c = await session();
      const full = objectPath(path);
      const dir = full.slice(0, full.lastIndexOf('/'));
      const name = full.slice(full.lastIndexOf('/') + 1);
      const { data, error } = await c.storage.from(BUCKET).list(dir, { search: name, limit: 100 });
      if (error) throw new Error(`list failed: ${error.message}`);
      return (data ?? []).some((o) => o.name === name);
    },
  };
}
