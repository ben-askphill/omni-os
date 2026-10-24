/** One row of `GET /api/harnesses`, enough to decide whether a busy thread can steer. */
export interface SteerCatalogRow {
  id: string;
  capabilities: { steer: boolean };
}

/**
 * Whether a follow-up on a busy thread can steer.
 *
 * The catalog is the server's harness list. While it is still loading (`null` or `undefined`),
 * or when this harness has no row, anything other than Cursor and Cursor Cloud can steer. A matching row uses
 * that row's `capabilities.steer`, even when it disagrees with the fallback.
 */
export function canSteer(harnessId: string, catalog: SteerCatalogRow[] | null | undefined): boolean {
  const fallback = harnessId !== 'cursor' && harnessId !== 'cursor-cloud';
  if (catalog == null) return fallback;
  const row = catalog.find((h) => h.id === harnessId);
  if (!row) return fallback;
  return row.capabilities.steer;
}
