// The harness abstraction: the agent a thread runs in, together with what it bills.
// Claude Code (Claude plan), Codex (ChatGPT plan), Cursor Agent (Cursor plan) or
// Hermes (Anthropic API on Ben's server — not his Claude, ChatGPT or Cursor plan), or
// Cursor Cloud (a Cursor cloud agent on Cursor's own Linux machines, Cursor plan).
// Beside these built-ins, the user can register custom harnesses: remote agents that speak the Runs API, one file each
// in data/harnesses/ (custom.ts), with ids `custom:<slug>`.
// See GLOSSARY.md for the domain terms.
import { isCustomHarnessId, type CustomHarnessId } from '@omni/shared/custom-harness.ts';

/** The built-in harnesses. */
export type HarnessId = 'claude-code' | 'codex' | 'cursor' | 'hermes' | 'cursor-cloud';

/** A built-in or a custom harness. A thread's `harness` column holds one of these. */
export type AnyHarnessId = HarnessId | CustomHarnessId;

export const HARNESS_IDS: HarnessId[] = ['claude-code', 'codex', 'cursor', 'hermes', 'cursor-cloud'];

/**
 * Harnesses that run on a remote provider (the Hermes server, Cursor's cloud, a custom harness's server): no worktree,
 * browser, MCP config or local files on any machine. Read from the `remote` capability; every custom harness is remote,
 * registered on this machine or not. Not the same as a thread another synced machine runs (apps/server/ownership.ts): a
 * provider thread still has an owner machine, the one that talks to the provider.
 */
export const isProviderHarness = (h: string | null | undefined) => !!h && (isCustomHarnessId(h) || (isHarnessId(h) && CAPABILITIES[h].remote));

/** Claude Code is the default everywhere, and existing threads carry on as Claude Code threads. */
export const DEFAULT_HARNESS: HarnessId = 'claude-code';

export function isHarnessId(v: unknown): v is HarnessId {
  return typeof v === 'string' && (HARNESS_IDS as string[]).includes(v);
}

/**
 * What a harness can do. The runner reads these instead of special-casing ids. Built-ins have fixed values; a custom
 * harness starts from RUNS_API_CAPABILITIES, and its file can turn steer and interrupt off, never on (custom.ts).
 */
export interface HarnessCapabilities {
  /** The process stays warm between turns (Claude, Codex). Cursor starts one process per turn; Hermes has no local CLI. */
  warmProcess: boolean;
  /** Steer mid-turn. When false, a steer request is handled as a queue. */
  steer: boolean;
  /** Stop a turn on request and stay up. When false (and it can't steer), Stop kills the process. */
  interrupt: boolean;
  /** Images ride along inline. When false, attachments go as path notes only. */
  inlineImages: boolean;
  /** Which plan usage windows the harness reports. */
  usage: 'five-hour-week' | 'monthly' | 'none';
  /** It runs off this machine: no worktree, browser, MCP config, Omni tools or local files. */
  remote: boolean;
  /**
   * Omni can hold its tools to a role's or channel's limits: take tools away from a delegate-only role, keep a level
   * below full access. False for a harness that runs its own tools where Omni cannot see them.
   */
  toolLimits: boolean;
  /** A thread can move to or from it mid-thread (runner/switch-plan.ts). */
  switchable: boolean;
}

const LOCAL = { remote: false, toolLimits: true, switchable: true } as const;

/** Hermes's, and every custom harness's before its file turns anything off: the Runs API (hermes/adapter.ts). */
export const RUNS_API_CAPABILITIES: HarnessCapabilities = {
  // No warm CLI. Steer is an HTTP call. Images stay on the Mac. Token counts are per run, not a plan window.
  warmProcess: false,
  steer: true,
  interrupt: true,
  inlineImages: false,
  usage: 'none',
  // Its own tools on its own server: Omni can neither take them away nor hand it a worktree to switch into.
  remote: true,
  toolLimits: false,
  switchable: false,
};

export const CAPABILITIES: Record<HarnessId, HarnessCapabilities> = {
  'claude-code': { warmProcess: true, steer: true, interrupt: true, inlineImages: true, usage: 'five-hour-week', ...LOCAL },
  codex: { warmProcess: true, steer: true, interrupt: true, inlineImages: true, usage: 'five-hour-week', ...LOCAL },
  // (Codex steer/interrupt/images are wired in #11; capabilities above reflect the shipped behavior.)
  // Plan usage is Cursor's monthly cycle, read from its dashboard (cursor-usage.ts).
  cursor: { warmProcess: false, steer: false, interrupt: false, inlineImages: false, usage: 'monthly', ...LOCAL },
  hermes: RUNS_API_CAPABILITIES,
  // An HTTP API too. A message sent mid-run waits for the run to end and goes as a follow-up run; Stop cancels the run.
  // Images go up with the prompt, but the runner's attachment notes stay paths. Usage is Cursor's, not a plan window.
  'cursor-cloud': { warmProcess: false, steer: false, interrupt: true, inlineImages: false, usage: 'none', remote: true, toolLimits: false, switchable: false },
};

/** One model a harness offers. */
export interface ModelEntry {
  /** The id passed to the CLI. */
  id: string;
  /** Human label shown in the picker. */
  label: string;
  /** Extra note, e.g. Cursor's "Bills Cursor, not your Claude plan". */
  note?: string;
  /** Reasoning effort levels this model supports in its harness. Empty means the model has no levels. */
  efforts: string[];
  /** The effort used when Ben picks none. Empty when the model has no levels. */
  defaultEffort: string;
  /** Whether this is the harness's default model. */
  default?: boolean;
  /**
   * Left out of the pickers by Ben's model visibility settings (harness/model-visibility.ts). Only GET /harnesses sets
   * it. The model still runs: anything that already names it keeps working.
   */
  hidden?: boolean;
}

/** Where a remote harness the user set up runs, for the Harnesses list. Never the key, only its secret's name. */
export interface RemoteTarget {
  /** A custom harness the user registered (data/harnesses/), rather than Hermes's Settings URL. */
  custom: boolean;
  /** The wire protocol: the Runs API, or an eve agent's own API. */
  kind: 'runs-api' | 'eve';
  /** The server's host and port, from its URL. Empty when no URL is set. */
  host: string;
  /** The secret store name its key is read from, on each machine. */
  secret: string;
  /** Why it is down, when the key is why: none on this machine, or the server refused it. */
  keyProblem?: 'missing' | 'refused';
}

/** A harness plus its availability, models and cap, as the catalog reports it. */
export interface HarnessInfo {
  id: AnyHarnessId;
  /** Display name, e.g. "Claude Code". */
  name: string;
  /** The plan that bills, e.g. "Claude plan". */
  plan: string;
  capabilities: HarnessCapabilities;
  /** Installed and logged in. When false, the harness can't be used. */
  available: boolean;
  /** The command that fixes availability, e.g. "codex login". Present when unavailable. */
  fix?: string;
  /** Unavailable because Omni found no binary for this CLI, so installing it comes first. Only on Codex and Cursor Agent. */
  missing?: true;
  models: ModelEntry[];
  /** Concurrency cap for this harness. */
  cap: number;
  /** Hermes and the custom harnesses: where they run and which secret holds their key. */
  remote?: RemoteTarget;
}

export const HARNESS_META: Record<HarnessId, { name: string; plan: string }> = {
  'claude-code': { name: 'Claude Code', plan: 'Claude plan' },
  codex: { name: 'Codex', plan: 'ChatGPT plan' },
  cursor: { name: 'Cursor Agent', plan: 'Cursor plan' },
  hermes: { name: 'Hermes', plan: 'Anthropic API via Hermes' },
  'cursor-cloud': { name: 'Cursor Cloud', plan: 'Cursor plan' },
};

/**
 * How to install each local CLI, for onboarding (the Web UI and `npm run setup`), sent only while it is `missing`. `fix`
 * on HarnessInfo says how to sign in once it is installed. Hermes and Cursor Cloud run off this Mac, so they have none.
 */
export const HARNESS_INSTALL: Partial<Record<HarnessId, string>> = {
  'claude-code': 'npm install -g @anthropic-ai/claude-code',
  codex: 'npm install -g @openai/codex',
  cursor: 'curl https://cursor.com/install -fsS | bash',
};
