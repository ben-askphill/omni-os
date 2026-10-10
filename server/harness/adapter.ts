// The harness adapter interface the runner drives. The runner keeps everything that
// isn't harness-specific — queueing, send modes, keepalive, slots, crew reports, titles,
// events and the feed — and each adapter owns its CLI's process and protocol, translating
// to and from Omni's records. Claude Code's behaviour moves behind this unchanged.
import type { ChildProcess } from 'node:child_process';
import type { SlashCommand } from '../../shared/slash.ts';
import type { Channel, Thread } from '../db.ts';
import type { CrewRole } from '../crew.ts';
import type { ContextUsage } from '../../shared/context-meter.ts';
import type { ContextHint, Record as StreamRecord, Usage } from '../stream.ts';
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

/** The runner subscribes to these as the harness process runs. */
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
}

/** A running harness process, wired to the runner. */
export interface HarnessSession {
  /** The OS process, for signals (interrupt/kill) and stdin end. */
  child: ChildProcess;
  /**
   * Translate a runner stdin object — a Claude-shaped `user` line or `control_request` —
   * into the harness's protocol and write it. Returns false if the pipe is gone.
   */
  write(obj: unknown): boolean;
  /** Flush any buffered stdout on close. */
  flush?: () => void;
  /** Ask the process for a full context reading, answered through `context`. False if it can't. */
  requestContext?: () => boolean;
}

export interface HarnessAdapter {
  readonly id: HarnessId;
  readonly capabilities: HarnessCapabilities;
  spawn(ctx: AdapterContext, cb: AdapterCallbacks): HarnessSession;
  /** Whether a resume is warranted from on-disk session state, given the thread has not "run" in this process yet. */
  resumeOnDisk?(thread: Thread): boolean;
}
