// The harness abstraction: the agent a thread runs in, together with what it bills.
// Claude Code (Claude plan), Codex (ChatGPT plan), Cursor Agent (Cursor plan) or
// Hermes (Anthropic API on Ben's server — not his Claude, ChatGPT or Cursor plan), or
// Cursor Cloud (a Cursor cloud agent on Cursor's own Linux machines, Cursor plan).
// See CONTEXT.md for the domain terms.

export type HarnessId = 'claude-code' | 'codex' | 'cursor' | 'hermes' | 'cursor-cloud';

export const HARNESS_IDS: HarnessId[] = ['claude-code', 'codex', 'cursor', 'hermes', 'cursor-cloud'];

/**
 * Harnesses that run on a remote provider (the Hermes server, Cursor's cloud): no worktree, browser, MCP config or
 * local files on any machine. Not the same as a thread another synced machine runs (apps/server/ownership.ts): a
 * provider thread still has an owner machine, the one that talks to the provider.
 */
const PROVIDER_HARNESSES = new Set<string>(['hermes', 'cursor-cloud']);
export const isProviderHarness = (h: string | null | undefined) => !!h && PROVIDER_HARNESSES.has(h);
/** Where a provider harness runs, for "its files are not on this Mac" reasons. */
export const providerWhere = (h: string) => (h === 'cursor-cloud' ? 'as a Cursor cloud agent' : 'on the Hermes server');

/** Claude Code is the default everywhere, and existing threads carry on as Claude Code threads. */
export const DEFAULT_HARNESS: HarnessId = 'claude-code';

export function isHarnessId(v: unknown): v is HarnessId {
  return typeof v === 'string' && (HARNESS_IDS as string[]).includes(v);
}

/** What a harness can do. The runner reads these instead of special-casing ids. */
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
}

export const CAPABILITIES: Record<HarnessId, HarnessCapabilities> = {
  'claude-code': { warmProcess: true, steer: true, interrupt: true, inlineImages: true, usage: 'five-hour-week' },
  codex: { warmProcess: true, steer: true, interrupt: true, inlineImages: true, usage: 'five-hour-week' },
  // (Codex steer/interrupt/images are wired in #11; capabilities above reflect the shipped behavior.)
  // Plan usage is Cursor's monthly cycle, read from its dashboard (cursor-usage.ts).
  cursor: { warmProcess: false, steer: false, interrupt: false, inlineImages: false, usage: 'monthly' },
  // No warm CLI. Steer is an HTTP call. Images stay on the Mac. Token counts are per run, not a plan window.
  hermes: { warmProcess: false, steer: true, interrupt: true, inlineImages: false, usage: 'none' },
  // An HTTP API too. A message sent mid-run waits for the run to end and goes as a follow-up run; Stop cancels the run.
  // Images go up with the prompt, but the runner's attachment notes stay paths. Usage is Cursor's, not a plan window.
  'cursor-cloud': { warmProcess: false, steer: false, interrupt: true, inlineImages: false, usage: 'none' },
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
}

/** A harness plus its availability, models and cap, as the catalog reports it. */
export interface HarnessInfo {
  id: HarnessId;
  /** Display name, e.g. "Claude Code". */
  name: string;
  /** The plan that bills, e.g. "Claude plan". */
  plan: string;
  capabilities: HarnessCapabilities;
  /** Installed and logged in. When false, the harness can't be used. */
  available: boolean;
  /** The command that fixes availability, e.g. "codex login". Present when unavailable. */
  fix?: string;
  models: ModelEntry[];
  /** Concurrency cap for this harness. */
  cap: number;
}

export const HARNESS_META: Record<HarnessId, { name: string; plan: string }> = {
  'claude-code': { name: 'Claude Code', plan: 'Claude plan' },
  codex: { name: 'Codex', plan: 'ChatGPT plan' },
  cursor: { name: 'Cursor Agent', plan: 'Cursor plan' },
  hermes: { name: 'Hermes', plan: 'Anthropic API via Hermes' },
  'cursor-cloud': { name: 'Cursor Cloud', plan: 'Cursor plan' },
};

/**
 * How to install each local CLI, for onboarding (web, Mac, `npm run setup`). `fix` on HarnessInfo says how to sign
 * in once it is installed. Hermes and Cursor Cloud run off this Mac, so they have none.
 */
export const HARNESS_INSTALL: Partial<Record<HarnessId, string>> = {
  'claude-code': 'npm install -g @anthropic-ai/claude-code',
  codex: 'npm install -g @openai/codex',
  cursor: 'curl https://cursor.com/install -fsS | bash',
};
