import { db, now, tx } from '../connection.ts';
import { outbox, record } from '../sync.ts';
import { PARKED } from './requests.ts';
import { THREAD_COLUMNS, type Thread } from './threads.ts';

// Needs you: the unread results and the blockers across every thread that is not archived, not only the recent
// list. Three states stay apart here: execution (the thread's status, and the `completions` its turns left),
// read state (`result_reads`, the newest result Ben has seen per thread) and filing (folder_id, never read here).
// Reading a result writes only `result_reads`, so a thread's updated_at, status and place in the lists stay.
// Both sync between Macs (server/sync/handlers/needs-you.ts). A result is the same row everywhere: only the Mac that
// ran the turn writes it, and its uid and n travel with it. Results are ordered by (n, uid), never by a local seq or
// a clock, so a read made on either Mac names the same place in the thread's results on both.

/** How a turn ended: the thread's status when it did. */
export type CompletionStatus = 'done' | 'failed' | 'stopped';

/** One ended turn. `uid` is its identity, the one a client sends back to say it showed it. */
export interface Completion {
  /** Arrival order on this Mac. Never sent: a client names a result by its uid. */
  seq: number;
  uid: string;
  /** Its place among the thread's results, the same on every Mac. A tie (two Macs ran a turn apart) goes by uid. */
  n: number;
  thread_id: string;
  status: CompletionStatus;
  /** The synced uid of the thread's newest event when the turn ended. */
  event_uid: string | null;
  created_at: string;
}

/** The newest result of a thread that Ben has not seen. */
export interface NeedsYouResult {
  uid: string;
  status: CompletionStatus;
  event_uid: string | null;
  at: string;
}

/**
 * What holds a thread up until Ben acts: `setup` (its worktree could not be prepared, `detail` says why),
 * `recovered` (messages a restart kept for Resume), `uncertain` (a message a harness may have read before a
 * restart, sent again only when Ben says so) or `limited` (its harness stopped the turn at the plan's usage limit,
 * server/runner/limits.ts). `count` is how many messages, for the two request kinds.
 */
export interface NeedsYouBlocker {
  kind: 'setup' | 'recovered' | 'uncertain' | 'limited';
  detail: string | null;
  count: number;
  /** limited: when the harness said the limit resets. Null when it did not say, so only a manual Resume works. */
  resets_at?: string | null;
  /** limited: Ben scheduled the continuation for that time. Still a blocker: nothing runs until then. */
  scheduled?: boolean;
  /** limited: the turn stopped on the other Mac, which is the one that resumes it. */
  elsewhere?: boolean;
}

export interface NeedsYouItem {
  thread: Thread;
  /** Null when only a blocker brings the thread here. */
  result: NeedsYouResult | null;
  blockers: NeedsYouBlocker[];
  /** When it came to need Ben, newest first in the list. */
  at: string;
}

export interface NeedsYou {
  items: NeedsYouItem[];
  /** Unread results, and threads with a blocker. */
  unread: number;
  blocked: number;
}

const prefixed = THREAD_COLUMNS.split(', ').map((c) => `t.${c}`).join(', ');
const marks = PARKED.map((s) => `'${s}'`).join(',');

/**
 * Threads in the lists: not archived, not a team member (listed under its lead). A delegated thread's success
 * went to its parent as a crew report, so only its failures and stops are results for Ben.
 */
const LISTED = `t.archived = 0 AND t.source != 'team'`;

export const completions = {
  get: (uid: string) => db.prepare('SELECT * FROM completions WHERE uid = ?').get(uid) as unknown as Completion | undefined,
  /** A thread's ended turns, oldest first. */
  forThread: (threadId: string) =>
    db.prepare('SELECT * FROM completions WHERE thread_id = ? ORDER BY n, uid').all(threadId) as unknown as Completion[],
  latest: (threadId: string) =>
    db.prepare('SELECT * FROM completions WHERE thread_id = ? ORDER BY n DESC, uid DESC LIMIT 1').get(threadId) as unknown as Completion | undefined,
};

export const resultReads = {
  get: (threadId: string) =>
    db.prepare('SELECT * FROM result_reads WHERE thread_id = ?').get(threadId) as unknown as
      | ResultRead
      | undefined,
  /**
   * Ben saw this result. The watermark moves to it and never back: reading an older one after a newer one is a
   * no-op, and a turn that ended after the one shown stays unread. A move goes to the other Mac. Null for a result
   * this Mac does not have.
   */
  read(uid: string) {
    return tx(() => {
      const c = completions.get(uid);
      if (!c) return null;
      if (advanceRead({ thread_id: c.thread_id, n: c.n, uid: c.uid, read_at: now() })) record('result_read', c.thread_id);
      return c;
    });
  },
};

/** A thread's read watermark: the newest result Ben has seen there. */
export interface ResultRead {
  thread_id: string;
  n: number;
  uid: string;
  read_at: string;
}

/**
 * Move a thread's watermark to this result when it is newer by (n, uid), the order every Mac agrees on. True when it
 * moved. Reading here and a read arriving from the other Mac both go through it, so the watermark is the newest read
 * either Mac made, in whatever order they arrive. Fails on a thread that is not here.
 */
export function advanceRead(r: ResultRead): boolean {
  return (
    db
      .prepare(
        `INSERT INTO result_reads (thread_id, n, uid, read_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET n = excluded.n, uid = excluded.uid, read_at = excluded.read_at
         WHERE (excluded.n, excluded.uid) > (result_reads.n, result_reads.uid)`,
      )
      .run(r.thread_id, r.n, r.uid, r.read_at).changes > 0
  );
}

type ResultRow = Thread & { r_uid: string | null; r_status: CompletionStatus | null; r_event_uid: string | null; r_at: string | null };

/** The inbox, everywhere or in one channel. */
export function needsYou(channelId?: string, threadId?: string): NeedsYou {
  const scope = `${channelId ? 'AND t.channel_id = ?' : ''} ${threadId ? 'AND t.id = ?' : ''}`;
  const args = [...(channelId ? [channelId] : []), ...(threadId ? [threadId] : [])];
  // A thread's newest result, when Ben has not read it and the thread is not running again: a reply he sent
  // since means he saw it, and the turn it starts brings its own result.
  const results = db
    .prepare(
      `SELECT ${prefixed}, c.uid AS r_uid, c.status AS r_status, c.event_uid AS r_event_uid, c.created_at AS r_at
       FROM threads t
       JOIN completions c ON c.uid = (SELECT uid FROM completions WHERE thread_id = t.id ORDER BY n DESC, uid DESC LIMIT 1)
       LEFT JOIN result_reads r ON r.thread_id = t.id
       WHERE ${LISTED} ${scope} AND t.status IN ('done','failed','stopped') AND (r.thread_id IS NULL OR (c.n, c.uid) > (r.n, r.uid))
         AND NOT (c.status = 'done' AND t.parent_id IS NOT NULL)`,
    )
    .all(...args) as unknown as ResultRow[];
  const setup = db
    .prepare(`SELECT ${prefixed} FROM threads t WHERE ${LISTED} ${scope} AND t.setup = 'failed'`)
    .all(...args) as unknown as Thread[];
  // Only this Mac's: another Mac's parked requests are that Mac's to resume.
  const parked = db
    .prepare(
      `SELECT ${prefixed}, m.state AS p_state, COUNT(*) AS p_count, MAX(m.updated_at) AS p_at
       FROM message_requests m JOIN threads t ON t.id = m.thread_id
       WHERE ${LISTED} ${scope} AND m.state IN (${marks}) AND (m.machine_id IS NULL OR m.machine_id = ?)
       GROUP BY t.id, m.state`,
    )
    .all(...args, outbox.machineId() ?? '') as unknown as (Thread & { p_state: 'recovered' | 'uncertain'; p_count: number; p_at: string })[];

  // A turn stopped at a usage limit, on either Mac (the stop syncs): only the Mac that ran it resumes it.
  const limited = db
    .prepare(`SELECT ${prefixed} FROM threads t WHERE ${LISTED} ${scope} AND t.limit_state IS NOT NULL`)
    .all(...args) as unknown as Thread[];

  const items = new Map<string, NeedsYouItem>();
  const item = (t: Thread, at: string) => {
    const thread = pick(t);
    const had = items.get(thread.id);
    if (had) {
      if (at > had.at) had.at = at;
      return had;
    }
    const fresh: NeedsYouItem = { thread, result: null, blockers: [], at };
    items.set(thread.id, fresh);
    return fresh;
  };
  for (const r of results) {
    item(r, r.r_at!).result = { uid: r.r_uid!, status: r.r_status!, event_uid: r.r_event_uid, at: r.r_at! };
  }
  for (const t of setup) item(t, t.updated_at).blockers.unshift({ kind: 'setup', detail: t.setup_error, count: 0 });
  for (const p of parked) item(p, p.p_at).blockers.push({ kind: p.p_state, detail: null, count: Number(p.p_count) });
  for (const t of limited) {
    item(t, t.updated_at).blockers.push({
      kind: 'limited', detail: null, count: 0, resets_at: t.limit_resets_at, scheduled: t.limit_state === 'scheduled', elsewhere: !!t.limit_elsewhere,
    });
  }
  for (const i of items.values()) i.blockers.sort((a, b) => BLOCKER_ORDER.indexOf(a.kind) - BLOCKER_ORDER.indexOf(b.kind));

  const list = [...items.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { items: list, unread: list.filter((i) => i.result).length, blocked: list.filter((i) => i.blockers.length).length };
}

const BLOCKER_ORDER: NeedsYouBlocker['kind'][] = ['setup', 'uncertain', 'limited', 'recovered'];

/** Just the thread's own columns, without what the queries joined to it. */
function pick(row: Thread): Thread {
  const out: Record<string, unknown> = {};
  for (const c of THREAD_COLUMNS.split(', ')) out[c] = (row as unknown as Record<string, unknown>)[c];
  return out as unknown as Thread;
}
