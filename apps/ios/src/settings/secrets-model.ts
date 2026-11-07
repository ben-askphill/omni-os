import type { SecretRow } from '@omni/client-core';

/** UPPER_SNAKE_CASE, as the server takes it. */
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

export const GLOBAL_SCOPE = 'global';
export const channelScope = (channelId: string) => `channel:${channelId}`;

export function scopeLabel(scope: string, nameOf: (channelId: string) => string | undefined): string {
  if (scope === GLOBAL_SCOPE) return 'Global';
  const id = scope.replace(/^channel:/, '');
  return `#${nameOf(id) ?? id}`;
}

export interface SecretGroup {
  scope: string;
  rows: SecretRow[];
}

/**
 * The names grouped by scope, global first. With a channel, what that channel's threads get, as the Web UI's Secrets
 * section lists it: its own first, then the global ones it does not override.
 */
export function secretGroups(rows: readonly SecretRow[], channelId?: string): SecretGroup[] {
  const own = channelId ? rows.filter((s) => s.scope === channelScope(channelId)) : null;
  const shown = own ? [...own, ...rows.filter((s) => s.scope === GLOBAL_SCOPE && !own.some((o) => o.name === s.name))] : [...rows];
  const byScope = new Map<string, SecretRow[]>();
  for (const s of shown) byScope.set(s.scope, [...(byScope.get(s.scope) ?? []), s]);
  const groups = [...byScope.entries()]
    .sort(([a], [b]) => (a === GLOBAL_SCOPE ? -1 : b === GLOBAL_SCOPE ? 1 : a.localeCompare(b)))
    .map(([scope, list]) => ({ scope, rows: list.sort((x, y) => x.name.localeCompare(y.name)) }));
  return own ? groups.reverse() : groups;
}

/** Why the form cannot save, or null. */
export function secretProblem(name: string, value: string): string | null {
  if (!SECRET_NAME.test(name)) return 'Use UPPER_SNAKE_CASE: a capital letter, then capitals, digits or underscores.';
  if (!value) return 'Paste a value.';
  if (/[\r\n]/.test(value)) return 'The value must be a single line.';
  return null;
}
