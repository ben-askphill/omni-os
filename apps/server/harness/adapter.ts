// The harness adapter interface the runner drives. The runner keeps everything that
// isn't harness-specific — queueing, send modes, keepalive, slots, crew reports, titles,
// events and the feed — and each adapter owns its CLI's process (if it has one) and protocol,
// translating Omni's messages into it and its output into Omni's records.
import type { SlashCommand } from '@omni/shared/slash.ts';
import type { Channel, Thread } from '../db.ts';
import type { CrewRole } from '../crew.ts';
import type { ContextUsage, CursorTurnUsage } from '@omni/shared/context-meter.ts';
import type { ContextHint, Record as StreamRecord, Usage } from '../stream.ts';
import type { Attachment } from '../uploads.ts';
import type { HarnessCapabilities, HarnessId } from './types.ts';

/** Everything an adapter needs to start a thread's process. */
export interface AdapterContext {
  thread: Thread;
  channel: Channel;
  role?: CrewRole;
  /** Omni's context (channel facts, role charter, artifacts, secrets note). */
  systemPrompt: string;
  /** Per-thread MCP config file, when one was written. */
  mcpFile: string | null;
  /** Channel and global secret values. */
  secretEnv: Record<string, string>;
  /** Another thread already holds the channel's browser profile. */
  browserBusy: boolean;
  /** The channel browser Omni runs, for the browser MCP to attach to. */
  cdpEndpoint?: string | null;
  omniUrl: string;
  /** Whether the CLI should resume its stored session rather than start fresh. */
  resume: boolean;
  /** A switched session still needs its history, including a retry into an empty native session. */
  handoverPending?: boolean;
}

/** A harness command a message names, resolved when it was sent. `end` is exclusive. */
export interface CommandUse {
  name: string;
  /** Where `/name` sits in the text, as typed (it may be an alias). */
  start: number;
  end: number;
  /** A Codex skill's file. */
  path?: string;
}

/** One message the runner hands a harness: Ben's text with its context projected in, and what came with it. */
export interface OutgoingMessage {
  uuid: string;
  text: string;
  /** Uploads plus the images its context items name. */
  attachments: Attachment[];
  /** The harness commands the text names. */
  commands: CommandUse[];
}

/**
 * How the runner ends a session, gentlest first. Each maps to a signal a process gets; a session with no
 * process of its own (Cursor, Hermes, Cursor Cloud) ends at once and reports that signal as its exit.
 * - `close`: no more input. A process finishes and exits on its own (stdin ends). Cursor Cloud leaves its agent working.
 * - `stop`: the hard stop (SIGINT). A remote harness cancels the run.
 * - `terminate`: a `close` that took too long (SIGTERM).
 * - `kill`: at once (SIGKILL).
 */
export type EndMode = 'close' | 'stop' | 'terminate' | 'kill';

/** The runner subscribes to these as the harness session runs. */
export interface AdapterCallbacks {
  /** One Omni record produced by the harness. */
  record: (rec: StreamRecord) => void;
  /** A usage snapshot for the meter. */
  usage: (u: Usage) => void;
  /** The harness's own session id, learned once the session starts (Codex thread id, Cursor chat id). */
  session: (id: string) => void;
  /** The harness says its commands changed, so a cached command list is out of date. */
  commandsChanged?: () => void;
  /**
   * The commands this process can run, MCP prompts included: its first list, then each new one when it
   * changes. The thread's `/` menu uses it while the process runs.
   */
  commands?: (list: SlashCommand[]) => void;
  /** A full reading of the context window: the CLI's own split, or a harness's total and window. */
  context?: (c: ContextUsage) => void;
  /** A partial one from the stream: the tokens on the last call, or the model's window. */
  contextHint?: (h: ContextHint) => void;
  /** A finished turn's token counts, for a harness that reports them per turn (Cursor). */
  turnTokens?: (u: CursorTurnUsage) => void;
  /**
   * A tool call that prints while it runs: without `text`, it started; with it, what it printed. The clients that have
   * its row open follow it (apps/server/tool-tail.ts). The call's tool_result ends it. A harness that reports a tool's
   * output only when it ends never calls this.
   */
  toolOutput?: (toolUseId: string, text?: string) => void;
  /** The session ended: a process's exit code or signal, or the signal its end mode stands for. Reported once, after its last record. */
  exit: (code: number | null, signal: NodeJS.Signals | null) => void;
  /** The harness could not be started. Its `exit` still follows. */
  spawnError?: (err: Error) => void;
  /** What the harness process printed on stderr, for the exit report. */
  stderr?: (text: string) => void;
}

/** A running harness session, wired to the runner. */
export interface HarnessSession {
  /**
   * The OS process that runs the whole session, when there is one (Claude Code, Codex). Cursor starts a process per
   * turn, and Hermes and Cursor Cloud are HTTP APIs, so they have none.
   */
  readonly pid?: number;
  /** False once the session has ended or is ending. */
  readonly alive: boolean;
  /** Hand the harness a message: it starts a turn, steers the running one or waits its turn. False if the session can't take it. */
  send(m: OutgoingMessage): boolean;
  /**
   * Stop the running turn and keep the session. The harness answers with a `control` record carrying `requestId`.
   * False if the session can't take the request.
   */
  interrupt(requestId: string): boolean;
  /** End the session (see EndMode). Calling it again escalates; `exit` reports the end. */
  end(mode: EndMode): void;
  /** Ask for a full context reading, answered through `context`. False if it can't. */
  requestContext?: () => boolean;
}

export interface HarnessAdapter {
  readonly id: HarnessId;
  readonly capabilities: HarnessCapabilities;
  spawn(ctx: AdapterContext, cb: AdapterCallbacks): HarnessSession;
  /** Whether a resume is warranted from on-disk session state, given the thread has not "run" in this process yet. */
  resumeOnDisk?(thread: Thread): boolean;
  /** The session id a thread starts with when it moves to this harness and gets a new session (runner/switch.ts). */
  freshSessionId(thread: Thread): string;
}
