// Custom harnesses: remote agents the user registers (data/harnesses/<slug>.yaml on the server), next to the built-in
// harnesses. Their ids carry a prefix, so they can never clash with a built-in or pass for one. Pure, for every client.

/** What every custom harness id starts with. */
export const CUSTOM_HARNESS_PREFIX = 'custom:';

/** A custom harness's file name and the rest of its id: lowercase letters, digits and dashes. */
export const CUSTOM_HARNESS_SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

export type CustomHarnessId = `custom:${string}`;

/** Whether an id names a custom harness, registered here or not. */
export const isCustomHarnessId = (h: string | null | undefined): h is CustomHarnessId => !!h && h.startsWith(CUSTOM_HARNESS_PREFIX);

/** The slug of a custom harness id, or null when it is not a well-formed one. */
export function customHarnessSlug(h: string | null | undefined): string | null {
  if (!isCustomHarnessId(h)) return null;
  const slug = h.slice(CUSTOM_HARNESS_PREFIX.length);
  return CUSTOM_HARNESS_SLUG.test(slug) ? slug : null;
}

/**
 * Harnesses that run off this machine: Hermes, Cursor Cloud and every custom harness. They get no worktree, browser,
 * MCP config or local files. The server reads this from each harness's `remote` capability; the clients, which have
 * only the id at hand, use this.
 */
export const isRemoteHarnessId = (h: string | null | undefined) => h === 'hermes' || h === 'cursor-cloud' || isCustomHarnessId(h);
