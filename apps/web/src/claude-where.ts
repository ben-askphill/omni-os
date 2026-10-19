// Claude Code runs locally or as a cloud session. The server keeps them as two harnesses
// (claude-code, claude-cloud); the model picker shows one "Claude Code" group and a Local/Cloud
// toggle, as the Claude app does. Web UI only; the Mac app mirrors this in ClaudeWhere (NewThreadRules.swift).

export type ClaudeWhere = 'local' | 'cloud';

const LOCAL = 'claude-code';
const CLOUD = 'claude-cloud';

interface HarnessLike {
  id: string;
  models: { id: string; default?: boolean }[];
}

/** Where a Claude Code choice runs, or null for any other harness. */
export function claudeWhere(harness: string): ClaudeWhere | null {
  if (harness === LOCAL) return 'local';
  if (harness === CLOUD) return 'cloud';
  return null;
}

/** The picker's groups: one Claude Code group, local or cloud by the current choice, in Claude Code's place. */
export function pickerHarnesses<H extends HarnessLike>(harnesses: H[], harness: string): H[] {
  const cloud = harnesses.find((h) => h.id === CLOUD);
  return harnesses.filter((h) => h.id !== CLOUD).map((h) => (harness === CLOUD && cloud && h.id === LOCAL ? cloud : h));
}

/**
 * The choice moved to the other side: the same model when that side has it, else that side's default.
 * A choice with no model picked stays unpicked.
 */
export function switchWhere<H extends HarnessLike>(
  harnesses: H[],
  choice: { harness: string; model: string },
  where: ClaudeWhere,
): { harness: string; model: string } {
  const id = where === 'cloud' ? CLOUD : LOCAL;
  if (!choice.model) return { harness: id, model: '' };
  const models = harnesses.find((h) => h.id === id)?.models ?? [];
  if (models.some((m) => m.id === choice.model)) return { harness: id, model: choice.model };
  return { harness: id, model: (models.find((m) => m.default) ?? models[0])?.id ?? '' };
}
