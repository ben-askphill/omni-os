// The model catalog: per harness, the models with their efforts and defaults, plus
// availability and the fix command when a harness can't be used. The pure assembly
// and resolution live here; live probing of the CLIs is injected so this is testable.
import type { AnyHarnessId, HarnessId, HarnessInfo, ModelEntry, RemoteTarget } from './types.ts';
import type { CustomHarness } from './custom.ts';
import { CAPABILITIES, HARNESS_META, HARNESS_IDS } from './types.ts';
import { CLAUDE_ALIASES } from '@omni/shared/claude-aliases.ts';
import { claudeModelLabel, stripClaudeModelSuffixes } from '@omni/shared/claude-model-label.ts';
import { parseClaudeStatus } from './accounts-parse.ts';
import type { AntigravityState } from './antigravity/state.ts';

// ---------- Claude Code ----------
// A bundled list, then whatever else Claude Code itself reports (its `initialize` answer, as T3 Code reads it), so a
// model that ships in a Claude Code release shows without an Omni release. The bundled list stays first and wins for
// the ids it has: Auto, the aliases and crew roles name those ids, and some (claude-haiku-4-5) Claude Code reports
// only with a release date.

/** Claude Code's reasoning efforts, and the level "Default" resolves to. */
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const CLAUDE_DEFAULT_EFFORT = 'high';

export { CLAUDE_ALIASES };

const claudeModel = (id: string, label: string, isDefault = false): ModelEntry => ({
  id,
  label,
  efforts: CLAUDE_EFFORTS,
  defaultEffort: CLAUDE_DEFAULT_EFFORT,
  ...(isDefault ? { default: true } : {}),
});

/** One model as Claude Code's `initialize` answer lists it (claude 2.1.316). */
export interface ClaudeReportedModel {
  /** What `--model` takes: an id, or an alias such as `opus`. `default` is Claude Code's own default, not a model. */
  value: string;
  /** The model the value runs, e.g. `claude-opus-5-5` for `opus`. */
  resolvedModel?: string;
  displayName?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
}

/** The well-formed entries of an `initialize` answer's `models`. */
export function parseClaudeReported(raw: unknown): ClaudeReportedModel[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): ClaudeReportedModel[] => {
    if (!r || typeof r !== 'object' || typeof (r as { value?: unknown }).value !== 'string') return [];
    const o = r as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const levels = Array.isArray(o.supportedEffortLevels) ? o.supportedEffortLevels.filter((e): e is string => typeof e === 'string' && !!e) : undefined;
    return [
      {
        value: o.value as string,
        ...(str(o.resolvedModel) && { resolvedModel: str(o.resolvedModel) }),
        ...(str(o.displayName) && { displayName: str(o.displayName) }),
        ...(o.supportsEffort === true && { supportsEffort: true }),
        ...(levels && { supportedEffortLevels: levels }),
      },
    ];
  });
}

/** The id a reported model runs: its resolved model, without a context suffix (`[1m]`) or a release date. */
export const claudeReportedId = (r: ClaudeReportedModel) =>
  stripClaudeModelSuffixes(r.resolvedModel || r.value);

/**
 * The Claude Code models: the bundled list, then each model Claude Code reports that the list lacks, with its own
 * effort levels. `defaultModelId` (an id or an alias) marks the harness default.
 */
export function claudeModels(defaultModelId = 'claude-sonnet-5-5', reported: readonly ClaudeReportedModel[] = []): ModelEntry[] {
  const models = [
    claudeModel('claude-sonnet-5-5', 'Sonnet 5.5'),
    claudeModel('claude-opus-5-5', 'Opus 5.5'),
    claudeModel('claude-sonnet-5', 'Sonnet 5'),
    claudeModel('claude-fable-5-2', 'Fable 5.2'),
    claudeModel('claude-fable-5-1', 'Fable 5.1'),
    claudeModel('claude-haiku-4-5', 'Haiku 4.5'),
  ];
  const known = new Set(models.map((m) => m.id));
  for (const r of reported) {
    if (r.value === 'default') continue;
    const id = claudeReportedId(r);
    if (!id || known.has(id)) continue;
    known.add(id);
    const efforts = r.supportsEffort ? (r.supportedEffortLevels ?? []) : [];
    models.push({
      id,
      label: claudeModelLabel(id, r.displayName),
      efforts,
      defaultEffort: efforts.includes(CLAUDE_DEFAULT_EFFORT) ? CLAUDE_DEFAULT_EFFORT : (efforts[0] ?? ''),
    });
  }
  const resolved = CLAUDE_ALIASES[defaultModelId] ?? defaultModelId;
  const def = models.find((m) => m.id === resolved) ?? models[0];
  def.default = true;
  return models;
}

/** Signed out. Three words or fewer, so the clients show it as a command to run. */
export const CLAUDE_LOGIN = 'claude auth login';
export const CLAUDE_NOT_FOUND = 'Omni found no claude on its PATH. Install Claude Code or set OMNI_CLAUDE_BIN to its path';

/**
 * What `claude auth status --json` said (catalog-service.ts). Unknown (a CLI too old to have the command, or one that
 * did not answer in time) stays available: only a clear "signed out" or a missing binary takes Claude Code down.
 */
export interface ClaudeProbe {
  available: boolean;
  missing?: boolean;
  fix?: string;
}

/**
 * `reported`: what Claude Code listed when Omni last asked. Empty before the first answer: the bundled list alone.
 * `probe`: whether it is installed and signed in. Before the first probe it counts as available, as it did before
 * the probe existed, so a restart never shows Claude Code down for the seconds the probe takes.
 */
export function claudeHarness(cap: number, defaultModelId?: string, reported: readonly ClaudeReportedModel[] = [], probe: ClaudeProbe = { available: true }): HarnessInfo {
  const base = { id: 'claude-code' as const, ...HARNESS_META['claude-code'], capabilities: CAPABILITIES['claude-code'], cap };
  if (!probe.available) return { ...base, available: false, fix: probe.fix ?? CLAUDE_LOGIN, ...(probe.missing && { missing: true as const }), models: [] };
  return { ...base, available: true, models: claudeModels(defaultModelId, reported) };
}

/**
 * `claude auth status --json`'s stdout as a probe; null stdout is a CLI that did not answer. Signed out is the same
 * reading Settings > Accounts makes (accounts-parse.ts parseClaudeStatus): JSON whose `loggedIn` is not true.
 */
export function claudeProbeOf(out: { stdout: string | null; missing: boolean }): ClaudeProbe {
  if (out.missing) return { available: false, missing: true, fix: CLAUDE_NOT_FOUND };
  if (!out.stdout) return { available: true };
  return parseClaudeStatus(out.stdout).state === 'signed-out' ? { available: false, fix: CLAUDE_LOGIN } : { available: true };
}

// ---------- Codex ----------

/** Signed out. Three words or fewer, so the clients show it as a command to run. */
export const CODEX_LOGIN = 'codex login';
export const CODEX_API_KEY = 'Signed in with an API key, not a ChatGPT plan. Run codex login';
export const CODEX_NOT_FOUND = 'Omni found no codex on its PATH. Install Codex or set OMNI_CODEX_BIN to its path';

/** Why a probe could not get an answer from Codex, as the fix the picker and `delegate` show. */
export const codexFix = {
  wontRun: (bin: string, why: string) => `Omni could not run ${bin} (${why}). Set OMNI_CODEX_BIN to a codex that runs`,
  exited: (code: number | null, signal: string | null, stderr: string) =>
    `codex app-server exited (${signal ?? `code ${code}`}) before it answered${stderr ? `: ${stderr}` : ''}. Run codex app-server in a terminal to see why`,
  silent: (method: string, ms: number) =>
    method === 'initialize'
      ? `codex app-server did not start within ${ms / 1000} s. Run codex app-server in a terminal to see why`
      : `Codex did not answer ${method} within ${ms / 1000} s. Omni asks again when the model picker opens`,
  failed: (method: string, message: string) => `Codex answered ${method} with an error: ${message}`,
};

/** The raw shape a Codex `model/list` + `config/read` probe yields, harness-agnostic. */
export interface CodexProbe {
  available: boolean;
  /** Why not, when unavailable. Signed out (CODEX_LOGIN) unless set. */
  fix?: string;
  /** No codex binary was found (CODEX_NOT_FOUND). */
  missing?: boolean;
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
    return { ...base, available: false, fix: probe.fix ?? CODEX_LOGIN, ...(probe.missing && { missing: true as const }), models: [] };
  }
  const models: ModelEntry[] = probe.models.map((m) => ({
    id: m.id,
    label: m.label ?? m.id,
    efforts: m.efforts,
    // The user's configured effort applies to every model that supports it, as it does in Codex.
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
  /** No cursor-agent binary was found. */
  missing?: boolean;
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
  if (!probe.available) return { ...base, available: false, fix: 'cursor-agent login', ...(probe.missing && { missing: true as const }), models: [] };
  const models = probe.models;
  if (models.length && !models.some((m) => m.default)) models[0].default = true;
  return { ...base, available: true, models };
}

// ---------- Hermes ----------

/** Shown when the capabilities probe cannot reach Hermes or the key is missing. */
export const HERMES_FIX =
  'Set the Hermes URL in Settings (or OMNI_HERMES_URL) to its Tailscale address, set HERMES_API_KEY in Secrets, and connect this machine to Tailscale';

const HERMES_NOTE = 'Runs on the Hermes server. Bills the Anthropic API, not your Claude, ChatGPT or Cursor plan.';

/** The one model Hermes offers. The server picks the underlying LLM. */
export function hermesModels(): ModelEntry[] {
  return [{ id: 'hermes', label: 'Hermes default', note: HERMES_NOTE, efforts: [], defaultEffort: '', default: true }];
}

export interface HermesProbe {
  available: boolean;
}

/** A URL's host and port, or empty when it does not parse. */
export const hostOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).host : '';
  } catch {
    return '';
  }
};

/** `url`: the Hermes URL from Settings, for the Harnesses list's host. */
export function hermesHarness(probe: HermesProbe, cap: number, url?: string): HarnessInfo {
  const remote: RemoteTarget = { custom: false, kind: 'runs-api', host: hostOf(url), secret: 'HERMES_API_KEY' };
  const base: Omit<HarnessInfo, 'models' | 'available' | 'fix'> = {
    id: 'hermes',
    ...HARNESS_META.hermes,
    capabilities: CAPABILITIES.hermes,
    cap,
    remote,
  };
  if (!probe.available) return { ...base, available: false, fix: HERMES_FIX, models: [] };
  return { ...base, available: true, models: hermesModels() };
}

// ---------- custom harnesses ----------

/** The one model a custom harness offers. Its server picks the model, as Hermes's does. */
export const CUSTOM_MODEL = 'default';

/** What the probe of a custom harness found. `fix` says how to make it usable when it is not. */
export interface CustomProbe {
  available: boolean;
  fix?: string;
  /** The key is why it is down: none on this machine, or the server refused it. */
  keyProblem?: 'missing' | 'refused';
}

/** How to read a probe that has not run yet. */
export const UNCHECKED_FIX = 'Omni has not checked this harness yet';

/** A custom harness (custom.ts) as the catalog lists it. A file with an error is unavailable, and its error is the fix. */
export function customHarnessInfo(h: CustomHarness, probe: CustomProbe): HarnessInfo {
  const base: Omit<HarnessInfo, 'models' | 'available' | 'fix'> = {
    id: h.id,
    name: h.name,
    plan: h.bills,
    capabilities: h.capabilities,
    cap: h.cap,
    remote: { custom: true, kind: h.kind, host: h.host, secret: h.secret },
  };
  if (h.error) return { ...base, available: false, fix: h.error, models: [] };
  if (!probe.available) return { ...base, ...(probe.keyProblem && { remote: { ...base.remote!, keyProblem: probe.keyProblem } }), available: false, fix: probe.fix ?? UNCHECKED_FIX, models: [] };
  const note = `Runs on ${h.host}. ${h.bills}.`;
  return { ...base, available: true, models: [{ id: CUSTOM_MODEL, label: `${h.name} default`, note, efforts: [], defaultEffort: '', default: true }] };
}

// ---------- Antigravity ----------

/** The one model Antigravity lists until the live model list lands: no model is sent, so agy runs its own current one. */
export const ANTIGRAVITY_MODEL = 'default';
const ANTIGRAVITY_NOTE = "agy's current model. Bills your Google AI plan.";
/** Before the first check, which runs at server start. */
export const ANTIGRAVITY_UNCHECKED = 'Omni has not checked agy on this machine yet';

/** Antigravity as the state reader last found it (antigravity/state.ts). Null: not checked yet. */
export function antigravityHarness(s: AntigravityState | null, cap: number): HarnessInfo {
  const base: Omit<HarnessInfo, 'models' | 'available' | 'fix'> = {
    id: 'antigravity',
    ...HARNESS_META.antigravity,
    capabilities: CAPABILITIES.antigravity,
    cap,
    ...(s?.hint && { hint: s.hint }),
  };
  if (!s) return { ...base, available: false, fix: ANTIGRAVITY_UNCHECKED, models: [] };
  if (s.state !== 'ready') return { ...base, available: false, fix: s.fix, ...(s.state === 'not-installed' && { missing: true as const }), models: [] };
  const note = s.note ? `${ANTIGRAVITY_NOTE} ${s.note}.` : ANTIGRAVITY_NOTE;
  return { ...base, available: true, models: [{ id: ANTIGRAVITY_MODEL, label: 'Antigravity default', note, efforts: [], defaultEffort: '', default: true }] };
}

// ---------- Cursor Cloud ----------

/** No key in Secrets or the secret store. Kept apart from the other reasons: a channel key can still fix this one. */
export const CURSOR_CLOUD_FIX = 'Add CURSOR_API_KEY in Secrets, globally or on the channel. Make the key at cursor.com/dashboard under Integrations';
export const CURSOR_CLOUD_REJECTED = 'Cursor rejected CURSOR_API_KEY. Replace it in Secrets with a key from cursor.com/dashboard under Integrations';
export const CURSOR_CLOUD_UNREACHABLE = 'Could not reach the Cursor API (api.cursor.com). Check the connection and try again';
export const CURSOR_CLOUD_NO_REPO = "Set the channel's GitHub repo in its settings. A cloud agent clones the repo from GitHub";

const CURSOR_CLOUD_NOTE = "Runs on Cursor's Linux cloud, on its own clone of the channel repo. Bills your Cursor plan.";

/** "Cursor default" (no model sent, so the agent uses the one set on cursor.com), then the models the API lists. */
export function cursorCloudModels(listed: { id: string; label: string }[] = []): ModelEntry[] {
  return [
    { id: 'default', label: 'Cursor default', note: CURSOR_CLOUD_NOTE, efforts: [], defaultEffort: '', default: true },
    ...listed.filter((m) => m.id !== 'default').map((m) => ({ id: m.id, label: m.label, note: CURSOR_CLOUD_NOTE, efforts: [], defaultEffort: '' })),
  ];
}

export interface CursorCloudProbe {
  available: boolean;
  /** Why not, when unavailable: one of the CURSOR_CLOUD_* messages. */
  fix?: string;
  models?: { id: string; label: string }[];
}

export function cursorCloudHarness(probe: CursorCloudProbe, cap: number): HarnessInfo {
  const base: Omit<HarnessInfo, 'models' | 'available' | 'fix'> = {
    id: 'cursor-cloud',
    ...HARNESS_META['cursor-cloud'],
    capabilities: CAPABILITIES['cursor-cloud'],
    cap,
  };
  if (!probe.available) return { ...base, available: false, fix: probe.fix ?? CURSOR_CLOUD_FIX, models: [] };
  return { ...base, available: true, models: cursorCloudModels(probe.models) };
}

/**
 * The catalog as one channel sees it. Only Cursor Cloud depends on the channel: it needs the channel's GitHub repo,
 * and a channel's own CURSOR_API_KEY makes it usable there when no global key is set.
 */
export function catalogForChannel(cat: Catalog, channel: { github_repo: string | null }, channelKey: boolean): Catalog {
  const h = getHarness(cat, 'cursor-cloud');
  if (!h) return cat;
  let next = h;
  if (!channel.github_repo) next = { ...h, available: false, fix: CURSOR_CLOUD_NO_REPO, models: [] };
  else if (!h.available && channelKey && h.fix === CURSOR_CLOUD_FIX) next = { ...h, available: true, fix: undefined, models: cursorCloudModels() };
  if (next === h) return cat;
  return { harnesses: cat.harnesses.map((x) => (x.id === 'cursor-cloud' ? next : x)) };
}

const UNAVAILABLE_FIX: Partial<Record<HarnessId, string>> = {
  codex: CODEX_LOGIN,
  cursor: 'cursor-agent login',
  hermes: HERMES_FIX,
  'cursor-cloud': CURSOR_CLOUD_FIX,
  antigravity: ANTIGRAVITY_UNCHECKED,
};

// ---------- resolution & validation ----------

export interface Catalog {
  harnesses: HarnessInfo[];
}

export const getHarness = (cat: Catalog, id: string) => cat.harnesses.find((h) => h.id === id);

/** Resolve a model id or Claude alias to the catalog model for a harness, or null. */
export function resolveModel(cat: Catalog, harness: string, model: string): ModelEntry | null {
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
  harness: AnyHarnessId;
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
  harness: AnyHarnessId,
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
 * which is what Hermes needs (a stored secret and a reachable URL, not one command).
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
