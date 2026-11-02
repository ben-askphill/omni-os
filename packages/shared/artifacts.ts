// How clients group artifacts, so the Library filters and the CSV table read the same on every surface.

export const ARTIFACT_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'html', label: 'Pages' },
  { id: 'image', label: 'Images' },
  { id: 'doc', label: 'Docs' },
  { id: 'data', label: 'Data' },
] as const;
export type ArtifactFilter = (typeof ARTIFACT_FILTERS)[number]['id'];

export const matchesArtifactFilter = (f: ArtifactFilter, kind: string) =>
  f === 'all' ||
  (f === 'html' && (kind === 'html' || kind === 'svg')) ||
  (f === 'image' && kind === 'image') ||
  (f === 'doc' && (kind === 'markdown' || kind === 'pdf' || kind === 'text')) ||
  (f === 'data' && (kind === 'csv' || kind === 'json'));

/** Minimal CSV parser: quotes, escaped quotes, commas and newlines inside quotes. Stops at `maxRows` and says so. */
export function parseCsv(src: string, maxRows = 500): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (rows.length >= maxRows) return { rows, truncated: true };
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return { rows, truncated: false };
}
