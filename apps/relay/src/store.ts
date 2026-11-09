// One user's relay: the append-only change log and the machines' tokens, in the SQLite of that user's Durable
// Object. A Durable Object runs one request at a time, so seq order is commit order and a pull of "seq > cursor"
// never skips a row that committed late. Plain over an Sql interface, so the tests run it on node:sqlite.
// The log keeps every change for good. A Durable Object's SQLite has a hard size cap, so SQLite holds only the index
// and each push's change data goes to Blobs (R2) as one JSON array, the row pointing at "<key>#<index>".
import { RelayError, sha256 } from './auth.ts';

/** The part of a Durable Object's SqlStorage this uses. */
export interface Sql {
  exec(query: string, ...bindings: (string | number | null)[]): { toArray(): Record<string, unknown>[] };
}

type ChangeRow = { seq: number; machine_id: string; entity: string; entity_id: string; op: 'upsert' | 'delete'; data: string | null; blob: string | null; ts: string };

/** Where change data goes: R2 in the Worker, a Map in tests. */
export interface Blobs {
  put(key: string, body: string): Promise<void>;
  get(key: string): Promise<string | null>;
}

export interface Change {
  machine_id: string;
  entity: string;
  entity_id: string;
  op: 'upsert' | 'delete';
  data: unknown;
  ts: string;
}

export interface RemoteChange extends Change {
  seq: number;
}

/** Changes per push and per pull at most. */
export const MAX_BATCH = 1000;
/** Change data moved out of SQLite per batch object at most, so a batch fits in a Durable Object's memory. */
export const MOVE_MAX_BYTES = 20_000_000;
/** last_seen_at is written at most this often per token. */
const TOUCH_MS = 60_000;

const ENTITY = /^[a-z][a-z_]{0,39}$/;

/**
 * An object path Omni uses ("blobs/<sha>", "manifests/<thread>.json", "sessions/cursor/<chat>/<any file in it>"):
 * no control characters, no empty, "." or ".." parts, and short enough for an R2 key with the user's prefix.
 */
export function objectPath(rel: string): boolean {
  if (!rel || new TextEncoder().encode(rel).length > 900 || /[\u0000-\u001f\u007f]/.test(rel)) return false;
  return rel.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/**
 * Check one pushed change. The relay takes any entity name of the right shape, so a new kind of change needs no
 * relay update: a machine without a handler for it keeps it deferred until it has one.
 */
export function checkChange(v: unknown): Change {
  const c = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const str = (k: string, max: number) => {
    const s = c[k];
    if (typeof s !== 'string' || !s || s.length > max) throw new RelayError(400, `change.${k}: a string of 1 to ${max} characters`);
    return s;
  };
  const entity = str('entity', 40);
  if (!ENTITY.test(entity)) throw new RelayError(400, `change.entity: "${entity}" is not an entity name`);
  const op = c.op;
  if (op !== 'upsert' && op !== 'delete') throw new RelayError(400, 'change.op: upsert or delete');
  const ts = new Date(str('ts', 40));
  if (Number.isNaN(ts.getTime())) throw new RelayError(400, 'change.ts: an ISO-8601 time');
  return { machine_id: str('machine_id', 200), entity, entity_id: str('entity_id', 1000), op, data: c.data ?? null, ts: ts.toISOString() };
}

export class RelayStore {
  constructor(
    private readonly sql: Sql,
    private readonly blobs: Blobs,
    /** Runs fn as one SQLite transaction: storage.transactionSync in the Durable Object. */
    private readonly transaction: <T>(fn: () => T) => T,
    /** This user's id: the prefix of their R2 keys. */
    private readonly user: string,
    private readonly now: () => number = Date.now,
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS changes (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      op TEXT NOT NULL,
      data TEXT,
      blob TEXT,
      ts TEXT NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS tokens (
      id TEXT PRIMARY KEY,
      hash TEXT NOT NULL UNIQUE,
      machine TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )`);
  }

  // ---------- tokens ----------

  /** Keep a new machine's token (its hash only). */
  async addToken(token: string, machine: string): Promise<string> {
    const id = crypto.randomUUID();
    const at = new Date(this.now()).toISOString();
    this.sql.exec('INSERT INTO tokens (id, hash, machine, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)', id, await sha256(token), machine.slice(0, 100) || 'Machine', at, at);
    return id;
  }

  /** The token's id while it is live. Throws RelayError(401, signed_out) otherwise. */
  async checkToken(token: string): Promise<string> {
    const [row] = this.sql.exec('SELECT id, last_seen_at FROM tokens WHERE hash = ?', await sha256(token)).toArray() as { id: string; last_seen_at: string }[];
    if (!row) throw new RelayError(401, 'This machine is signed out of the relay', 'signed_out');
    const at = this.now();
    if (at - Date.parse(row.last_seen_at) > TOUCH_MS) this.sql.exec('UPDATE tokens SET last_seen_at = ? WHERE id = ?', new Date(at).toISOString(), row.id);
    return row.id;
  }

  revokeToken(id: string) {
    this.sql.exec('DELETE FROM tokens WHERE id = ?', id);
  }

  // ---------- changes ----------

  /** Append changes in order. Returns the machines that pushed, for the nudge. */
  async push(raw: unknown): Promise<Set<string>> {
    const list = (raw as { changes?: unknown } | null)?.changes;
    if (!Array.isArray(list) || list.length > MAX_BATCH) throw new RelayError(400, `Send {changes: [...]}, at most ${MAX_BATCH}`);
    const changes = list.map(checkChange);
    const data = changes.map((c) => (c.data === null ? null : JSON.stringify(c.data)));
    // Written before the transaction, which cannot wait on R2. A push that fails after this leaves an unread object.
    const blob = data.some((d) => d !== null) ? await this.putBatch(data.filter((d) => d !== null)) : null;
    let part = 0;
    this.transaction(() => {
      changes.forEach((c, i) => {
        const at = data[i] === null ? null : `${blob}#${part++}`;
        this.sql.exec('INSERT INTO changes (machine_id, entity, entity_id, op, data, blob, ts) VALUES (?, ?, ?, ?, NULL, ?, ?)', c.machine_id, c.entity, c.entity_id, c.op, at, c.ts);
      });
    });
    return new Set(changes.map((c) => c.machine_id));
  }

  /** Changes after a seq from other machines, oldest first. */
  async pull(after: number, excludeMachine: string, limit: number): Promise<RemoteChange[]> {
    const rows = this.sql
      .exec(
        'SELECT seq, machine_id, entity, entity_id, op, data, blob, ts FROM changes WHERE seq > ? AND machine_id != ? ORDER BY seq LIMIT ?',
        after,
        excludeMachine,
        Math.max(1, Math.min(MAX_BATCH, limit)),
      )
      .toArray() as ChangeRow[];
    // Rows from one push share a batch object: fetch each object once.
    const batches = new Map<string, Promise<string[]>>();
    const read = async (blob: string): Promise<string | null> => {
      const hash = blob.lastIndexOf('#');
      // A change from before batches: the whole object is its JSON.
      if (hash < 0) return this.blobs.get(blob);
      const key = blob.slice(0, hash);
      if (!batches.has(key)) batches.set(key, this.blobs.get(key).then((t) => (t === null ? [] : (JSON.parse(t) as string[]))));
      return (await batches.get(key)!)[Number(blob.slice(hash + 1))] ?? null;
    };
    return Promise.all(
      rows.map(async (r) => {
        const text = r.blob ? await read(r.blob) : r.data;
        if (r.blob && text === null) throw new RelayError(500, `Change ${r.seq} lost its data`);
        return { seq: Number(r.seq), machine_id: r.machine_id, entity: r.entity, entity_id: r.entity_id, op: r.op, data: text === null ? null : JSON.parse(text), ts: r.ts };
      }),
    );
  }

  /** One batch object for these JSON texts. */
  private async putBatch(texts: string[]): Promise<string> {
    const key = `${this.user}/changes/${crypto.randomUUID()}.json`;
    await this.blobs.put(key, JSON.stringify(texts));
    return key;
  }

  /**
   * Move change data still inline in SQLite (rows from before batches) into Blobs, a run of rows after seq `after`
   * at a time. Returns the last seq moved, or null when none is left. Safe to stop and rerun at any point.
   */
  async moveInline(after: number, maxRows = 500): Promise<number | null> {
    const sizes = this.sql
      .exec('SELECT seq, length(data) AS n FROM changes WHERE seq > ? AND data IS NOT NULL ORDER BY seq LIMIT ?', after, maxRows)
      .toArray() as { seq: number; n: number }[];
    if (!sizes.length) return null;
    let bytes = 0;
    let last = Number(sizes[0].seq);
    for (const { seq, n } of sizes) {
      if (bytes && bytes + Number(n) > MOVE_MAX_BYTES) break;
      bytes += Number(n);
      last = Number(seq);
    }
    const rows = this.sql.exec('SELECT seq, data FROM changes WHERE seq > ? AND seq <= ? AND data IS NOT NULL ORDER BY seq', after, last).toArray() as { seq: number; data: string }[];
    const blob = await this.putBatch(rows.map((r) => r.data));
    this.transaction(() => {
      rows.forEach((r, i) => this.sql.exec('UPDATE changes SET data = NULL, blob = ? WHERE seq = ?', `${blob}#${i}`, r.seq));
    });
    return last;
  }
}
