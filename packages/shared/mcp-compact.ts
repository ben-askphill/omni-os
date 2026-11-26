// Compact JSON helpers for Omni MCP tool outputs: serialize without pretty-print indentation, and drop null, false
// and empty-array default keys from list rows while keeping fields whose absence would change meaning.
//
// Erasable TypeScript and Hermes-safe built-ins only: external stdio MCP runs under plain `node`, and packages/shared
// is imported by the iOS app too.

/** Keys whose null, false or empty-array value stays because omitting them changes meaning (for example a boolean that defaults to true). */
export type KeepKeys<T extends object = Record<string, unknown>> = readonly (keyof T & string)[] | ReadonlySet<string>;

const isKept = (keep: KeepKeys | undefined, key: string): boolean => {
  if (!keep) return false;
  return Array.isArray(keep) ? keep.includes(key) : (keep as ReadonlySet<string>).has(key);
};

/**
 * Copy one list row, dropping keys whose value is `undefined`, `null`, `false`, or `[]`.
 * Pass `keep` for fields whose absence would change meaning (such as `enabled` or `available`).
 */
export function compactRow<T extends object>(row: T, keep?: KeepKeys<T>): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) continue;
    if (!isKept(keep, key) && (value === null || value === false || (Array.isArray(value) && value.length === 0))) continue;
    out[key] = value;
  }
  return out as Partial<T>;
}

/** Apply `compactRow` to every row in a list. */
export function compactRows<T extends object>(rows: readonly T[], keep?: KeepKeys<T>): Partial<T>[] {
  return rows.map((row) => compactRow(row, keep));
}

/** Compact JSON text for an MCP tool result: strings pass through unchanged, everything else uses `JSON.stringify(v)`. */
export function compactJson(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
