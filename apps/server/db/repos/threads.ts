import type { RunName } from '@omni/shared/run-switch.ts';
import { db, now, tx } from '../connection.ts';
import { outbox, record } from '../sync.ts';
import { kv } from './kv.ts';

export type ThreadStatus = 'queued' | 'running' | 'done' | 'failed' | 'stopped' | 'imported';
/** `team`: a member of a team, run under its lead thread and listed only there. */
/** A worktree thread's preparation: `preparing` until its worktree is made and checked, `failed` (with why) until Ben retries. */
export type ThreadSetup = 'preparing' | 'failed';
/** A turn stopped at the harness's usage limit: `limited` until Ben acts, `scheduled` to resume at the reset time. */
export type ThreadLimit = 'limited' | 'scheduled';
export type ThreadSource = 'manual' | 'automation' | 'conductor' | 'import' | 'capture' | 'team';

export interface Thread {
  id: string;
  channel_id: string;
  title: string;
  status: ThreadStatus;
  role: string | null;
  model: string | null;
  /** The harness this thread runs on. Existing rows migrate to 'claude-code'. */
  harness: string;
  /** Reasoning effort for the model. Empty means the model's default (nothing passed to the CLI). */
  effort: string;
  /** Why Auto picked this harness, model and effort (harness/auto.ts), null when the thread was not on Auto. Synced. */
  auto_reason: string | null;
  /**
   * The run Ben picked while a turn ran, which the thread switches to once it is quiet (runner/switch.ts). Null when
   * none waits; an empty model or effort is the default, as above. Synced.
   */
  queued_harness: string | null;
  queued_model: string | null;
  queued_effort: string | null;
  session_id: string;
  has_run: number;
  cwd: string;
  branch: string | null;
  parent_id: string | null;
  task_id: string | null;
  source: ThreadSource;
  automation: string | null;
  last_text: string | null;
  /** A guess at Ben's next reply once a turn is done, the reply box's placeholder. Local only, not synced. */
  suggestion: string | null;
  /** A follow-up thread proposed once a turn is done, the card under the transcript: its title and first prompt. Local only, not synced. */
  next_title: string | null;
  next_prompt: string | null;
  /** 1 once Ben archived it: hidden from the lists, still found by search and by its link. */
  archived: number;
  /** The sidebar folder it sits in (db/repos/folders.ts), null for ungrouped. Synced with the row. */
  folder_id: string | null;
  /** When Ben pinned it to the sidebar's Pinned section, null when it is not pinned. Synced with the row. */
  pinned_at: string | null;
  /**
   * When Ben marked it done, null when he has not. Out of Needs you (db/repos/needs-you.ts) while set, still listed in
   * its channel and folder. A new message, a run starting or a setup retry clears it. Synced with the row.
   */
  done_at: string | null;
  /** Null once the thread's folder is ready, which is always for a thread that needs no worktree. Local only, not synced. */
  setup: ThreadSetup | null;
  /** Why the worktree could not be prepared, while setup is `failed`. */
  setup_error: string | null;
  /**
   * Its last turn stopped at the harness's usage limit (apps/server/runner/limits.ts). Null once anything moves it on.
   * Synced to every Mac, so each lists it in Needs you; only the Mac that ran the turn resumes it.
   */
  limit_state: ThreadLimit | null;
  /** When the harness said that limit resets, if it said. Without it, only a manual Resume is offered. */
  limit_resets_at: string | null;
  /** 1 when the stop is the other Mac's: it shows here, and is resumed or scheduled there. */
  limit_elsewhere: number;
  /** The thread this one continues on another harness (apps/server/continue.ts), null for most. Not a crew parent. Synced. */
  continued_from: string | null;
  created_at: string;
  updated_at: string;
}

/** A limit stop as the runner reads it (apps/server/runner/limits.ts). */
export interface LimitStop {
  limit_state: ThreadLimit;
  limit_resets_at: string | null;
  /** Keys its one continuation request, so it is sent once. */
  limit_id: string;
  /** The Mac that ran the turn: only it resumes it. */
  limit_machine: string | null;
}

/** A harness session this thread had before it switched away, and the last event it had in its context. */
export interface PastSession {
  id: string;
  seen: number;
}
/** The thread's earlier sessions, one per harness. The current one stays in session_id. */
export type Sessions = Partial<Record<string, PastSession>>;
/** What the next turn's session reads before Ben's message, until that session starts (apps/server/runner/handover.ts). */
export interface PendingHandover {
  from: RunName;
  /** 0: a fresh session reads the whole thread. Above 0: the harness's earlier session resumes and reads the events after it. */
  since: number;
  /** The fresh native session exists, so the next spawn resumes it while its history still waits. */
  started?: boolean;
}
/** How a thread's sessions stand across harness switches (apps/server/runner/switch-plan.ts). Synced, kept out of the API. */
export interface SessionState {
  sessions: Sessions;
  handover: PendingHandover | null;
}

// Stored with event uids, not this Mac's row ids, so the other Mac reads the same place in the transcript. An event
// that has not reached this Mac yet reads as the thread's start: the handover then carries too much, never too little.
export interface StoredSessionState {
  sessions: Partial<Record<string, { id: string; seen: string }>> | null;
  handover: { from: RunName; since: string | null; started?: boolean } | null;
}
const uidOf = (id: number) => (db.prepare('SELECT uid FROM events WHERE id = ?').get(id) as { uid: string } | undefined)?.uid ?? '';
const idOf = (uid: string) => (db.prepare('SELECT id FROM events WHERE uid = ?').get(uid) as { id: number } | undefined)?.id ?? 1;
const parsed = <T>(json: string | null): T | null => (json ? (JSON.parse(json) as T) : null);

function storedSessions(s: Sessions | null | undefined): StoredSessionState['sessions'] {
  const entries = Object.entries(s ?? {}).filter((e): e is [string, PastSession] => !!e[1]);
  return entries.length ? Object.fromEntries(entries.map(([h, p]) => [h, { id: p.id, seen: uidOf(p.seen) }])) : null;
}
const storedHandover = (h: PendingHandover | null | undefined): StoredSessionState['handover'] =>
  h ? { from: h.from, since: h.since ? uidOf(h.since) : null, ...(h.started && { started: true }) } : null;
const readSessions = (s: StoredSessionState['sessions']): Sessions =>
  Object.fromEntries(Object.entries(s ?? {}).flatMap(([h, p]) => (p ? [[h, { id: p.id, seen: idOf(p.seen) }]] : [])));
const readHandover = (h: StoredSessionState['handover']): PendingHandover | null => (h ? { from: h.from, since: h.since ? idOf(h.since) : 0, ...(h.started && { started: true }) } : null);
const json = (v: object | null) => (v ? JSON.stringify(v) : null);

/** The columns clients read, without sync's run_machine, the limit stop's id and owner, or the session state. */
export const THREAD_COLUMNS =
  'id, channel_id, title, status, role, model, harness, effort, auto_reason, queued_harness, queued_model, queued_effort, session_id, has_run, cwd, branch, parent_id, task_id, source, automation, last_text, suggestion, next_title, next_prompt, archived, folder_id, pinned_at, done_at, setup, setup_error, limit_state, limit_resets_at, limit_elsewhere, continued_from, created_at, updated_at';

/** Who runs a thread with this status: this machine while it is running or queued here and sync is set up, else nobody. */
const runMachine = (status: ThreadStatus) => (status === 'running' || status === 'queued' ? outbox.machineId() : null);

/**
 * kv `handoff.holder.<thread>`: the Mac that holds the thread between turns, which Take over asks for it
 * (apps/server/handoff.ts). Synced kv, not a column, since the row is last-writer-wins and a rename on the other Mac
 * would undo it. Only the Mac it moves to writes it.
 */
const HOLDER = 'handoff.holder.';
const isMachineId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(v);

export const threads = {
  get: (id: string) => db.prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE id = ?`).get(id) as unknown as Thread | undefined,
  /** A channel's threads, without team members: those are listed under their lead. */
  byChannel: (channelId: string, limit = 200, archived = false) =>
    db
      .prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE channel_id = ? AND source != 'team' AND archived = ? ORDER BY updated_at DESC LIMIT ?`)
      .all(channelId, archived ? 1 : 0, limit) as unknown as Thread[],
  recent: (limit = 50) =>
    db.prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE archived = 0 ORDER BY updated_at DESC LIMIT ?`).all(limit) as unknown as Thread[],
  children: (parentId: string) =>
    db.prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE parent_id = ? ORDER BY created_at`).all(parentId) as unknown as Thread[],
  /** Threads delegated from Conductor jobs, kept visible beside their parent in the originating channel. */
  conductorHandoffChildren: () =>
    db
      .prepare(
        `SELECT ${THREAD_COLUMNS.split(', ').map((c) => `child.${c}`).join(', ')}
         FROM threads child JOIN threads parent ON parent.id = child.parent_id
         WHERE parent.channel_id = 'conductor' AND parent.archived = 0
           AND child.source = 'conductor' AND child.archived = 0
         ORDER BY parent.updated_at DESC, child.created_at ASC`,
      )
      .all() as unknown as Thread[],
  /** A team lead's members, in the order they were handed out. */
  team: (leadId: string) =>
    db
      .prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE parent_id = ? AND source = 'team' ORDER BY created_at`)
      .all(leadId) as unknown as Thread[],
  /**
   * Each channel's `perChannel` most recently updated threads, whatever their status. Team members are listed under their
   * lead. Ties go to the newer thread, then the lower id, as the sidebar's Recent threads breaks them (apps/web/src/sidebar-lists.ts).
   */
  recentPerChannel: (perChannel = 5) =>
    db
      .prepare(
        `SELECT ${THREAD_COLUMNS} FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY updated_at DESC, created_at DESC, id) AS n FROM threads WHERE source != 'team' AND archived = 0) WHERE n <= ?`,
      )
      .all(perChannel) as unknown as Thread[],
  /** Threads in a folder of their own channel, newest first, without archived ones and team members. */
  filed: (channelId?: string) =>
    db
      .prepare(
        `SELECT ${THREAD_COLUMNS.split(', ').map((c) => `t.${c}`).join(', ')} FROM threads t JOIN folders f ON f.id = t.folder_id AND f.channel_id = t.channel_id
         WHERE t.archived = 0 AND t.source != 'team' ${channelId ? 'AND t.channel_id = ?' : ''} ORDER BY t.updated_at DESC`,
      )
      .all(...(channelId ? [channelId] : [])) as unknown as Thread[],
  /** Pinned threads, the latest pin first, without archived ones or those of an archived channel. */
  pinned: () =>
    db
      .prepare(
        `SELECT ${THREAD_COLUMNS.split(', ').map((c) => `t.${c}`).join(', ')} FROM threads t JOIN channels c ON c.id = t.channel_id
         WHERE t.pinned_at IS NOT NULL AND t.archived = 0 AND c.archived = 0 ORDER BY t.pinned_at DESC, t.id`,
      )
      .all() as unknown as Thread[],
  running: () => db.prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE status IN ('running','queued')`).all() as unknown as Thread[],
  /** The machine id of the Mac that runs the thread (sync), or null when none does. */
  runMachine: (id: string) =>
    (db.prepare('SELECT run_machine FROM threads WHERE id = ?').get(id) as { run_machine: string | null } | undefined)?.run_machine ?? null,
  list(filter: { channel?: string; status?: string; limit?: number }) {
    const where: string[] = ['archived = 0'];
    const args: (string | number)[] = [];
    if (filter.channel) (where.push('channel_id = ?'), args.push(filter.channel));
    if (filter.status) (where.push('status = ?'), args.push(filter.status));
    args.push(filter.limit ?? 30);
    return db
      .prepare(`SELECT ${THREAD_COLUMNS} FROM threads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT ?`)
      .all(...args) as unknown as Thread[];
  },
  create(
    t: Omit<
      Thread,
      'created_at' | 'updated_at' | 'has_run' | 'last_text' | 'suggestion' | 'next_title' | 'next_prompt' | 'harness' | 'effort' | 'auto_reason' | 'queued_harness' | 'queued_model' | 'queued_effort' | 'archived' | 'folder_id' | 'pinned_at' | 'done_at' | 'setup' | 'setup_error' | 'limit_state' | 'limit_resets_at' | 'limit_elsewhere' | 'continued_from'
    > & {
      has_run?: number; created_at?: string; harness?: string; effort?: string; auto_reason?: string | null; folder_id?: string | null; setup?: ThreadSetup | null;
    },
  ) {
    const ts = t.created_at ?? now();
    return tx(() => {
      db.prepare(
        `INSERT INTO threads (id, channel_id, title, status, role, model, harness, effort, auto_reason, session_id, has_run, cwd, branch, parent_id, task_id, source, automation, run_machine, folder_id, setup, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        t.id, t.channel_id, t.title, t.status, t.role, t.model, t.harness ?? 'claude-code', t.effort ?? '', t.auto_reason ?? null, t.session_id, t.has_run ?? 0, t.cwd,
        t.branch, t.parent_id, t.task_id, t.source, t.automation, runMachine(t.status), t.folder_id ?? null, t.setup ?? null, ts, ts,
      );
      record('thread', t.id);
      if (runMachine(t.status)) threads.hold(t.id);
      return threads.get(t.id)!;
    });
  },
  /** Its earlier sessions and pending handover. */
  sessionState(id: string): SessionState {
    const row = threads.storedSessionState(id);
    return { sessions: readSessions(row.sessions), handover: readHandover(row.handover) };
  },
  /** The same as stored, event uids and all, for sync. */
  storedSessionState(id: string): StoredSessionState {
    const row = db.prepare('SELECT sessions, handover FROM threads WHERE id = ?').get(id) as { sessions: string | null; handover: string | null } | undefined;
    return { sessions: parsed(row?.sessions ?? null), handover: parsed(row?.handover ?? null) };
  },
  update(id: string, patch: Partial<Thread> & Partial<SessionState>) {
    const allowed = ['title', 'status', 'model', 'harness', 'effort', 'auto_reason', 'queued_harness', 'queued_model', 'queued_effort', 'session_id', 'has_run', 'cwd', 'branch', 'last_text', 'archived', 'setup', 'setup_error', 'updated_at'] as const;
    const keys = allowed.filter((k) => k in patch);
    const sets = keys.map((k) => `${k} = ?`);
    const vals = keys.map((k) => (patch[k] ?? null) as string | number | null);
    if ('sessions' in patch) (sets.push('sessions = ?'), vals.push(json(storedSessions(patch.sessions))));
    if ('handover' in patch) (sets.push('handover = ?'), vals.push(json(storedHandover(patch.handover))));
    if (!('updated_at' in patch)) (sets.push('updated_at = ?'), vals.push(now()));
    // Every status write says who runs the thread, so the row itself tells the other Mac (apps/server/sync/guard.ts).
    if (patch.status) (sets.push('run_machine = ?'), vals.push(runMachine(patch.status)));
    // A run starting, or Ben retrying its setup, is news: a thread marked done comes back to Needs you when it ends.
    if (patch.status === 'running' || patch.status === 'queued' || patch.setup === 'preparing') sets.push('done_at = NULL');
    tx(() => {
      if (!db.prepare(`UPDATE threads SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id).changes) return;
      record('thread', id);
      if (patch.status && runMachine(patch.status)) threads.hold(id);
    });
    return threads.get(id);
  },
  /** This Mac holds the thread now: a turn starts here, or it took the thread over. Written once, since the relay keeps every write. */
  hold(id: string) {
    const self = outbox.machineId();
    if (self && kv.get(HOLDER + id) !== self) kv.set(HOLDER + id, self);
  },
  /**
   * The Mac that holds the thread: the one running it, or between turns the one that ran it last or took it since.
   * Null when no Mac is known to, as for a thread that has not run since this build or with sync never set up.
   */
  holder(id: string): string | null {
    const row = db.prepare('SELECT status, run_machine FROM threads WHERE id = ?').get(id) as { status: ThreadStatus; run_machine: string | null } | undefined;
    if (!row) return null;
    if (row.status === 'running' || row.status === 'queued') return row.run_machine;
    const v = kv.get<unknown>(HOLDER + id);
    return isMachineId(v) ? v : null;
  },
  /**
   * Pin it to the sidebar, or unpin it. Like a rename it keeps the thread's place in the lists: updated_at stays. The
   * row syncs, so the other Mac pins it too. True when it changed.
   */
  setPinned(id: string, pinned: boolean) {
    return tx(() => {
      const changed =
        db.prepare(`UPDATE threads SET pinned_at = ? WHERE id = ? AND (pinned_at IS NULL) = ?`).run(pinned ? now() : null, id, pinned ? 1 : 0).changes > 0;
      if (changed) record('thread', id);
      return changed;
    });
  },
  /**
   * Mark it done, or not done. Done takes it out of Needs you whatever it waits on; like a pin it keeps the thread's
   * place in the lists. The row syncs, so the other Mac has it too. True when it changed.
   */
  setDone(id: string, done: boolean) {
    return tx(() => {
      const changed =
        db.prepare(`UPDATE threads SET done_at = ? WHERE id = ? AND (done_at IS NULL) = ?`).run(done ? now() : null, id, done ? 1 : 0).changes > 0;
      if (changed) record('thread', id);
      return changed;
    });
  },
  /**
   * The reply box's suggestion. Not a change to the thread: updated_at stays, so lists keep their order,
   * and sync never hears of it. True when it changed.
   */
  setSuggestion(id: string, text: string | null) {
    return db.prepare('UPDATE threads SET suggestion = ? WHERE id = ? AND suggestion IS NOT ?').run(text, id, text).changes > 0;
  },
  /** The proposed follow-up thread, or null to drop it. Like the suggestion: updated_at stays and sync never hears of it. */
  setNextThread(id: string, next: { title: string; prompt: string } | null) {
    const title = next?.title ?? null;
    const prompt = next?.prompt ?? null;
    return (
      db
        .prepare('UPDATE threads SET next_title = ?, next_prompt = ? WHERE id = ? AND (next_title IS NOT ? OR next_prompt IS NOT ?)')
        .run(title, prompt, id, title, prompt).changes > 0
    );
  },
  /** A thread's limit stop with the columns clients never read: its id and the Mac that owns it. */
  limit(id: string) {
    return db.prepare('SELECT limit_state, limit_resets_at, limit_id, limit_machine FROM threads WHERE id = ? AND limit_state IS NOT NULL').get(id) as unknown as
      | LimitStop
      | undefined;
  },
  /**
   * Record a limit stop, or clear one. Like the suggestion it is not a change to the thread: updated_at stays and the
   * thread row does not sync for it. The stop goes to the other Mac on its own (limit_stop), so both list it.
   * True when it changed.
   */
  setLimit(id: string, l: { state: ThreadLimit; resets_at: string | null; id: string; machine: string | null } | null) {
    return tx(() => {
      const changed =
        db
          .prepare(
            `UPDATE threads SET limit_state = ?, limit_resets_at = ?, limit_id = ?, limit_machine = ?, limit_elsewhere = 0
             WHERE id = ? AND (? IS NOT NULL OR limit_state IS NOT NULL)`,
          )
          .run(l?.state ?? null, l?.resets_at ?? null, l?.id ?? null, l?.machine ?? null, id, l?.state ?? null).changes > 0;
      if (changed) record('limit_stop', id, l ? 'upsert' : 'delete');
      return changed;
    });
  },
  /** Move a limit stop from one state to another, only if it is still in `from` and this Mac's. False otherwise. */
  moveLimit(id: string, from: ThreadLimit, to: ThreadLimit) {
    return tx(() => {
      const moved =
        db
          .prepare('UPDATE threads SET limit_state = ? WHERE id = ? AND limit_state = ? AND (limit_machine IS NULL OR limit_machine = ?)')
          .run(to, id, from, outbox.machineId() ?? '').changes > 0;
      if (moved) record('limit_stop', id);
      return moved;
    });
  },
  /**
   * Take the limit stop away, to send its continuation: the row says so before anything is sent, so two callers (a
   * timer and a click, or a restart) never both get it. Only this Mac's, only from `from`. Its id, or null.
   */
  takeLimit(id: string, from: readonly ThreadLimit[]): string | null {
    return tx(() => {
      const l = threads.limit(id);
      if (!l || !from.includes(l.limit_state) || (l.limit_machine && l.limit_machine !== outbox.machineId())) return null;
      threads.setLimit(id, null);
      return l.limit_id;
    });
  },
  /** Every continuation this Mac has scheduled, soonest first. */
  scheduledLimits: () =>
    db
      .prepare(
        `SELECT id, limit_resets_at FROM threads WHERE limit_state = 'scheduled' AND limit_resets_at IS NOT NULL
         AND (limit_machine IS NULL OR limit_machine = ?) ORDER BY limit_resets_at`,
      )
      .all(outbox.machineId() ?? '') as unknown as { id: string; limit_resets_at: string }[],
  /** Move a thread to another channel, keeping its place in the lists. import-history's --move-imported uses it. */
  setChannel(id: string, channelId: string) {
    tx(() => {
      // A folder belongs to one channel, so the thread leaves it.
      if (db.prepare('UPDATE threads SET channel_id = ?, folder_id = NULL WHERE id = ?').run(channelId, id).changes) record('thread', id);
    });
  },
  /**
   * Threads that were mid-run when the server died can never finish. Only the ones this machine ran, or no
   * machine claims: one another Mac runs is that Mac's to fail when it restarts.
   */
  /** At boot: a preparation the last server was still running can never finish. It fails with why, for Retry. */
  failPreparing(reason: string) {
    return Number(db.prepare(`UPDATE threads SET setup = 'failed', setup_error = ? WHERE setup = 'preparing'`).run(reason).changes);
  },
  failInterrupted() {
    return tx(() => {
      const ids = db
        .prepare(`SELECT id FROM threads WHERE status IN ('running','queued') AND (run_machine IS NULL OR run_machine = ?)`)
        .all(outbox.machineId() ?? '') as { id: string }[];
      const fail = db.prepare(`UPDATE threads SET status = 'failed', run_machine = NULL WHERE id = ?`);
      for (const { id } of ids) (fail.run(id), record('thread', id));
      return ids.length;
    });
  },
};
