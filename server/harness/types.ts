// The harness abstraction: the agent a thread runs in, together with what it bills.
// Claude Code (Claude plan), Codex (ChatGPT plan), Cursor Agent (Cursor plan) or
// Hermes (Anthropic API on Ben's server — not his Claude, ChatGPT or Cursor plan).
// See CONTEXT.md for the domain terms.

export type HarnessId = 'claude-code' | 'codex' | 'cursor' | 'hermes';

export const HARNESS_IDS: HarnessId[] = ['claude-code', 'codex', 'cursor', 'hermes'];

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
  /** Images ride along inline. When false, attachments go as path notes only. */
  inlineImages: boolean;
  /** Whether the harness reports plan usage windows. */
  usage: 'five-hour-week' | 'none';
}

export const CAPABILITIES: Record<HarnessId, HarnessCapabilities> = {
  'claude-code': { warmProcess: true, steer: true, inlineImages: true, usage: 'five-hour-week' },
  codex: { warmProcess: true, steer: true, inlineImages: true, usage: 'five-hour-week' },
  // (Codex steer/interrupt/images are wired in #11; capabilities above reflect the shipped behavior.)
  cursor: { warmProcess: false, steer: false, inlineImages: false, usage: 'none' },
  // No warm CLI. Steer is an HTTP call. Images stay on the Mac. Token counts are per run, not a plan window.
  hermes: { warmProcess: false, steer: true, inlineImages: false, usage: 'none' },
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
};
