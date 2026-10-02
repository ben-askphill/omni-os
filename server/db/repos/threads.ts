import { db, now, tx } from '../connection.ts';
import { outbox, record } from '../sync.ts';

export type ThreadStatus = 'queued' | 'running' | 'done' | 'failed' | 'stopped' | 'imported';
/** `team`: a member of a team, run under its lead thread and listed only there. */
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
  created_at: string;
  updated_at: string;
}

/** The columns clients read, without sync's run_machine. */
export const THREAD_COLUMNS =
  'id, channel_id, title, status, role, model, harness, effort, session_id, has_run, cwd, branch, parent_id, task_id, source, automation, last_text, suggestion, created_at, updated_at';

/** Who runs a thread with this status: this machine while it is running or queued here and sync is set up, else nobody. */
const runMachine = (status: ThreadStatus) => (status === 'running' || status === 'queued' ? outbox.machineId() : null);

export const threads = {
  get: (id: string) => db.prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE id = ?`).get(id) as unknown as Thread | undefined,
  /** A channel's threads, without team members: those are listed under their lead. */
  byChannel: (channelId: string, limit = 200) =>
    db
      .prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE channel_id = ? AND source != 'team' ORDER BY updated_at DESC LIMIT ?`)
      .all(channelId, limit) as unknown as Thread[],
  recent: (limit = 50) =>
    db.prepare(`SELECT ${THREAD_COLUMNS} FROM threads ORDER BY updated_at DESC LIMIT ?`).all(limit) as unknown as Thread[],
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
        `SELECT ${THREAD_COLUMNS} FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY updated_at DESC) AS n FROM threads WHERE source != 'team') WHERE n <= ?`,
      )
      .all(perChannel) as unknown as Thread[],
  running: () => db.prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE status IN ('running','queued')`).all() as unknown as Thread[],
  /** The machine id of the Mac that runs the thread (sync), or null when none does. */
  runMachine: (id: string) =>
    (db.prepare('SELECT run_machine FROM threads WHERE id = ?').get(id) as { run_machine: string | null } | undefined)?.run_machine ?? null,
  list(filter: { channel?: string; status?: string; limit?: number }) {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.channel) (where.push('channel_id = ?'), args.push(filter.channel));
    if (filter.status) (where.push('status = ?'), args.push(filter.status));
    args.push(filter.limit ?? 30);
    return db
      .prepare(`SELECT ${THREAD_COLUMNS} FROM threads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT ?`)
      .all(...args) as unknown as Thread[];
  },
  create(t: Omit<Thread, 'created_at' | 'updated_at' | 'has_run' | 'last_text' | 'suggestion' | 'harness' | 'effort'> & { has_run?: number; created_at?: string; harness?: string; effort?: string }) {
    const ts = t.created_at ?? now();
    return tx(() => {
      db.prepare(
        `INSERT INTO threads (id, channel_id, title, status, role, model, harness, effort, session_id, has_run, cwd, branch, parent_id, task_id, source, automation, run_machine, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        t.id, t.channel_id, t.title, t.status, t.role, t.model, t.harness ?? 'claude-code', t.effort ?? '', t.session_id, t.has_run ?? 0, t.cwd,
        t.branch, t.parent_id, t.task_id, t.source, t.automation, runMachine(t.status), ts, ts,
      );
      record('thread', t.id);
      return threads.get(t.id)!;
    });
  },
  update(id: string, patch: Partial<Thread>) {
    const allowed = ['title', 'status', 'model', 'harness', 'effort', 'session_id', 'has_run', 'cwd', 'branch', 'last_text', 'updated_at'] as const;
    const keys = allowed.filter((k) => k in patch);
    const sets = keys.map((k) => `${k} = ?`);
    const vals = keys.map((k) => (patch[k] ?? null) as string | number | null);
    if (!('updated_at' in patch)) (sets.push('updated_at = ?'), vals.push(now()));
    // Every status write says who runs the thread, so the row itself tells the other Mac (server/sync/guard.ts).
    if (patch.status) (sets.push('run_machine = ?'), vals.push(runMachine(patch.status)));
    tx(() => {
      if (db.prepare(`UPDATE threads SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id).changes) record('thread', id);
    });
    return threads.get(id);
  },
  /**
   * The reply box's suggestion. Not a change to the thread: updated_at stays, so lists keep their order,
   * and sync never hears of it. True when it changed.
   */
  setSuggestion(id: string, text: string | null) {
    return db.prepare('UPDATE threads SET suggestion = ? WHERE id = ? AND suggestion IS NOT ?').run(text, id, text).changes > 0;
  },
  /** Move a thread to another channel, keeping its place in the lists. import-history's --move-imported uses it. */
  setChannel(id: string, channelId: string) {
    tx(() => {
      if (db.prepare('UPDATE threads SET channel_id = ? WHERE id = ?').run(channelId, id).changes) record('thread', id);
    });
  },
  /**
   * Threads that were mid-run when the server died can never finish. Only the ones this machine ran, or no
   * machine claims: one another Mac runs is that Mac's to fail when it restarts.
   */
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
