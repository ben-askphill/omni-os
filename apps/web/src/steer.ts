/** One row of `GET /api/harnesses`, enough to decide whether a busy thread can steer. */
export interface SteerCatalogRow {
  id: string;
  capabilities: { steer: boolean };
}

/**
 * Whether a follow-up on a busy thread can steer.
 *
 * The catalog is the server's harness list. While it is still loading (`null` or `undefined`),
 * or when this harness has no row, anything other than Cursor can steer. A matching row uses
 * that row's `capabilities.steer`, even when it disagrees with the fallback.
 */
export function canSteer(harnessId: string, catalog: SteerCatalogRow[] | null | undefined): boolean {
  if (catalog == null) return harnessId !== 'cursor';
  const row = catalog.find((h) => h.id === harnessId);
  if (!row) return harnessId !== 'cursor';
  return row.capabilities.steer;
}
