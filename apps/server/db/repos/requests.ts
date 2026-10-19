import { createHash, randomUUID } from 'node:crypto';
import { db, now, tx } from '../connection.ts';
import type { Attachment } from '../../uploads.ts';

// Durable delivery for messages sent through the API (apps/server/runner/api.ts postMessage). A row is written before
// the client hears "accepted", and its state follows the message through the runner, so a restart never loses it.
// Crew reports to a parent thread and a team's go to its lead (apps/server/runner/queue.ts) are saved the same way before
// the parent is woken. Local to this Mac: never synced, so another Mac can neither see nor run this one's queue.

/**
 * Where an accepted message is. Live states: `accepted` (saved, not handed to the runner yet), `waiting` (for a
 * free slot), `held` (runs after this turn), `sent` (written to the harness, not read back yet). Terminal states:
 * `delivered` (the harness read it, and the transcript has it where it did), `dropped` (stopped before it was
 * read), `discarded` (Ben chose not to send a recovered one), `cancelled` (Ben removed it from the queue before it
 * was sent; the row stays as the record, and the transcript never shows it). After a restart: `recovered` (it never reached a
 * harness, so it waits for Resume) and `uncertain` (it may have reached one, so it is never sent again on its own).
 */
export type DeliveryState =
  | 'accepted'
  | 'waiting'
  | 'held'
  | 'sent'
  | 'delivered'
  | 'dropped'
  | 'discarded'
  | 'cancelled'
  | 'recovered'
  | 'uncertain';

/** Waiting on Ben after a restart. */
export const PARKED: readonly DeliveryState[] = ['recovered', 'uncertain'];
/** Still in the runner's hands. A restart parks these. */
const LIVE: readonly DeliveryState[] = ['accepted', 'waiting', 'held', 'sent'];
const FINAL: readonly DeliveryState[] = ['delivered', 'dropped', 'discarded', 'cancelled'];
/** Not sent yet, so Ben can still edit, reorder or remove it: queued in the runner, or parked after a restart. */
export const EDITABLE: readonly DeliveryState[] = ['waiting', 'held', 'recovered', 'uncertain'];

export interface MessageRequest {
  /** Also the runner's message uuid, which the harness echoes back when it reads the message. */
  id: string;
  thread_id: string;
  /** The client's id for the send. A retry with the same one gets this row back. */
  request_id: string;
  /** Arrival order within the server. */
  seq: number;
  /** Queue order: `seq` until Ben reorders. Recovered requests resume in it. */
  pos: number;
  /** The text the harness gets. */
  prompt: string;
  mode: 'steer' | 'queue' | 'interrupt';
  /**
   * crew: a child's report. team: the go a team's lead gets once its members have reported. limit: the continuation
   * of a turn stopped at a usage limit (apps/server/runner/limits.ts).
   */
  source: 'ben' | 'conductor' | 'crew' | 'team' | 'limit';
  attachments: Attachment[] | null;
  /** The transcript row it becomes: `user`, or `crew_report` for a child's report. */
  kind: 'user' | 'crew_report';
  /**
   * For a message Omni wrote itself (a crew report, a team's go), the transcript payload, which is not the text the
   * harness gets. Null for a message sent through the API. These are resumed or discarded, never edited or moved.
   */
  payload: Record<string, unknown> | null;
  /** What was sent, hashed: a retry must match it. */
  fingerprint: string;
  state: DeliveryState;
  /** The Mac that accepted it, once sync is set up. Only that Mac may resume it. */
  machine_id: string | null;
  /** The transcript row the harness's read became. */
  event_id: number | null;
  created_at: string;
  updated_at: string;
}

type Row = Omit<MessageRequest, 'attachments' | 'payload'> & { attachments: string | null; payload: string | null };
const parse = (r: Row | undefined): MessageRequest | undefined =>
  r && { ...r, attachments: r.attachments ? JSON.parse(r.attachments) : null, payload: r.payload ? JSON.parse(r.payload) : null };
const list = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).all(...args) as unknown as Row[]).map((r) => parse(r)!);
const marks = (states: readonly DeliveryState[]) => states.map((s) => `'${s}'`).join(',');

/** A file as the fingerprint sees it: its name and bytes. */
export interface FileDigest {
  name: string;
  size: number;
  sha256: string;
}

/** The same message, mode, sender and files hash the same, whatever order the JSON keys came in. */
export function requestFingerprint(m: { prompt: string; mode: string; source: string; files: FileDigest[] }): string {
  const files = m.files.map((f) => [f.name, f.size, f.sha256]);
  return createHash('sha256').update(JSON.stringify([m.prompt, m.mode, m.source, files])).digest('hex');
}

export async function fileDigests(files: File[]): Promise<FileDigest[]> {
  const out: FileDigest[] = [];
  for (const f of files) {
    const buf = Buffer.from(await f.arrayBuffer());
    out.push({ name: f.name, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') });
  }
  return out;
}

export const messageRequests = {
  get: (id: string) => parse(db.prepare('SELECT * FROM message_requests WHERE id = ?').get(id) as Row | undefined),
  byRequestId: (threadId: string, requestId: string) =>
    parse(db.prepare('SELECT * FROM message_requests WHERE thread_id = ? AND request_id = ?').get(threadId, requestId) as Row | undefined),
  /** A thread's requests waiting on Ben after a restart, in the order they arrived. */
  parked: (threadId: string) =>
    list(`SELECT * FROM message_requests WHERE thread_id = ? AND state IN (${marks(PARKED)}) ORDER BY pos, seq`, threadId),
  /** A thread's requests saved but not handed to the runner yet: a worktree thread's first prompt while it is prepared. */
  unstarted: (threadId: string) => list(`SELECT * FROM message_requests WHERE thread_id = ? AND state = 'accepted' ORDER BY pos, seq`, threadId),
  /** A thread's requests, newest first: the record of what was sent, dropped, discarded or cancelled. */
  forThread: (threadId: string, limit = 100) => list('SELECT * FROM message_requests WHERE thread_id = ? ORDER BY seq DESC LIMIT ?', threadId, limit),
  /**
   * Save an accepted message, or return the one already saved under this request id. Nothing in between can
   * run, so two sends with one id never both insert.
   */
  accept(
    r: Pick<MessageRequest, 'thread_id' | 'request_id' | 'prompt' | 'mode' | 'source' | 'attachments' | 'fingerprint' | 'machine_id'> &
      Partial<Pick<MessageRequest, 'kind' | 'payload'>>,
  ) {
    return tx(() => {
      const had = messageRequests.byRequestId(r.thread_id, r.request_id);
      if (had) return { row: had, fresh: false };
      const id = randomUUID();
      const ts = now();
      db.prepare(
        `INSERT INTO message_requests (id, thread_id, request_id, prompt, mode, source, attachments, kind, payload, fingerprint, state, machine_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?)`,
      ).run(
        id, r.thread_id, r.request_id, r.prompt, r.mode, r.source, r.attachments?.length ? JSON.stringify(r.attachments) : null,
        r.kind ?? 'user', r.payload ? JSON.stringify(r.payload) : null, r.fingerprint, r.machine_id, ts, ts,
      );
      db.prepare('UPDATE message_requests SET pos = seq WHERE id = ?').run(id);
      return { row: messageRequests.get(id)!, fresh: true };
    });
  },
  /** Move a request on. A message with no row (a crew report) and a request already settled stay as they are. */
  mark(id: string, state: DeliveryState, eventId?: number) {
    return (
      db
        .prepare(`UPDATE message_requests SET state = ?, event_id = COALESCE(?, event_id), updated_at = ? WHERE id = ? AND state NOT IN (${marks(FINAL)})`)
        .run(state, eventId ?? null, now(), id).changes > 0
    );
  },
  /**
   * Ben edited a request that has not been sent. Only while it is still editable, so a request the runner has
   * started cannot change after it did. The fingerprint stays the first send's, so a late retry of that send is
   * still answered as a duplicate.
   */
  edit(id: string, r: Pick<MessageRequest, 'prompt' | 'attachments'>) {
    return (
      db
        .prepare(`UPDATE message_requests SET prompt = ?, attachments = ?, updated_at = ? WHERE id = ? AND payload IS NULL AND state IN (${marks(EDITABLE)})`)
        .run(r.prompt, r.attachments?.length ? JSON.stringify(r.attachments) : null, now(), id).changes > 0
    );
  },
  /** New queue positions, as `id -> pos`. Only for requests still editable; returns false, changing nothing, otherwise. */
  reposition(order: { id: string; pos: number }[]) {
    return tx(() => {
      const set = db.prepare(`UPDATE message_requests SET pos = ?, updated_at = ? WHERE id = ? AND state IN (${marks(EDITABLE)})`);
      const ts = now();
      for (const o of order) if (!set.run(o.pos, ts, o.id).changes) throw Object.assign(new Error('Some of these messages have already been sent.'), { status: 409 });
      return true;
    });
  },
  /** A send that failed before the runner took it was never accepted: a retry starts over. */
  remove: (id: string) => db.prepare(`DELETE FROM message_requests WHERE id = ? AND state = 'accepted'`).run(id).changes > 0,
  /**
   * Park one live request for after a restart: one written to a harness may have been read, the rest never were.
   * Shutdown parks what the runner still holds; boot parks whatever a killed server left behind.
   */
  park(id: string) {
    return (
      db
        .prepare(
          `UPDATE message_requests SET state = CASE state WHEN 'sent' THEN 'uncertain' ELSE 'recovered' END, updated_at = ?
           WHERE id = ? AND state IN (${marks(LIVE)})`,
        )
        .run(now(), id).changes > 0
    );
  },
  /**
   * At boot: park every live request this Mac accepted (or that no Mac claims), as `park` does. One another Mac
   * accepted (a copied database) stays as it was and is never resumed here.
   */
  recover(machineId: string | null) {
    return tx(() => {
      const res = db
        .prepare(
          `UPDATE message_requests SET state = CASE state WHEN 'sent' THEN 'uncertain' ELSE 'recovered' END, updated_at = ?
           WHERE state IN (${marks(LIVE)}) AND (machine_id IS NULL OR machine_id = ?)`,
        )
        .run(now(), machineId ?? '');
      return Number(res.changes);
    });
  },
};
