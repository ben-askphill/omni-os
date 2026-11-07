// Named commands a channel's threads can run in their checkout: Theme preview, Theme check, Tests. Server and web
// share these shapes, and the fixtures in apps/server/tests/wire-fixtures.test.ts record their JSON.

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
  /**
   * Set on the one action the channel runs in each new worktree, once per preparation attempt: `blocking` before the
   * agent starts, which waits for it to succeed, or `background` alongside the agent. Null on every other action.
   */
  setup: SetupMode | null;
  position: number;
  created_at: string;
  updated_at: string;
}

/** How a channel's setup action runs in a new worktree: before the agent starts, or alongside it. */
export type SetupMode = 'blocking' | 'background';

export const SETUP_MODE_LABEL: Record<SetupMode, string> = {
  blocking: 'Before the agent starts',
  background: 'Alongside the agent',
};

/** What a client sends to create or change an action. */
export interface ChannelActionInput {
  name: string;
  command: string;
  secrets?: string[];
  port?: number | null;
  /** Make it the channel's setup action, or not. Setting it on one action takes it off any other. */
  setup?: SetupMode | null;
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
  /**
   * The setup action's run in the thread's latest worktree preparation, null before it starts or when the channel
   * has none. While the thread is preparing it is the step between the checkout and the agent.
   */
  setup_run: ActionRun | null;
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

export const anyRunning = (data: ThreadActions | undefined) => !!data?.runs.some((r) => r.state === 'running');

/** The run of this action still going in the thread, if any. Runs come newest first. */
export const liveRun = (data: ThreadActions, action: ChannelAction) => data.runs.find((r) => r.action_id === action.id && r.state === 'running');

export function withRun(data: ThreadActions, run: ActionRun): ThreadActions {
  const runs = data.runs.some((r) => r.id === run.id) ? data.runs.map((r) => (r.id === run.id ? run : r)) : [run, ...data.runs];
  return { ...data, runs, setup_run: data.setup_run?.id === run.id ? run : data.setup_run };
}

// ---------- the channel settings editor ----------

export type PortMode = 'none' | 'free' | 'fixed';

/** The editor's fields as typed. `port` is the fixed port's text, kept while another mode is picked. */
export interface ActionDraft {
  name: string;
  command: string;
  secrets: string;
  portMode: PortMode;
  port: string;
  setup: SetupMode | null;
}

export function draftOf(a?: ChannelAction): ActionDraft {
  return {
    name: a?.name ?? '',
    command: a?.command ?? '',
    secrets: a?.secrets.join(', ') ?? '',
    portMode: a?.port == null ? 'none' : a.port === 0 ? 'free' : 'fixed',
    port: a?.port ? String(a.port) : '',
    setup: a?.setup ?? null,
  };
}

/** Secret names as typed: comma or space separated, upper-cased, each once. */
export const parseSecrets = (text: string) => [...new Set(text.toUpperCase().split(/[\s,]+/).filter(Boolean))];

/**
 * What POST or PATCH sends, always with `setup`: PATCH replaces the whole action, so leaving it out would clear it.
 * The server checks the rest; this only catches a fixed port with no number, which would read as 0.
 */
export function actionInput(d: ActionDraft): { input: ChannelActionInput } | { error: string } {
  let port: number | null = null;
  if (d.portMode === 'free') port = 0;
  if (d.portMode === 'fixed') {
    if (!/^\d+$/.test(d.port.trim()) || Number(d.port) === 0) return { error: 'Give the fixed port a number, like 9292.' };
    port = Number(d.port);
  }
  return { input: { name: d.name.trim(), command: d.command.trim(), secrets: parseSecrets(d.secrets), port, setup: d.setup } };
}

/** What each "Run in new worktrees" choice does, under the editor's picker. */
export const ACTION_SETUP_HINT: Record<SetupMode | 'off', string> = {
  off: "Runs only from a thread's Actions tab. One action in the channel can also run in each new worktree.",
  blocking:
    'Runs once in each new worktree and holds the agent until it succeeds. If it fails, the thread stops at Setup failed with Retry setup. Never on Hermes, Cursor Cloud or a shared checkout.',
  background: 'Runs once in each new worktree while the agent starts. If it fails, the thread says so and the agent keeps going. Never on Hermes, Cursor Cloud or a shared checkout.',
};

/** What each port choice does, under the editor's picker. */
export const ACTION_PORT_HINT: Record<PortMode, string> = {
  none: 'The command serves nothing.',
  free: 'Omni picks a free port each run, so two threads can preview at once. The command reads it as $OMNI_PORT.',
  fixed: 'Always this port. A second run while it is taken is refused.',
};
