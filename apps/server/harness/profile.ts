// What a harness does beyond running a session (ADR 0017): compact, the context meter, how it loads an agent's skills,
// where its session files are, and the few behaviours only one harness has. Each built-in's profile lives in its own
// folder (harness/<id>/profile.ts) and its adapter carries it, so the runner, sync, handoff and skills ask the harness
// instead of checking its id. A custom harness runs on the Runs API and has RUNS_API_PROFILE.
import type { Thread } from '../db.ts';
import type { ThreadSkills } from '../skills.ts';
import { antigravityProfile } from './antigravity/profile.ts';
import { claudeProfile } from './claude/profile.ts';
import { codexProfile } from './codex/profile.ts';
import { cursorProfile } from './cursor/profile.ts';
import { cursorCloudProfile } from './cursor-cloud/profile.ts';
import { hermesProfile } from './hermes/profile.ts';
import { isHarnessId, type HarnessId } from './types.ts';

/** The thread fields a harness's session files are found by. */
export type SessionThread = Pick<Thread, 'id' | 'session_id' | 'cwd'>;

/** Where a local harness keeps a session on this machine, for sync (sync/files.ts) to move it between machines. */
export interface SessionFiles {
  /** The folder it keeps all its sessions under. It may be a link (a CODEX_HOME on another disk); nothing below it may. */
  base(home: string, env: NodeJS.ProcessEnv): string;
  /** The folder this thread's session is in, under `base`. */
  root(base: string, t: SessionThread): string;
  /** Whether a path from another machine, already checked to be plain and relative, is one it writes for this session. */
  owns(t: SessionThread, rel: string): boolean;
  /** The session's files found here, relative to `root`. `synced` is what this machine recorded syncing before. */
  local(t: SessionThread, root: string, synced: string[]): string[];
  /** Where a session file is kept in Storage. */
  object(sessionId: string, rel: string): string;
  /** A file downloaded from another machine, made this machine's. */
  adapt?(rel: string, body: Uint8Array, t: SessionThread): Uint8Array;
}

/** How a harness loads an agent's skills (skills.ts). */
export interface SkillLoading {
  /** Its skill list comes from the thread's own folder, the files it loads from, not the channel's checkout. */
  listsThreadFolder: boolean;
  /** Its skill tool refuses a skill marked `disable-model-invocation`, so a ticked one is read from its file instead. */
  userOnlyFromFile: boolean;
  /** What the server log calls the skills it loads itself. */
  how: string;
  /** The system prompt's lines for the skills it loads itself (ThreadSkills.native). `list` formats names. */
  lines(s: ThreadSkills, agent: string, list: (names: string[]) => string): string[];
}

export interface HarnessProfile {
  /** Its compact command, and whether that takes instructions. Null: it has none. */
  compact: { focus: boolean } | null;
  /**
   * How it reports its context window (context.ts): `transcript` reports and can be read back from its session file,
   * `reported` only reports, `estimate` is reckoned from turn totals and comes with spend. Null: none.
   */
  meter: 'transcript' | 'reported' | 'estimate' | null;
  /** How it loads an agent's skills, or null when it loads none (it runs off this machine). */
  skills: SkillLoading | null;
  /** Its session files on this machine, or null when it keeps none here. */
  sessionFiles: SessionFiles | null;
  /** It names its session only after the first turn: until then the thread's session id is the thread id. */
  namesSessionLate: boolean;
  /** It chooses its session id before it starts, and its replay of the first input confirms the session took it. */
  confirmsByReplay: boolean;
  /** It runs on the user's claude.ai account: its connectors, sign-in checks and published Artifacts. */
  claudeAi: boolean;
  /** It runs `/goal` only as a turn of its own (runner/api.ts goalSend). */
  goalCommand: boolean;
  /** The largest image it takes inline, in bytes, when its capabilities allow inline images. Null: any size. */
  inlineImageMax: number | null;
  /** The secret its own HTTP client reads: a channel's copy bills that channel's account, not this machine's. */
  apiKeySecret?: string;
  /** It works on its own clone of the repo and pushes a branch, which a team lead then fetches (runner/members.ts). */
  pushesBranch: boolean;
  /** Where a remote harness runs, for "its files are not on this machine" reasons. */
  where?: string;
  /** Why a thread cannot move to or from it, when its capabilities say it is not switchable. */
  switchRefusal?: string;
  /** A thread on it keeps its run as created: even a model or effort change is refused. */
  fixedRun?: boolean;
  /** Its own opening and section in the system prompt (runner/prompts.ts), in place of the local thread's. */
  prompt?: { intro(owner: string): string; lines: string[] };
}

/** A custom harness's (Runs API, custom.ts), and the base for Hermes: a remote server with none of the local traits. */
export const RUNS_API_PROFILE: HarnessProfile = {
  compact: null,
  meter: null,
  skills: null,
  sessionFiles: null,
  namesSessionLate: false,
  confirmsByReplay: false,
  claudeAi: false,
  goalCommand: false,
  inlineImageMax: null,
  pushesBranch: false,
  switchRefusal: "A custom harness runs on its own server without this thread's worktree. Start a new thread to move work to or from it.",
};

const PROFILES: Record<HarnessId, HarnessProfile> = {
  'claude-code': claudeProfile,
  codex: codexProfile,
  cursor: cursorProfile,
  hermes: hermesProfile,
  'cursor-cloud': cursorCloudProfile,
  antigravity: antigravityProfile,
};

/** What a harness does, by id. A custom harness, or an id this machine does not know, gets the Runs API profile. */
export function profileOf(id: string | null | undefined): HarnessProfile {
  return isHarnessId(id) ? PROFILES[id] : RUNS_API_PROFILE;
}
