// Claude Code's short model names. Roles, the Conductor and OMNI_DEFAULT_MODEL may name a model this way, so every
// picker that shows a saved run reads them as the catalog id.

/** The short aliases stay valid for roles and the conductor. */
export const CLAUDE_ALIASES: Record<string, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-4-5',
  fable: 'claude-fable-5-2',
};

/** A Claude Code model as the catalog lists it: the id an alias stands for, or the model as given. */
export const claudeModelId = (model: string) => CLAUDE_ALIASES[model] ?? model;
