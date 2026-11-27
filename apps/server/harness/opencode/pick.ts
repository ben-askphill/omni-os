// Which OpenCode model a thread runs on when it names none. Pure: the catalog reads it without loading Omni's config.

/** The provider whose models need no account: OpenCode Zen. */
export const ZEN = 'opencode/';
/** The free DeepSeek model on Zen. A preference, never a promise: the live list decides whether it exists. */
export const PREFERRED = 'opencode/deepseek-v4.1-flash-free';

/** Ordinary choice of a thread that names no model: the preferred free one when listed, else a free Zen model, else the first Zen model. */
export function defaultModel(list: readonly { id: string }[]): string | null {
  return list.find((m) => m.id === PREFERRED)?.id ?? list.find((m) => m.id.startsWith(ZEN) && /-free$/.test(m.id))?.id ?? list.find((m) => m.id.startsWith(ZEN))?.id ?? null;
}
