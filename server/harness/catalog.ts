// The model catalog: per harness, the models with their efforts and defaults, plus
// availability and the fix command when a harness can't be used. The pure assembly
// and resolution live here; live probing of the CLIs is injected so this is testable.
import type { HarnessId, HarnessInfo, ModelEntry } from './types.ts';
import { CAPABILITIES, HARNESS_META, HARNESS_IDS } from './types.ts';

// ---------- Claude Code (fixed) ----------

/** Claude Code's reasoning efforts, and the level "Default" resolves to. */
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const CLAUDE_DEFAULT_EFFORT = 'high';

/** The short aliases stay valid for roles and the conductor. */
export const CLAUDE_ALIASES: Record<string, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
  fable: 'claude-fable-5-1',
};

const claudeModel = (id: string, label: string, isDefault = false): ModelEntry => ({
  id,
  label,
  efforts: CLAUDE_EFFORTS,
  defaultEffort: CLAUDE_DEFAULT_EFFORT,
  ...(isDefault ? { default: true } : {}),
});

/** The fixed Claude Code list Omni has today. `defaultModelId` marks the harness default. */
export function claudeModels(defaultModelId = 'claude-opus-5-5'): ModelEntry[] {
  const models = [
    claudeModel('claude-opus-5-5', 'Opus 5.5'),
    claudeModel('claude-sonnet-5', 'Sonnet 5'),
    claudeModel('claude-fable-5-1', 'Fable 5.1'),
    claudeModel('claude-haiku-4-5', 'Haiku 4.5'),
  ];
  const resolved = CLAUDE_ALIASES[defaultModelId] ?? defaultModelId;
  const def = models.find((m) => m.id === resolved) ?? models[0];
  def.default = true;
  return models;
}

export function claudeHarness(cap: number, defaultModelId?: string): HarnessInfo {
  return {
    id: 'claude-code',
    ...HARNESS_META['claude-code'],
    capabilities: CAPABILITIES['claude-code'],
    available: true,
    models: claudeModels(defaultModelId),
    cap,
  };
}

// ---------- Codex ----------

/** The raw shape a Codex `model/list` + `config/read` probe yields, harness-agnostic. */
export interface CodexProbe {
  available: boolean;
  /** e.g. "plus" from account/read; shown as the plan when present. */
  planType?: string;
  /** From config/read: Ben's default model and effort, when set. */
  defaultModel?: string;
  defaultEffort?: string;
  /** `isDefault` is Codex's own default model, used when config.toml names none. */
  models: { id: string; label?: string; efforts: string[]; defaultEffort?: string; isDefault?: boolean }[];
}

export function codexHarness(probe: CodexProbe, cap: number): HarnessInfo {
  const base: Omit<HarnessInfo, 'models' | 'available' | 'fix'> = {
    id: 'codex',
    ...HARNESS_META.codex,
    capabilities: CAPABILITIES.codex,
    cap,
  };
  if (!probe.available) {
    return { ...base, available: false, fix: 'codex login', models: [] };
  }
  const models: ModelEntry[] = probe.models.map((m) => ({
    id: m.id,
    label: m.label ?? m.id,
    efforts: m.efforts,
    // Ben's configured effort applies to every model that supports it, as it does in Codex.
    defaultEffort:
      (probe.defaultEffort && m.efforts.includes(probe.defaultEffort) ? probe.defaultEffort : '') ||
      m.defaultEffort ||
      m.efforts[0] ||
      '',
  }));
  const def =
    models.find((m) => m.id === probe.defaultModel) ?? models.find((_, i) => probe.models[i].isDefault) ?? models[0];
  if (def) def.default = true;
  return { ...base, available: true, models };
}

// ---------- Cursor ----------

export interface CursorProbe {
  available: boolean;
  /** Families already parsed from the CLI model list. */
  models: ModelEntry[];
}

export function cursorHarness(probe: CursorProbe, cap: number): HarnessInfo {
  const base: Omit<HarnessInfo, 'models' | 'available' | 'fix'> = {
    id: 'cursor',
    ...HARNESS_META.cursor,
    capabilities: CAPABILITIES.cursor,
    cap,
  };
  if (!probe.available) return { ...base, available: false, fix: 'cursor-agent login', models: [] };
  const models = probe.models;
  if (models.length && !models.some((m) => m.default)) models[0].default = true;
  return { ...base, available: true, models };
}

// ---------- Hermes ----------

/** Shown when the capabilities probe cannot reach Hermes or the key is missing. */
export const HERMES_FIX =
  'Set HERMES_API_KEY in Secrets and connect this Mac to Tailscale (OMNI_HERMES_URL, default http://100.110.128.38:8642)';

const HERMES_NOTE = 'Runs on the Hermes server. Bills the Anthropic API, not your Claude, ChatGPT or Cursor plan.';

/** The one model Hermes offers. The server picks the underlying LLM. */
export function hermesModels(): ModelEntry[] {
  return [{ id: 'hermes', label: 'Hermes default', note: HERMES_NOTE, efforts: [], defaultEffort: '', default: true }];
}

export interface HermesProbe {
  available: boolean;
}

export function hermesHarness(probe: HermesProbe, cap: number): HarnessInfo {
  const base: Omit<HarnessInfo, 'models' | 'available' | 'fix'> = {
    id: 'hermes',
    ...HARNESS_META.hermes,
    capabilities: CAPABILITIES.hermes,
    cap,
  };
  if (!probe.available) return { ...base, available: false, fix: HERMES_FIX, models: [] };
  return { ...base, available: true, models: hermesModels() };
}

const UNAVAILABLE_FIX: Partial<Record<HarnessId, string>> = {
  codex: 'codex login',
  cursor: 'cursor-agent login',
  hermes: HERMES_FIX,
};

// ---------- resolution & validation ----------

export interface Catalog {
  harnesses: HarnessInfo[];
}

export const getHarness = (cat: Catalog, id: HarnessId) => cat.harnesses.find((h) => h.id === id);

/** Resolve a model id or Claude alias to the catalog model for a harness, or null. */
export function resolveModel(cat: Catalog, harness: HarnessId, model: string): ModelEntry | null {
  const h = getHarness(cat, harness);
  if (!h) return null;
  const id = harness === 'claude-code' ? CLAUDE_ALIASES[model] ?? model : model;
  return h.models.find((m) => m.id === id) ?? null;
}

export interface ResolveError {
  ok: false;
  error: string;
}
export interface Resolved {
  ok: true;
  harness: HarnessId;
  model: string;
  effort: string;
}

/**
 * Validate a harness/model/effort against the catalog. An empty effort means "the model's default"
 * and is always allowed. When the catalog for the harness has no models (couldn't be probed), the
 * values pass through to the CLI as given.
 */
export function validateRun(
  cat: Catalog,
  harness: HarnessId,
  model: string,
  effort: string,
): Resolved | ResolveError {
  const h = getHarness(cat, harness);
  if (!h) return { ok: false, error: `Unknown harness "${harness}".` };
  if (!h.available && h.models.length === 0) return { ok: false, error: unavailableError(h.name, h.fix) };
  // Catalog unavailable for this harness: pass through.
  if (h.models.length === 0) return { ok: true, harness, model, effort };

  const m = resolveModel(cat, harness, model);
  if (!m) {
    const ids = h.models.map((x) => x.id).join(', ');
    return { ok: false, error: `Unknown ${h.name} model "${model}". Valid: ${ids}.` };
  }
  if (effort && !m.efforts.includes(effort)) {
    const opts = m.efforts.length ? m.efforts.join(', ') : '(none — this model has no effort levels)';
    return { ok: false, error: `Model "${m.id}" does not support effort "${effort}". Valid: ${opts}.` };
  }
  return { ok: true, harness, model: m.id, effort };
}

/**
 * A short fix is a shell command (`codex login`). A sentence is the instruction itself,
 * which is what Hermes needs (a Keychain secret and a reachable URL, not one command).
 */
export function unavailableError(name: string, fix?: string): string {
  const text = (fix ?? '').trim();
  if (!text) return `${name} is not available.`;
  if (text.split(/\s+/).length <= 3) return `${name} is not available. Run \`${text}\`.`;
  return `${name} is not available. ${text}`;
}

export function emptyCatalog(caps: Record<HarnessId, number>): Catalog {
  return {
    harnesses: HARNESS_IDS.map((id) => ({
      id,
      ...HARNESS_META[id],
      capabilities: CAPABILITIES[id],
      available: id === 'claude-code',
      ...(UNAVAILABLE_FIX[id] ? { fix: UNAVAILABLE_FIX[id] } : {}),
      models: id === 'claude-code' ? claudeModels() : [],
      cap: caps[id],
    })),
  };
}
