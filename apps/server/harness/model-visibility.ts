// Ben's choice of which models the pickers list (packages/shared/model-visibility.ts has the rule). Kept in kv, so it
// syncs to his other machines like the rest of his preferences. The catalog stays whole: validation, Auto, crew role
// defaults and automations see every model, and only GET /harnesses marks the ones a picker leaves out.
import { kv } from '../db.ts';
import {
  hiddenModelIds,
  normalizePrefs,
  parseModelVisibility,
  type HarnessModelPrefs,
  type ModelVisibility,
} from '@omni/shared/model-visibility.ts';
import type { HarnessInfo } from './types.ts';

const KEY = 'model-visibility';

export const modelVisibility = (): ModelVisibility => parseModelVisibility(kv.get<unknown>(KEY));

/** Save one harness's prefs. Nothing changed from the rule stores nothing for it. */
export function setHarnessModelPrefs(harness: string, prefs: HarnessModelPrefs): ModelVisibility {
  const all = modelVisibility();
  const next = normalizePrefs(prefs);
  if (Object.keys(next).length) all[harness] = next;
  else delete all[harness];
  kv.set(KEY, all);
  return all;
}

/** The harness with `hidden: true` on each model its picker leaves out. */
export function markHidden(h: HarnessInfo, prefs: ModelVisibility = modelVisibility()): HarnessInfo {
  const hidden = hiddenModelIds(h.models, prefs[h.id]);
  if (!hidden.size) return h;
  return { ...h, models: h.models.map((m) => (hidden.has(m.id) ? { ...m, hidden: true } : m)) };
}
