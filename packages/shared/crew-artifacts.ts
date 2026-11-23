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

/** Newest first; at the same time, the later row. */
export const newestFirst = <A extends Pick<CrewArtifactRow, 'id' | 'updated_at'>>(a: A, b: A) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : b.id - a.id);

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

/** Several lists of artifacts as one, newest first: a phone's, which has no Browser tab to put screenshots on. */
export const newestList = <A extends Pick<CrewArtifactRow, 'id' | 'updated_at'>>(...lists: readonly (readonly A[])[]): A[] => lists.flat().sort(newestFirst);

/**
 * What a phone lists for a thread (phone web's Files view, the iOS Artifacts screen): its own files and screenshots
 * in one list, and its crew's in another, less what the thread lists itself (crewShown), each newest first.
 */
export function phoneArtifacts<O extends Pick<CrewArtifactRow, 'id' | 'url' | 'updated_at'>, A extends CrewArtifactRow>(own: readonly O[], crew: readonly A[]): { own: O[]; crew: A[] } {
  const shown = crewShown(own, crew);
  return { own: newestList(own), crew: newestList(shown.files, shown.shots) };
}

/** The thread a crew artifact came from, as its row names it. */
export const crewFrom = (a: { thread_title?: string | null }): string => a.thread_title || 'Untitled';

/** A crew artifact on a parent's stream, where a client gets it untyped: the fields the merge reads. */
export function isCrewArtifact<A extends CrewArtifactRow = CrewArtifactRow>(v: unknown): v is A {
  const r = v as Partial<CrewArtifactRow> | null;
  return !!r && typeof r === 'object' && !Array.isArray(r) && typeof r.id === 'number' && typeof r.thread_id === 'string' && typeof r.updated_at === 'string';
}
