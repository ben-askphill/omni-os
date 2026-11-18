// Which models the pickers list, per harness. The catalog itself is never filtered: a thread, crew role, channel or
// automation that names a hidden model still runs on it. Only the lists a person picks from leave it out.
//
// Each harness has a rule for models nobody has toggled (`newModels`) and the toggles that override it:
// - `latest` (the default): the newest model of each family, plus the harness default. When Opus 5.6 ships, it shows
//   and Opus 5.5 drops out of the list, unless it was switched on by hand.
// - `all`: every model the harness reports.
// A toggle that matches what the rule gives is no override, so the rule keeps deciding for that model later.

export type NewModelPolicy = 'latest' | 'all';
export const NEW_MODEL_POLICIES: readonly NewModelPolicy[] = ['latest', 'all'];
export const DEFAULT_NEW_MODELS: NewModelPolicy = 'latest';

export interface HarnessModelPrefs {
  /** Shown although the rule hides them. */
  show?: string[];
  /** Hidden although the rule shows them. */
  hide?: string[];
  /** The rule for every model not in `show` or `hide`. Unset: DEFAULT_NEW_MODELS. */
  newModels?: NewModelPolicy;
}

/** Per harness id. */
export type ModelVisibility = Partial<Record<string, HarnessModelPrefs>>;

interface Listed {
  id: string;
  default?: boolean;
}

const VERSION_TOKEN = /^([a-z]*?)(\d+(?:[.p]\d+)*)$/;
const DATE_TOKEN = /^\d{8}$/;

/**
 * A model id's family and version: `claude-opus-5-5` is family `claude-opus`, version [5, 5]; `gpt-6.1-sol` is
 * `gpt-sol` [6, 1]; `claude-4.6-opus` is `claude-opus` [4, 6]; `kimi-k2.7-code` is `kimi-k-code` [2, 7]. A dated
 * suffix (`-20251001`) and a context suffix (`[1m]`) are not part of either. An id with no number has no version.
 */
export function modelFamily(id: string): { family: string; version: number[] } {
  const words: string[] = [];
  const version: number[] = [];
  const tokens = id
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, '')
    .split(/[-_\s]+/)
    .filter(Boolean);
  for (const t of tokens) {
    if (DATE_TOKEN.test(t)) continue;
    const m = VERSION_TOKEN.exec(t);
    if (!m) {
      words.push(t);
      continue;
    }
    if (m[1]) words.push(m[1]);
    version.push(...m[2].split(/[.p]/).map(Number));
  }
  return { family: words.join('-') || id, version };
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** The ids the `latest` rule shows: each family's newest (ties all show), every id without a version, and the default. */
export function latestModelIds(models: readonly Listed[]): Set<string> {
  const best = new Map<string, number[]>();
  const parsed = models.map((m) => ({ m, ...modelFamily(m.id) }));
  for (const p of parsed) {
    if (!p.version.length) continue;
    const top = best.get(p.family);
    if (!top || compareVersions(p.version, top) > 0) best.set(p.family, p.version);
  }
  const out = new Set<string>();
  for (const p of parsed) {
    if (p.m.default || !p.version.length || compareVersions(p.version, best.get(p.family)!) === 0) out.add(p.m.id);
  }
  return out;
}

/** What a harness's rule shows before any toggle. */
export function ruleShows(models: readonly Listed[], policy: NewModelPolicy = DEFAULT_NEW_MODELS): Set<string> {
  return policy === 'all' ? new Set(models.map((m) => m.id)) : latestModelIds(models);
}

/**
 * The ids a picker leaves out for one harness. Never all of them: with every model hidden, the harness default (or the
 * first model) still shows, so a harness that is on never looks empty.
 */
export function hiddenModelIds(models: readonly Listed[], prefs?: HarnessModelPrefs): Set<string> {
  const shown = ruleShows(models, prefs?.newModels);
  for (const id of prefs?.show ?? []) shown.add(id);
  for (const id of prefs?.hide ?? []) shown.delete(id);
  const hidden = new Set(models.filter((m) => !shown.has(m.id)).map((m) => m.id));
  if (models.length && hidden.size === models.length) hidden.delete((models.find((m) => m.default) ?? models[0]).id);
  return hidden;
}

/** Where a model's visibility comes from, for the settings list. */
export function modelOverride(id: string, prefs?: HarnessModelPrefs): 'shown' | 'hidden' | null {
  if (prefs?.hide?.includes(id)) return 'hidden';
  if (prefs?.show?.includes(id)) return 'shown';
  return null;
}

/** Drop empty lists and an unset rule, so a harness with nothing changed stores nothing. */
export function normalizePrefs(prefs: HarnessModelPrefs): HarnessModelPrefs {
  const out: HarnessModelPrefs = {};
  const show = [...new Set(prefs.show ?? [])];
  const hide = [...new Set(prefs.hide ?? [])].filter((id) => !show.includes(id));
  if (show.length) out.show = show;
  if (hide.length) out.hide = hide;
  if (prefs.newModels && prefs.newModels !== DEFAULT_NEW_MODELS) out.newModels = prefs.newModels;
  return out;
}

/** The prefs after switching one model on or off. A switch back to what the rule gives clears its override. */
export function toggleModel(prefs: HarnessModelPrefs | undefined, models: readonly Listed[], id: string, shown: boolean): HarnessModelPrefs {
  const show = (prefs?.show ?? []).filter((x) => x !== id);
  const hide = (prefs?.hide ?? []).filter((x) => x !== id);
  if (ruleShows(models, prefs?.newModels).has(id) !== shown) (shown ? show : hide).push(id);
  return normalizePrefs({ ...prefs, show, hide });
}

/** The prefs with another rule. The toggles stay; any that now match the rule stop being overrides. */
export function setNewModels(prefs: HarnessModelPrefs | undefined, models: readonly Listed[], policy: NewModelPolicy): HarnessModelPrefs {
  const rule = ruleShows(models, policy);
  return normalizePrefs({
    newModels: policy,
    show: (prefs?.show ?? []).filter((id) => !rule.has(id) || !models.some((m) => m.id === id)),
    hide: (prefs?.hide ?? []).filter((id) => rule.has(id) || !models.some((m) => m.id === id)),
  });
}

/** Parse stored or sent prefs, dropping anything malformed. */
export function parseModelVisibility(raw: unknown): ModelVisibility {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: ModelVisibility = {};
  for (const [harness, v] of Object.entries(raw as Record<string, unknown>)) {
    const p = parseHarnessPrefs(v);
    if (p && Object.keys(p).length) out[harness] = p;
  }
  return out;
}

export function parseHarnessPrefs(v: unknown): HarnessModelPrefs | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const ids = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 200).slice(0, 500) : []);
  const policy = NEW_MODEL_POLICIES.includes(o.newModels as NewModelPolicy) ? (o.newModels as NewModelPolicy) : undefined;
  return normalizePrefs({ show: ids(o.show), hide: ids(o.hide), newModels: policy });
}

/**
 * The models a picker lists: the ones not hidden, plus the one already picked (`keep`), so a thread or role on a hidden
 * model still shows it checked.
 */
export function pickerModels<T extends { id: string; hidden?: boolean }>(models: readonly T[], keep?: string | null): T[] {
  return models.filter((m) => !m.hidden || m.id === keep);
}
