// The run resolver decides what a thread runs on, in this order:
//   1. the thread's own choice (composer, automation or conductor);
//   2. the crew role's default;
//   3. the channel's default;
//   4. Auto, which picks from the prompt (harness/auto.ts).
// Any of 1 to 3 can ask for Auto too, with model "auto".
// A role that sets any of harness, model or effort replaces the channel's default whole; the two never mix.
// The defaults' model and effort only apply when the thread runs on their harness, and their effort
// only when their model is the one picked (or, when they name no model, the harness default is). Pure, so it is testable.
// Whatever picked it, a review role on a GPT model then runs at high effort (reviewerEffort).
import { isHarnessId, DEFAULT_HARNESS, HARNESS_META, type HarnessId } from './types.ts';
import { getHarness, resolveModel, unavailableError, validateRun, type Catalog, type Resolved, type ResolveError } from './catalog.ts';
import { asksAuto, GPT_REVIEW_EFFORT, nearestEffort } from './auto.ts';

export interface RunChoice {
  harness?: string | null;
  model?: string | null;
  effort?: string | null;
}
export interface RoleDefaults {
  harness?: string;
  model?: string;
  effort?: string;
}

/** Whether a role or channel sets anything about the run. */
export const setsRun = (d: RoleDefaults | undefined): d is RoleDefaults => !!(d?.harness || d?.model || d?.effort);

/** Auto picks the harness, model and effort once the prompt is known. */
export interface AutoRun {
  ok: true;
  auto: true;
}
const AUTO_RUN: AutoRun = { ok: true, auto: true };

export function resolveRun(choice: RunChoice, roleDefaults: RoleDefaults | undefined, cat: Catalog, channel?: RoleDefaults): Resolved | AutoRun | ResolveError {
  // The role's defaults when it sets any, else the channel's. Below, "role" is whichever applies.
  const layer = setsRun(roleDefaults) ? roleDefaults : setsRun(channel) ? channel : undefined;
  if (asksAuto(choice)) return AUTO_RUN;
  if (!(choice.harness || choice.model || choice.effort) && (!layer || asksAuto(layer))) return AUTO_RUN;
  // A choice that names a harness or model replaces an Auto default, which then sets nothing.
  const role = asksAuto(layer) ? undefined : (layer ?? roleDefaults);
  if (choice.harness && !isHarnessId(choice.harness)) return { ok: false, error: `Unknown harness "${choice.harness}".` };
  if (role?.harness && !isHarnessId(role.harness)) return { ok: false, error: `Unknown harness "${role.harness}".` };

  // A role that sets only a model stays on Claude Code.
  const roleHarness = role ? role.harness ?? DEFAULT_HARNESS : undefined;
  const harness: HarnessId = isHarnessId(choice.harness) ? choice.harness : isHarnessId(roleHarness) ? roleHarness : DEFAULT_HARNESS;

  const roleApplies = !!role && roleHarness === harness;
  const model = (choice.model ?? '') || (roleApplies ? role!.model ?? '' : '');
  // The role's effort only applies when the model in play is the role's model, or the harness default when it names none.
  const modelIsRole = roleApplies && !choice.model && (!role!.model || model === role!.model);
  const effort = (choice.effort ?? '') || (modelIsRole ? role!.effort ?? '' : '');

  const h = getHarness(cat, harness);
  if (!h) return { ok: false, error: `Unknown harness "${harness}".` };
  if (!h.available && h.models.length === 0) {
    return { ok: false, error: unavailableError(h.name, h.fix) };
  }
  if (model || effort) {
    const modelForCheck = model || h.models.find((m) => m.default)?.id || h.models[0]?.id || '';
    const check = validateRun(cat, harness, modelForCheck, effort);
    if (!check.ok) return check;
  }
  return { ok: true, harness, model, effort };
}

/** A run on a GPT model: anything on Codex, or a `gpt-*` model on another harness (Cursor). */
export const isGptRun = (run: { harness: string; model?: string | null }) => run.harness === 'codex' || /^gpt-/i.test(run.model ?? '');

/**
 * The effort a thread in this role runs at. A review role (`review: true`, crew/reviewer.md) on a GPT model gets high
 * whatever was asked, xhigh included: the rule for GPT reviews. Every other run, Claude reviewers included, keeps the
 * effort it asked for. A model whose catalog entry lists no efforts keeps its own (Cursor families without effort variants).
 */
export function reviewerEffort(run: { harness: string; model?: string | null; effort?: string | null }, role: { review?: boolean } | null | undefined, cat: Catalog): string {
  const asked = run.effort ?? '';
  if (!role?.review || !isGptRun(run)) return asked;
  const h = isHarnessId(run.harness) ? getHarness(cat, run.harness) : undefined;
  const m = run.model ? (isHarnessId(run.harness) ? resolveModel(cat, run.harness, run.model) : null) : (h?.models.find((x) => x.default) ?? h?.models[0]);
  if (!m) return GPT_REVIEW_EFFORT;
  return m.efforts.length ? nearestEffort(m, GPT_REVIEW_EFFORT) : asked;
}

/** Validate a role, channel or automation's declared defaults against the catalog, for the settings pages. */
export function validateDefaults(defaults: RoleDefaults, cat: Catalog): string | undefined {
  if (asksAuto(defaults)) return defaults.effort ? `Auto picks the effort, so leave it empty (got "${defaults.effort}")` : undefined;
  if (defaults.harness && !isHarnessId(defaults.harness)) {
    return `unknown harness "${defaults.harness}" (valid: ${Object.keys(HARNESS_META).join(', ')})`;
  }
  const harness = (isHarnessId(defaults.harness) ? defaults.harness : DEFAULT_HARNESS) as HarnessId;
  const h = getHarness(cat, harness);
  if (!h || h.models.length === 0) return undefined; // catalog not loaded for this harness: pass through
  if (defaults.model || defaults.effort) {
    const modelForCheck = defaults.model || h.models.find((m) => m.default)?.id || h.models[0]?.id || '';
    const check = validateRun(cat, harness, modelForCheck, defaults.effort ?? '');
    if (!check.ok) return check.error;
  }
  return undefined;
}
