// Named commands a channel's threads can run in their checkout: Theme preview, Theme check, Tests. Server and web
// share these shapes; the Mac app mirrors them (OmniKit ChannelActions.swift) and the fixtures in
// apps/server/tests/mac-fixtures.test.ts hold both to the same JSON.

/**
 * One action in a channel's settings. Only the command and the names of the secrets it needs are stored, never a
 * secret's value: the command reads them as `$NAME`, resolved from the Keychain when it runs.
 */
export interface ChannelAction {
  id: string;
  channel_id: string;
  /** What the run button says: "Theme preview". Unique in the channel. */
  name: string;
  /** Run by Ben's login shell in the thread's checkout. `$OMNI_PORT` is the run's port when it has one. */
  command: string;
  /** Secrets the command reads, by name: channel scope first, then global. */
  secrets: string[];
  /**
   * The port the run serves on. null: none. 0: Omni picks a free one per run, so two threads previewing at once
   * never share it. A number: always that one, and a second run while it is taken is refused.
   */
  port: number | null;
  position: number;
  created_at: string;
  updated_at: string;
}

/** What a client sends to create or change an action. */
export interface ChannelActionInput {
  name: string;
  command: string;
  secrets?: string[];
  port?: number | null;
}

export type ActionRunState = 'running' | 'succeeded' | 'failed' | 'stopped';

/** One run of an action in one thread. It keeps the name and command it ran, so editing the action later changes nothing here. */
export interface ActionRun {
  id: string;
  thread_id: string;
  /** Null once the action is deleted. */
  action_id: string | null;
  name: string;
  command: string;
  cwd: string;
  /** The port it was given, as `$OMNI_PORT` and `$PORT`. */
  port: number | null;
  state: ActionRunState;
  /** The exit status of a run that exited on its own. */
  exit_code: number | null;
  /** Why it failed or stopped when the output does not say: it could not start, Ben stopped it, Omni restarted. */
  error: string | null;
  /** The last OUTPUT_LIMIT characters of stdout and stderr together, colour codes removed. */
  output: string;
  /** How many bytes it printed in all, so a client can say when the start was cut. */
  output_bytes: number;
  started_at: string;
  ended_at: string | null;
}

/** GET /api/threads/:id/actions: the channel's actions, the thread's latest runs, and why none can run now. */
export interface ThreadActions {
  actions: ChannelAction[];
  runs: ActionRun[];
  /** Set while the thread cannot run one: its worktree is being prepared, failed, or it runs off this Mac. */
  blocked: string | null;
}

/** How many characters of a run's output are kept: the end, where a failure says why. */
export const OUTPUT_LIMIT = 64 * 1024;

export const RUN_STATE_LABEL: Record<ActionRunState, string> = {
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  stopped: 'Stopped',
};

/** The port setting in words, for the editor and a run's line. */
export function portLabel(port: number | null): string {
  if (port === null) return 'No port';
  return port === 0 ? 'A free port per run' : `Port ${port}`;
}
