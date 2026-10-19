// The run resolver decides what a thread runs on, in this order:
//   1. the thread's own choice (composer, automation or conductor);
//   2. the crew role's default;
//   3. the channel's default;
//   4. Claude Code with its default model.
// A role that sets any of harness, model or effort replaces the channel's default whole; the two never mix.
// The defaults' model and effort only apply when the thread runs on their harness, and their effort
// only when their model is the one picked (or, when they name no model, the harness default is). Pure, so it is testable.
import { isHarnessId, DEFAULT_HARNESS, HARNESS_META, type HarnessId } from './types.ts';
import { getHarness, unavailableError, validateRun, type Catalog, type Resolved, type ResolveError } from './catalog.ts';

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

export function resolveRun(choice: RunChoice, roleDefaults: RoleDefaults | undefined, cat: Catalog, channel?: RoleDefaults): Resolved | ResolveError {
  // The role's defaults when it sets any, else the channel's. Below, "role" is whichever applies.
  const role = setsRun(roleDefaults) ? roleDefaults : setsRun(channel) ? channel : roleDefaults;
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

/** Validate a role, channel or automation's declared defaults against the catalog, for the settings pages. */
export function validateDefaults(defaults: RoleDefaults, cat: Catalog): string | undefined {
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
