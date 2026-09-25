// The run resolver decides what a thread runs on, in this order:
//   1. the thread's own choice (composer, automation or conductor);
//   2. the crew role's default;
//   3. Claude Code with its default model.
// A role's model and effort only apply when the thread runs on the role's harness, and the
// role's effort only when the role's model is the one picked. Pure, so it is testable.
import { isHarnessId, DEFAULT_HARNESS, HARNESS_META, type HarnessId } from './types.ts';
import { getHarness, validateRun, type Catalog, type Resolved, type ResolveError } from './catalog.ts';

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

export function resolveRun(choice: RunChoice, role: RoleDefaults | undefined, cat: Catalog): Resolved | ResolveError {
  if (choice.harness && !isHarnessId(choice.harness)) return { ok: false, error: `Unknown harness "${choice.harness}".` };
  if (role?.harness && !isHarnessId(role.harness)) return { ok: false, error: `Unknown harness "${role.harness}".` };

  // A role that sets only a model stays on Claude Code.
  const roleHarness = role ? role.harness ?? DEFAULT_HARNESS : undefined;
  const harness: HarnessId = isHarnessId(choice.harness) ? choice.harness : isHarnessId(roleHarness) ? roleHarness : DEFAULT_HARNESS;

  const roleApplies = !!role && roleHarness === harness;
  const model = (choice.model ?? '') || (roleApplies ? role!.model ?? '' : '');
  // The role's effort only applies when the model in play is the role's model.
  const modelIsRole = roleApplies && !!role!.model && !choice.model && model === role!.model;
  const effort = (choice.effort ?? '') || (modelIsRole ? role!.effort ?? '' : '');

  const h = getHarness(cat, harness);
  if (!h) return { ok: false, error: `Unknown harness "${harness}".` };
  if (!h.available && h.models.length === 0) {
    return { ok: false, error: `${h.name} is not available. Run \`${h.fix ?? ''}\`.`.trim() };
  }
  if (model || effort) {
    const modelForCheck = model || h.models.find((m) => m.default)?.id || h.models[0]?.id || '';
    const check = validateRun(cat, harness, modelForCheck, effort);
    if (!check.ok) return check;
  }
  return { ok: true, harness, model, effort };
}

/** Validate a role or automation's declared defaults against the catalog, for the settings pages. */
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
