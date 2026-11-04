// The artifacts and screenshots a thread's crew made, as its panel lists them beside its own. The crew is every thread
// it delegated to, at any depth (a team's members under their lead). The server sends the newest CREW_ARTIFACTS_MAX
// with the thread detail and each new one on the parent's stream; the clients merge them here.

/** How many of the crew's artifacts the detail carries and a client keeps. */
export const CREW_ARTIFACTS_MAX = 200;

/** What the merge reads of an artifact row. */
export interface CrewArtifactRow {
  id: number;
  thread_id: string;
  kind: string;
  /** The claude.ai page it was published as, if it was. */
  url: string | null;
  updated_at: string;
}

const newestFirst = <A extends CrewArtifactRow>(a: A, b: A) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : b.id - a.id);

/** Add or replace one crew artifact: newest first, at most CREW_ARTIFACTS_MAX. */
export function withCrewArtifact<A extends CrewArtifactRow>(list: readonly A[], a: A): A[] {
  return [a, ...list.filter((x) => x.id !== a.id)].sort(newestFirst).slice(0, CREW_ARTIFACTS_MAX);
}

/**
 * The crew's artifacts the panel shows, newest first, split into files and browser screenshots. One the thread lists
 * itself (the same row, or the same published page) shows only there, and a page two delegated threads published
 * shows once, under the newer.
 */
export function crewShown<A extends CrewArtifactRow>(own: readonly Pick<CrewArtifactRow, 'id' | 'url'>[], crew: readonly A[]): { files: A[]; shots: A[] } {
  const ids = new Set(own.map((a) => a.id));
  const urls = new Set(own.flatMap((a) => (a.url ? [a.url] : [])));
  const files: A[] = [];
  const shots: A[] = [];
  for (const a of [...crew].sort(newestFirst)) {
    if (ids.has(a.id) || (a.url && urls.has(a.url))) continue;
    ids.add(a.id);
    if (a.url) urls.add(a.url);
    (a.kind === 'screenshot' ? shots : files).push(a);
  }
  return { files, shots };
}
