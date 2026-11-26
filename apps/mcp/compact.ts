// Compact JSON encoding and row-default stripping shared by the Conductor MCP server (omni.ts) and the external MCP
// server (external/tools.ts). Erasable TypeScript only: clients start external/stdio.ts with plain `node`.

/** One MCP text result, serialized as compact JSON for non-strings (no pretty-print whitespace). */
export const text = (v: unknown) => ({
  content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v) }],
});

/**
 * Copy a list row without null, false, undefined or empty-array default keys.
 * Pass `keep` for keys whose absence changes meaning (for example a boolean that defaults to true, or a nullable scope
 * field where null means "all").
 */
export function compactRow<T extends object>(row: T, keep?: readonly (keyof T & string)[]): Record<string, unknown> {
  const kept = keep?.length ? new Set<string>(keep) : null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue;
    if (!kept?.has(k) && (v === null || v === false || (Array.isArray(v) && v.length === 0))) continue;
    out[k] = v;
  }
  return out;
}

/** Apply `compactRow` to every row of a list. */
export function compactRows<T extends object>(rows: readonly T[], keep?: readonly (keyof T & string)[]): Record<string, unknown>[] {
  return rows.map((row) => compactRow(row, keep));
}
