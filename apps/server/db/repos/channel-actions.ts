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
  create(channelId: string, input: Required<ChannelActionInput>): ChannelAction {
    const id = randomUUID();
    const ts = now();
    const { n } = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS n FROM channel_actions WHERE channel_id = ?').get(channelId) as { n: number };
    db.prepare(
      'INSERT INTO channel_actions (id, channel_id, name, command, secrets, port, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, channelId, input.name, input.command, JSON.stringify(input.secrets), input.port, n, ts, ts);
    return channelActions.get(id)!;
  },
  update(id: string, input: Required<ChannelActionInput>): ChannelAction | undefined {
    db.prepare('UPDATE channel_actions SET name = ?, command = ?, secrets = ?, port = ?, updated_at = ? WHERE id = ?').run(
      input.name,
      input.command,
      JSON.stringify(input.secrets),
      input.port,
      now(),
      id,
    );
    return channelActions.get(id);
  },
  delete: (id: string) => db.prepare('DELETE FROM channel_actions WHERE id = ?').run(id).changes > 0,
};

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
