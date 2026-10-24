import { randomUUID } from 'node:crypto';
import type { ActionRun, ActionRunState, ChannelAction, ChannelActionInput } from '@omni/shared/channel-actions.ts';
import { db, now } from '../connection.ts';

type ActionRow = Omit<ChannelAction, 'secrets'> & { secrets: string };
const action = (r: ActionRow | undefined): ChannelAction | undefined => r && { ...r, secrets: JSON.parse(r.secrets) as string[] };

/** A channel's named actions (apps/server/actions.ts), in the order the editor lists them. Local to this Mac. */
export const channelActions = {
  list: (channelId: string) =>
    (db.prepare('SELECT * FROM channel_actions WHERE channel_id = ? ORDER BY position, created_at').all(channelId) as unknown as ActionRow[]).map((r) => action(r)!),
  get: (id: string) => action(db.prepare('SELECT * FROM channel_actions WHERE id = ?').get(id) as unknown as ActionRow | undefined),
  byName: (channelId: string, name: string) =>
    action(db.prepare('SELECT * FROM channel_actions WHERE channel_id = ? AND name = ?').get(channelId, name) as unknown as ActionRow | undefined),
  /** The action the channel runs to set up each new worktree, if it has one. */
  setupFor: (channelId: string) =>
    action(db.prepare('SELECT * FROM channel_actions WHERE channel_id = ? AND setup IS NOT NULL').get(channelId) as unknown as ActionRow | undefined),
  create(channelId: string, input: Required<ChannelActionInput>): ChannelAction {
    const id = randomUUID();
    const ts = now();
    const { n } = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS n FROM channel_actions WHERE channel_id = ?').get(channelId) as { n: number };
    if (input.setup) clearSetup(channelId);
    db.prepare(
      'INSERT INTO channel_actions (id, channel_id, name, command, secrets, port, setup, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, channelId, input.name, input.command, JSON.stringify(input.secrets), input.port, input.setup, n, ts, ts);
    return channelActions.get(id)!;
  },
  update(id: string, input: Required<ChannelActionInput>): ChannelAction | undefined {
    const channelId = channelActions.get(id)?.channel_id;
    if (input.setup && channelId) clearSetup(channelId, id);
    db.prepare('UPDATE channel_actions SET name = ?, command = ?, secrets = ?, port = ?, setup = ?, updated_at = ? WHERE id = ?').run(
      input.name,
      input.command,
      JSON.stringify(input.secrets),
      input.port,
      input.setup,
      now(),
      id,
    );
    return channelActions.get(id);
  },
  delete: (id: string) => db.prepare('DELETE FROM channel_actions WHERE id = ?').run(id).changes > 0,
};

/** A channel has one setup action at most: making another one it takes the role off the rest. */
const clearSetup = (channelId: string, except = '') =>
  db.prepare('UPDATE channel_actions SET setup = NULL, updated_at = ? WHERE channel_id = ? AND setup IS NOT NULL AND id != ?').run(now(), channelId, except);

/** Runs kept per thread. Older ones are dropped when a new one starts. */
const KEPT_RUNS = 20;

/** Each run of an action in a thread, with its state and output tail. Local to this Mac, like the process. */
export const actionRuns = {
  get: (id: string) => db.prepare('SELECT * FROM action_runs WHERE id = ?').get(id) as unknown as ActionRun | undefined,
  byThread: (threadId: string) =>
    db.prepare('SELECT * FROM action_runs WHERE thread_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?').all(threadId, KEPT_RUNS) as unknown as ActionRun[],
  running: () => db.prepare(`SELECT * FROM action_runs WHERE state = 'running'`).all() as unknown as ActionRun[],
  create(run: Pick<ActionRun, 'thread_id' | 'action_id' | 'name' | 'command' | 'cwd' | 'port'>): ActionRun {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO action_runs (id, thread_id, action_id, name, command, cwd, port, state, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
    ).run(id, run.thread_id, run.action_id, run.name, run.command, run.cwd, run.port, now());
    db.prepare(
      `DELETE FROM action_runs WHERE thread_id = ? AND state != 'running'
       AND id NOT IN (SELECT id FROM action_runs WHERE thread_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?)`,
    ).run(run.thread_id, run.thread_id, KEPT_RUNS);
    return actionRuns.get(id)!;
  },
  output: (id: string, output: string, bytes: number) => db.prepare('UPDATE action_runs SET output = ?, output_bytes = ? WHERE id = ?').run(output, bytes, id),
  /** Settle a run that is still running. A run that already ended keeps its end. */
  finish(id: string, end: { state: Exclude<ActionRunState, 'running'>; exit_code?: number | null; error?: string | null }) {
    db.prepare(`UPDATE action_runs SET state = ?, exit_code = ?, error = ?, ended_at = ? WHERE id = ? AND state = 'running'`).run(
      end.state,
      end.exit_code ?? null,
      end.error ?? null,
      now(),
      id,
    );
    return actionRuns.get(id)!;
  },
};

/**
 * The setup action's run in each thread's latest worktree preparation (apps/server/runner/setup-action.ts). A new
 * attempt clears it, so a thread's card never shows an earlier attempt's run as the current one.
 */
export const threadSetupRuns = {
  get: (threadId: string) => (db.prepare('SELECT run_id FROM thread_setup_runs WHERE thread_id = ?').get(threadId) as { run_id: string } | undefined)?.run_id,
  set: (threadId: string, runId: string) => db.prepare('INSERT OR REPLACE INTO thread_setup_runs (thread_id, run_id) VALUES (?, ?)').run(threadId, runId),
  clear: (threadId: string) => db.prepare('DELETE FROM thread_setup_runs WHERE thread_id = ?').run(threadId),
};
