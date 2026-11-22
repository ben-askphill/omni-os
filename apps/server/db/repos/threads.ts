import type { RunName } from '@omni/shared/run-switch.ts';
import type { Goal, GoalStatus } from '@omni/shared/goal.ts';
import type { SeatedDelegation } from '@omni/shared/members.ts';
import { db, now, tx } from '../connection.ts';
import { outbox, record } from '../sync.ts';
import { assignments } from './assignments.ts';

export type ThreadStatus = 'queued' | 'running' | 'done' | 'failed' | 'stopped' | 'imported';
/** `team`: a member of a team, run under its lead thread and listed only there. */
/** A worktree thread's preparation: `preparing` until its worktree is made and checked, `failed` (with why) until Ben retries. */
/** `signin`: a connector the job needs is signed out (runner/setup.ts holdForSignIn); `setup_error` says which. */
export type ThreadSetup = 'preparing' | 'failed' | 'signin';
/** A turn stopped at the harness's usage limit: `limited` until Ben acts, `scheduled` to resume at the reset time. */
export type ThreadLimit = 'limited' | 'scheduled';
/** `member`: the session of an agent seated in a group thread (runner/members.ts), under that thread and listed nowhere. */
export type ThreadSource = 'manual' | 'automation' | 'conductor' | 'import' | 'capture' | 'team' | 'member';
export type ThreadWorkspace = 'none' | 'read' | 'worktree';

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
  /** What the last turn left open for Ben, as JSON (packages/shared/open-items.ts): the card under the transcript. Local only, not synced. */
  open_items: string | null;
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
   * Why this machine did not resume the thread's session: the session download before the turn failed or timed out,
   * so the copy here may lack turns another machine ran (runner/spawn.ts). Null once a turn starts. Local only.
   */
  resume_blocked: string | null;
  /**
   * Its last turn stopped at the harness's usage limit (apps/server/runner/limits.ts). Null once anything moves it on.
   * Synced to every Mac, so each lists it in Needs you; only the Mac that ran the turn resumes it.
   */
  limit_state: ThreadLimit | null;
  /** When the harness said that limit resets, if it said. Without it, only a manual Resume is offered. */
  limit_resets_at: string | null;
  /** 1 when the stop is the other Mac's: it shows here, and is resumed or scheduled there. */
  limit_elsewhere: number;
  /**
   * Claude Code's `/goal` on this thread's session (packages/shared/goal.ts): the condition, active or complete, and how
   * many checks found it unmet. Null objective: none. Local only, not synced: the goal lives in this machine's session.
   */
  goal_objective: string | null;
  goal_status: GoalStatus | null;
  goal_checks: number;
  /** The thread this one continues on another harness (apps/server/continue.ts), null for most. Not a crew parent. Synced. */
  continued_from: string | null;
  /** 1 while it is a quick ask (packages/shared/quick-ask.ts): no charter, worktree, folder or task id, and out of every list but Recent asks. Synced. */
  quick: number;
  /** What its agent may touch: `none`, `read` or `worktree`. Null for a thread from before quick asks: the channel's folder, as always. Synced. */
  workspace: ThreadWorkspace | null;
  /** The task thread a quick ask turned into, with the answer carried over. Synced. */
  promoted_to: string | null;
  /**
   * The person accountable for the thread, as a name; null is the install's own user. Separate from the agent doing
   * the work (`role` on `harness`), as an issue's assignee is from its delegate. A delegated thread starts with its
   * parent's. Synced, merged by its own edit time.
   */
  owner: string | null;
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
  /** Ben chose to start with fresh context on the same run, not a switch (runner/fresh-context.ts). */
  fresh?: true;
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
  handover: { from: RunName; since: string | null; started?: boolean; fresh?: true } | null;
}
const uidOf = (id: number) => (db.prepare('SELECT uid FROM events WHERE id = ?').get(id) as { uid: string } | undefined)?.uid ?? '';
const idOf = (uid: string) => (db.prepare('SELECT id FROM events WHERE uid = ?').get(uid) as { id: number } | undefined)?.id ?? 1;
const parsed = <T>(json: string | null): T | null => (json ? (JSON.parse(json) as T) : null);

function storedSessions(s: Sessions | null | undefined): StoredSessionState['sessions'] {
  const entries = Object.entries(s ?? {}).filter((e): e is [string, PastSession] => !!e[1]);
  return entries.length ? Object.fromEntries(entries.map(([h, p]) => [h, { id: p.id, seen: uidOf(p.seen) }])) : null;
}
const storedHandover = (h: PendingHandover | null | undefined): StoredSessionState['handover'] =>
  h ? { from: h.from, since: h.since ? uidOf(h.since) : null, ...(h.started && { started: true }), ...(h.fresh && { fresh: true }) } : null;
const readSessions = (s: StoredSessionState['sessions']): Sessions =>
  Object.fromEntries(Object.entries(s ?? {}).flatMap(([h, p]) => (p ? [[h, { id: p.id, seen: idOf(p.seen) }]] : [])));
const readHandover = (h: StoredSessionState['handover']): PendingHandover | null => (h ? { from: h.from, since: h.since ? idOf(h.since) : 0, ...(h.started && { started: true }), ...(h.fresh && { fresh: true }) } : null);
/** Drops the goal when the session id changes; SET reads the row's old values. */
const GOAL_RESET =
  'goal_objective = CASE WHEN session_id IS ? THEN goal_objective END, goal_status = CASE WHEN session_id IS ? THEN goal_status END, goal_checks = CASE WHEN session_id IS ? THEN goal_checks ELSE 0 END';
const json = (v: object | null) => (v ? JSON.stringify(v) : null);

/**
 * Metadata fields a sync change merges one by one, by the time each was last edited, and `exec`, `session` and
 * `queued` for the execution fields, the session fields and the queued run as groups (sync/thread-merge.ts).
 */
export type EditedField = 'title' | 'archived' | 'folder_id' | 'pinned_at' | 'done_at' | 'owner' | 'exec' | 'session' | 'queued';

/**
 * Note that these fields of the thread were edited here now, so a sync change with an older edit of one of them
 * leaves it alone. Call it inside the write's tx. `where` narrows it, e.g. to a row whose done_at is still set.
 */
export function stampEdits(id: string, fields: readonly EditedField[], where = '') {
  if (!fields.length) return;
  const row = db.prepare(`SELECT field_edits FROM threads WHERE id = ? ${where}`).get(id) as { field_edits: string | null } | undefined;
  if (!row) return;
  let edits: Partial<Record<EditedField, string>> = {};
  try {
    edits = row.field_edits ? JSON.parse(row.field_edits) : {};
  } catch {
    // A broken record starts again from this edit.
  }
  const at = now();
  // An edit here always comes after the last one the field took, as record() does for the row: one from a Mac whose
  // clock runs ahead would otherwise keep winning over the edit made after it.
  for (const f of fields) {
    const last = edits[f];
    edits[f] = last && at <= last ? new Date(Date.parse(last) + 1).toISOString() : at;
  }
  db.prepare('UPDATE threads SET field_edits = ? WHERE id = ?').run(JSON.stringify(edits), id);
}

/** The columns clients read, without sync's run_machine, the limit stop's id and owner, or the session state. */
export const THREAD_COLUMNS =
  'id, channel_id, title, status, role, model, harness, effort, auto_reason, queued_harness, queued_model, queued_effort, session_id, has_run, cwd, branch, parent_id, task_id, source, automation, last_text, suggestion, next_title, next_prompt, open_items, archived, folder_id, pinned_at, done_at, setup, setup_error, resume_blocked, limit_state, limit_resets_at, limit_elsewhere, goal_objective, goal_status, goal_checks, continued_from, quick, workspace, promoted_to, owner, created_at, updated_at';

/**
 * The machine whose status write this is: this one while it is running or queued here and sync is set up, else nobody.
 * A tag on the row for the status merge (sync/handlers/thread.ts) and the result trigger (db/migrate.ts), not who owns
 * the thread: that is the assignment (db/repos/assignments.ts), which the same write claims.
 */
const runMachine = (status: ThreadStatus) => (status === 'running' || status === 'queued' ? outbox.machineId() : null);

export const threads = {
  get: (id: string) => db.prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE id = ?`).get(id) as unknown as Thread | undefined,
  /** Exact branch owners in a GitHub repo, including archived threads and channels sharing that repo. */
  byRepoBranch: (repo: string, branch: string) =>
    db
      .prepare(`SELECT ${THREAD_COLUMNS.split(', ').map((c) => `t.${c}`).join(', ')}
      FROM threads t JOIN channels c ON c.id = t.channel_id
      WHERE c.github_repo = ? COLLATE NOCASE AND t.branch = ? ORDER BY t.created_at, t.rowid`)
      .all(repo, branch) as unknown as Thread[],
  /** A channel's threads, without team members: those are listed under their lead. */
  byChannel: (channelId: string, limit = 200, archived = false) =>
    db
      .prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE channel_id = ? AND source NOT IN ('team', 'member') AND quick = 0 AND archived = ? ORDER BY updated_at DESC LIMIT ?`)
      .all(channelId, archived ? 1 : 0, limit) as unknown as Thread[],
  /**
   * One page of a channel's threads, newest first, after `after` (the last row of the page before). The clients page
   * a channel screen with it (GET /api/channels/:id/threads?paged=1), so threads past the sidebar's preview are there.
   */
  byChannelPage: (channelId: string, opts: { limit: number; archived?: boolean; after?: { updated_at: string; id: string } | null }) => {
    const after = opts.after ?? null;
    return db
      .prepare(
        `SELECT ${THREAD_COLUMNS} FROM threads WHERE channel_id = ? AND source NOT IN ('team', 'member') AND quick = 0 AND archived = ?
         AND (? IS NULL OR updated_at < ? OR (updated_at = ? AND id < ?)) ORDER BY updated_at DESC, id DESC LIMIT ?`,
      )
      .all(channelId, opts.archived ? 1 : 0, after?.updated_at ?? null, after?.updated_at ?? null, after?.updated_at ?? null, after?.id ?? null, opts.limit) as unknown as Thread[];
  },
  recent: (limit = 50) =>
    db.prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE archived = 0 AND quick = 0 AND source != 'member' ORDER BY updated_at DESC LIMIT ?`).all(limit) as unknown as Thread[],
  /** The threads delegated from this one. A group thread's member threads are its agents' sessions, not delegations (runner/members.ts). */
  children: (parentId: string) =>
    db.prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE parent_id = ? AND source != 'member' ORDER BY created_at`).all(parentId) as unknown as Thread[],
  /** Work opened by a #conductor thread's seated agents, including seats that have since been removed. */
  seatedDelegations: (threadId: string) =>
    db.prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE source != 'member' AND parent_id IN (
      SELECT id FROM threads WHERE parent_id = ? AND source = 'member' AND channel_id = 'conductor'
    ) ORDER BY created_at`).all(threadId) as unknown as Thread[],
  /** The transcript a seated agent opened the work from. The hidden session remains its parent for crew reports. */
  seatedDelegationOf: (child: Pick<Thread, 'parent_id' | 'source'>) =>
    child.parent_id && child.source !== 'member'
      ? db.prepare(`SELECT parent_id AS thread_id, role AS agent FROM threads
          WHERE id = ? AND source = 'member' AND channel_id = 'conductor' AND parent_id IS NOT NULL AND role IS NOT NULL`)
          .get(child.parent_id) as unknown as SeatedDelegation | undefined
      : undefined,
  /** The threads working on a branch, newest first. Omni names branches per thread, so it is one in practice. */
  withBranch: (branch: string) =>
    db.prepare(`SELECT ${THREAD_COLUMNS} FROM threads WHERE branch = ? ORDER BY created_at DESC, rowid DESC`).all(branch) as unknown as Thread[],
  /** Every thread delegated from this one at any depth, team members under their lead included, oldest first. */
  descendants: (id: string) =>
    db
      .prepare(
        `WITH RECURSIVE under(id) AS (SELECT id FROM threads WHERE parent_id = ? UNION SELECT t.id FROM threads t JOIN under ON t.parent_id = under.id)
         SELECT ${THREAD_COLUMNS} FROM threads WHERE id IN (SELECT id FROM under) AND id != ? ORDER BY created_at, rowid`,
      )
      .all(id, id) as unknown as Thread[],
  /** The ids of the threads above this one in its delegation chain, without itself. UNION drops a cycle. */
  ancestors: (id: string) =>
    (
      db
        .prepare(
          `WITH RECURSIVE up(id) AS (SELECT parent_id FROM threads WHERE id = ? AND parent_id IS NOT NULL
             UNION SELECT t.parent_id FROM threads t JOIN up ON t.id = up.id WHERE t.parent_id IS NOT NULL)
           SELECT id FROM up WHERE id != ?`,
        )
        .all(id, id) as { id: string }[]
    ).map((r) => r.id),
  /**
   * The top of this thread's delegation chain: the thread the user delegated from, where its crew's questions wait on them.
   * Itself when nothing delegated it, and the highest one here when an ancestor has not synced to this Mac.
   */
  root: (id: string) =>
    (
      db
        .prepare(
          `WITH RECURSIVE up(id, parent_id, depth) AS (SELECT id, parent_id, 0 FROM threads WHERE id = ?
             UNION ALL SELECT t.id, t.parent_id, up.depth + 1 FROM threads t JOIN up ON t.id = up.parent_id WHERE up.depth < 32)
           SELECT id FROM up ORDER BY depth DESC LIMIT 1`,
        )
        .get(id) as { id: string } | undefined
    )?.id ?? id,
  /**
   * Where the user answers a delegated thread's questions: the top of its delegation chain (root), then the newest thread that
   * continues it (continue.ts), and so on, since the user works on in the newest and its crew cards show there. The walk goes
   * through archived threads (cleanup archives the middle of a chain), preferring a live continuation at each step, and
   * ends on the last live thread it passed, or the root when none is live. A thread nobody delegated is its own home: its
   * card shows only on itself.
   */
  home(id: string): string {
    const root = threads.root(id);
    if (root === id) return id;
    const next = db.prepare('SELECT id, archived FROM threads WHERE continued_from = ? ORDER BY archived, created_at DESC, rowid DESC LIMIT 1');
    const seen = new Set<string>([root]);
    let live = threads.get(root)?.archived ? null : root;
    for (let at = next.get(root) as { id: string; archived: number } | undefined; at && !seen.has(at.id); at = next.get(at.id) as typeof at) {
      seen.add(at.id);
      if (!at.archived) live = at.id;
    }
    return live ?? root;
  },
  /**
   * Threads delegated from Conductor jobs, kept visible beside their parent in the originating channel, with `job_id`:
   * the #conductor thread they nest under. Work a seated agent opened has its hidden session as parent (crew reports go
   * there, runner/members.ts), so it nests under the thread that agent is seated in, as its delegation card does.
   */
  conductorHandoffChildren: () =>
    db
      .prepare(
        `SELECT ${THREAD_COLUMNS.split(', ').map((c) => `child.${c}`).join(', ')}, job.id AS job_id
         FROM threads child JOIN threads parent ON parent.id = child.parent_id
         JOIN threads job ON job.id = CASE WHEN parent.source = 'member' THEN parent.parent_id ELSE parent.id END
         WHERE parent.channel_id = 'conductor' AND job.channel_id = 'conductor' AND job.source != 'member' AND job.archived = 0
           AND child.source = 'conductor' AND child.archived = 0
         ORDER BY job.updated_at DESC, child.created_at ASC`,
      )
      .all() as unknown as (Thread & { job_id: string })[],
  /** Every live team member whose lead is live too, by lead, in the order they were handed out. */
  teamMembers: () =>
    db
      .prepare(
        `SELECT ${THREAD_COLUMNS.split(', ').map((c) => `m.${c}`).join(', ')}
         FROM threads m JOIN threads lead ON lead.id = m.parent_id
         WHERE m.source = 'team' AND m.archived = 0 AND lead.archived = 0
         ORDER BY lead.updated_at DESC, m.created_at ASC`,
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
        `SELECT ${THREAD_COLUMNS} FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY updated_at DESC, created_at DESC, id) AS n FROM threads WHERE source NOT IN ('team', 'member') AND quick = 0 AND archived = 0) WHERE n <= ?`,
      )
      .all(perChannel) as unknown as Thread[],
  /** Threads in a folder of their own channel, newest first, without archived ones and team members. */
  filed: (channelId?: string) =>
    db
      .prepare(
        `SELECT ${THREAD_COLUMNS.split(', ').map((c) => `t.${c}`).join(', ')} FROM threads t JOIN folders f ON f.id = t.folder_id AND f.channel_id = t.channel_id
         WHERE t.archived = 0 AND t.source NOT IN ('team', 'member') AND t.quick = 0 ${channelId ? 'AND t.channel_id = ?' : ''} ORDER BY t.updated_at DESC`,
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
  /**
   * The threads with a delegated thread running or queued below them, at any depth (apps/server/delegating.ts), a
   * group thread whose member runs counting as running for the threads above it (its own mark comes from its members), and
   * the threads in `agentHosts` (whose own sub-agents still run) with every thread above them. A host whose turn was
   * stopped or failed counts for nothing. An archived thread pins nothing. UNION drops an id met again, so a parent_id
   * cycle ends.
   */
  delegating: (agentHosts: readonly string[] = []) =>
    (
      db
        .prepare(
          `WITH RECURSIVE up(id) AS (
             SELECT parent_id FROM threads WHERE status IN ('running','queued') AND archived = 0 AND parent_id IS NOT NULL AND source != 'member'
             UNION SELECT g.parent_id FROM threads m JOIN threads g ON g.id = m.parent_id
               WHERE m.source = 'member' AND m.status IN ('running','queued') AND m.archived = 0 AND g.archived = 0 AND g.parent_id IS NOT NULL
             UNION SELECT id FROM threads WHERE id IN (SELECT value FROM json_each(?)) AND status NOT IN ('stopped','failed') AND archived = 0
             UNION SELECT t.parent_id FROM threads t JOIN up ON t.id = up.id WHERE t.parent_id IS NOT NULL)
           SELECT id FROM up`,
        )
        .all(JSON.stringify(agentHosts)) as { id: string }[]
    ).map((r) => r.id),
  /** The machine that wrote the thread's running or queued status (sync), or null. For the status merge; ownership reads the assignment. */
  runMachine: (id: string) =>
    (db.prepare('SELECT run_machine FROM threads WHERE id = ?').get(id) as { run_machine: string | null } | undefined)?.run_machine ?? null,
  list(filter: { channel?: string; status?: string; limit?: number }) {
    const where: string[] = ['archived = 0', 'quick = 0', "source != 'member'"];
    const args: (string | number)[] = [];
    if (filter.channel) (where.push('channel_id = ?'), args.push(filter.channel));
    if (filter.status) (where.push('status = ?'), args.push(filter.status));
    args.push(filter.limit ?? 30);
    return db
      .prepare(`SELECT ${THREAD_COLUMNS} FROM threads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT ?`)
      .all(...args) as unknown as Thread[];
  },
  /**
   * Quick asks from the last `days` days, newest first: Recent asks. One that turned into a task or was kept stays listed
   * with it, so the ask is still found where it was made.
   */
  recentAsks: (days = 7, limit = 50) =>
    db
      .prepare(
        `SELECT ${THREAD_COLUMNS} FROM threads WHERE archived = 0 AND source != 'member' AND (quick = 1 OR promoted_to IS NOT NULL) AND created_at >= ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(new Date(Date.now() - days * 86_400_000).toISOString(), limit) as unknown as Thread[],
  /** Kept as a thread (`keep`) or turned into one (`promoted_to`): out of Recent asks' quick state, into the lists. */
  setQuick(id: string, patch: { quick: 0 | 1; promoted_to?: string | null }) {
    const sets = ['quick = ?', 'updated_at = ?'];
    const vals: (string | number | null)[] = [patch.quick, now()];
    if (patch.promoted_to !== undefined) (sets.push('promoted_to = ?'), vals.push(patch.promoted_to));
    const changed = db.prepare(`UPDATE threads SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id).changes > 0;
    if (changed) record('thread', id);
    return changed;
  },
  create(
    t: Omit<
      Thread,
      'created_at' | 'updated_at' | 'has_run' | 'last_text' | 'suggestion' | 'next_title' | 'next_prompt' | 'open_items' | 'harness' | 'effort' | 'auto_reason' | 'queued_harness' | 'queued_model' | 'queued_effort' | 'archived' | 'folder_id' | 'pinned_at' | 'done_at' | 'setup' | 'setup_error' | 'resume_blocked' | 'limit_state' | 'limit_resets_at' | 'limit_elsewhere' | 'goal_objective' | 'goal_status' | 'goal_checks' | 'continued_from' | 'quick' | 'workspace' | 'promoted_to' | 'owner'
    > & {
      has_run?: number; created_at?: string; harness?: string; effort?: string; auto_reason?: string | null; folder_id?: string | null; setup?: ThreadSetup | null;
      quick?: number; workspace?: ThreadWorkspace | null; owner?: string | null;
    },
  ) {
    const ts = t.created_at ?? now();
    return tx(() => {
      db.prepare(
        `INSERT INTO threads (id, channel_id, title, status, role, model, harness, effort, auto_reason, session_id, has_run, cwd, branch, parent_id, task_id, source, automation, run_machine, folder_id, setup, quick, workspace, owner, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        t.id, t.channel_id, t.title, t.status, t.role, t.model, t.harness ?? 'claude-code', t.effort ?? '', t.auto_reason ?? null, t.session_id, t.has_run ?? 0, t.cwd,
        t.branch, t.parent_id, t.task_id, t.source, t.automation, runMachine(t.status), t.folder_id ?? null, t.setup ?? null, t.quick ?? 0, t.workspace ?? null, t.owner ?? null, ts, ts,
      );
      record('thread', t.id);
      if (runMachine(t.status)) assignments.claim(t.id);
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
    const allowed = ['title', 'status', 'model', 'harness', 'effort', 'auto_reason', 'queued_harness', 'queued_model', 'queued_effort', 'session_id', 'has_run', 'cwd', 'branch', 'last_text', 'archived', 'setup', 'setup_error', 'resume_blocked', 'updated_at'] as const;
    const keys = allowed.filter((k) => k in patch);
    const sets = keys.map((k) => `${k} = ?`);
    const vals = keys.map((k) => (patch[k] ?? null) as string | number | null);
    if ('sessions' in patch) (sets.push('sessions = ?'), vals.push(json(storedSessions(patch.sessions))));
    if ('handover' in patch) (sets.push('handover = ?'), vals.push(json(storedHandover(patch.handover))));
    if (!('updated_at' in patch)) (sets.push('updated_at = ?'), vals.push(now()));
    // A new session starts without the old one's goal.
    if (patch.session_id) (sets.push(GOAL_RESET), vals.push(patch.session_id, patch.session_id, patch.session_id));
    // Every status write says who runs the thread, so the row itself tells the other Mac (apps/server/sync/guard.ts).
    if (patch.status) (sets.push('run_machine = ?'), vals.push(runMachine(patch.status)));
    // A run starting, or Ben retrying its setup, is news: a thread marked done comes back to Needs you when it ends.
    if (patch.status === 'running' || patch.status === 'queued' || patch.setup === 'preparing') sets.push('done_at = NULL');
    tx(() => {
      // Clearing done_at for a run is an edit of it, but only when it was set.
      if (sets.includes('done_at = NULL')) stampEdits(id, ['done_at'], 'AND done_at IS NOT NULL');
      if (!db.prepare(`UPDATE threads SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id).changes) return;
      const exec = ['status', 'has_run', 'last_text'].some((k) => k in patch);
      const session = ['session_id', 'sessions', 'handover'].some((k) => k in patch);
      const queued = ['queued_harness', 'queued_model', 'queued_effort'].some((k) => k in patch);
      stampEdits(id, [
        ...(['title', 'archived'] as const).filter((k) => k in patch),
        ...(exec ? (['exec'] as const) : []),
        ...(session ? (['session'] as const) : []),
        ...(queued ? (['queued'] as const) : []),
      ]);
      record('thread', id);
      // A turn starting here makes this machine the thread's owner (the same machine again changes nothing).
      if (patch.status && runMachine(patch.status)) assignments.claim(id);
    });
    return threads.get(id);
  },
  /**
   * Pin it to the sidebar, or unpin it. Like a rename it keeps the thread's place in the lists: updated_at stays. The
   * row syncs, so the other Mac pins it too. True when it changed.
   */
  /** Who is accountable for it: a person's name, or null for the install's own user. Syncs. True when it changed. */
  setOwner(id: string, owner: string | null) {
    return tx(() => {
      const changed = db.prepare('UPDATE threads SET owner = ? WHERE id = ? AND owner IS NOT ?').run(owner, id, owner).changes > 0;
      if (changed) (stampEdits(id, ['owner']), record('thread', id));
      return changed;
    });
  },
  setPinned(id: string, pinned: boolean) {
    return tx(() => {
      const changed =
        db.prepare(`UPDATE threads SET pinned_at = ? WHERE id = ? AND (pinned_at IS NULL) = ?`).run(pinned ? now() : null, id, pinned ? 1 : 0).changes > 0;
      if (changed) (stampEdits(id, ['pinned_at']), record('thread', id));
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
      if (changed) (stampEdits(id, ['done_at']), record('thread', id));
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
  /** Its goal, or null to drop it. Like the suggestion: updated_at stays and sync never hears of it. True when it changed. */
  setGoal(id: string, g: Goal | null) {
    const objective = g?.objective ?? null;
    const status = g?.status ?? null;
    const checks = g?.checks ?? 0;
    return (
      db
        .prepare(
          `UPDATE threads SET goal_objective = ?, goal_status = ?, goal_checks = ?
           WHERE id = ? AND (goal_objective IS NOT ? OR goal_status IS NOT ? OR goal_checks IS NOT ?)`,
        )
        .run(objective, status, checks, id, objective, status, checks).changes > 0
    );
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
  /** What the last turn left open, as stored JSON, or null to drop it. Like the suggestion: updated_at stays and sync never hears of it. */
  setOpenItems(id: string, json: string | null) {
    return db.prepare('UPDATE threads SET open_items = ? WHERE id = ? AND open_items IS NOT ?').run(json, id, json).changes > 0;
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
      if (db.prepare('UPDATE threads SET channel_id = ?, folder_id = NULL WHERE id = ?').run(channelId, id).changes) (stampEdits(id, ['folder_id']), record('thread', id));
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
      for (const { id } of ids) (fail.run(id), stampEdits(id, ['exec']), record('thread', id));
      return ids.length;
    });
  },
};
