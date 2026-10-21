import { db, now, tx } from '../connection.ts';
import { outbox, record } from '../sync.ts';

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

/** The columns clients read, without sync's run_machine or the limit stop's id and owner. */
export const THREAD_COLUMNS =
  'id, channel_id, title, status, role, model, harness, effort, session_id, has_run, cwd, branch, parent_id, task_id, source, automation, last_text, suggestion, next_title, next_prompt, archived, folder_id, pinned_at, setup, setup_error, limit_state, limit_resets_at, limit_elsewhere, created_at, updated_at';

/** Who runs a thread with this status: this machine while it is running or queued here and sync is set up, else nobody. */
const runMachine = (status: ThreadStatus) => (status === 'running' || status === 'queued' ? outbox.machineId() : null);

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
  /** A team lead's members, in the order they were handed out. */
  team: (leadId: string) =>
    db
      .prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE parent_id = ? AND source = 'team' ORDER BY created_at`)
      .all(leadId) as unknown as Thread[],
  /** Each channel's `perChannel` most recently updated threads, whatever their status. Team members are listed under their lead. */
  recentPerChannel: (perChannel = 5) =>
    db
      .prepare(
        `SELECT ${THREAD_COLUMNS} FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY updated_at DESC) AS n FROM threads WHERE source != 'team' AND archived = 0) WHERE n <= ?`,
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
      'created_at' | 'updated_at' | 'has_run' | 'last_text' | 'suggestion' | 'next_title' | 'next_prompt' | 'harness' | 'effort' | 'archived' | 'folder_id' | 'pinned_at' | 'setup' | 'setup_error' | 'limit_state' | 'limit_resets_at' | 'limit_elsewhere'
    > & {
      has_run?: number; created_at?: string; harness?: string; effort?: string; folder_id?: string | null; setup?: ThreadSetup | null;
    },
  ) {
    const ts = t.created_at ?? now();
    return tx(() => {
      db.prepare(
        `INSERT INTO threads (id, channel_id, title, status, role, model, harness, effort, session_id, has_run, cwd, branch, parent_id, task_id, source, automation, run_machine, folder_id, setup, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        t.id, t.channel_id, t.title, t.status, t.role, t.model, t.harness ?? 'claude-code', t.effort ?? '', t.session_id, t.has_run ?? 0, t.cwd,
        t.branch, t.parent_id, t.task_id, t.source, t.automation, runMachine(t.status), t.folder_id ?? null, t.setup ?? null, ts, ts,
      );
      record('thread', t.id);
      return threads.get(t.id)!;
    });
  },
  update(id: string, patch: Partial<Thread>) {
    const allowed = ['title', 'status', 'model', 'harness', 'effort', 'session_id', 'has_run', 'cwd', 'branch', 'last_text', 'archived', 'setup', 'setup_error', 'updated_at'] as const;
    const keys = allowed.filter((k) => k in patch);
    const sets = keys.map((k) => `${k} = ?`);
    const vals = keys.map((k) => (patch[k] ?? null) as string | number | null);
    if (!('updated_at' in patch)) (sets.push('updated_at = ?'), vals.push(now()));
    // Every status write says who runs the thread, so the row itself tells the other Mac (apps/server/sync/guard.ts).
    if (patch.status) (sets.push('run_machine = ?'), vals.push(runMachine(patch.status)));
    tx(() => {
      if (db.prepare(`UPDATE threads SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id).changes) record('thread', id);
    });
    return threads.get(id);
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
