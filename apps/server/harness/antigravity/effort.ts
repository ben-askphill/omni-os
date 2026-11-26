// The effort an Antigravity thread runs at when it names none. agy picks one per model when the model is selected
// (models.ts keeps it as defaultEffort). Omni overrides that pick for some models; the picker shows the override as
// the default, and the adapter sets it on the session.

/**
 * Gemini 4 Neon: agy picks high. On a fixed three-turn research task, medium cost 23% less of the Gemini allowance
 * with the same answers (docs/reviews/2026-11-26-antigravity-neon-usage.md).
 */
const OMNI_EFFORT: Record<string, string> = { 'gemini-4-neon': 'medium' };

/** Omni's effort for a model the thread names no effort for, when the model offers it. Empty: agy's own pick stands. */
export function omniEffort(m: { id: string; efforts: string[] }): string {
  const own = OMNI_EFFORT[m.id];
  return own && m.efforts.includes(own) ? own : '';
}
