import type { Artifact, ArtifactWithThread } from '@omni/client-core';
import { crewShown } from '@omni/shared/crew-artifacts.ts';

/** What a thread's Artifacts screen lists: the set desktop's Files and Browser tabs show for it, in one list. */
export interface ThreadArtifacts {
  /** The thread's own files and screenshots, newest first. */
  own: Artifact[];
  /** Those of the threads it delegated to, at any depth, newest first, less any it lists itself. */
  crew: ArtifactWithThread[];
}

const newestFirst = (a: Artifact, b: Artifact) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : b.id - a.id);

/**
 * The thread's artifacts and its crew's, as desktop lists them: a crew file the thread lists itself (the same row, or
 * the same published page) shows only under the thread, and a page two delegated threads published shows once
 * (packages/shared/crew-artifacts.ts). Screenshots sit with the files, since the phone has no Browser tab.
 */
export function threadArtifacts(own: readonly Artifact[], crew: readonly ArtifactWithThread[]): ThreadArtifacts {
  const shown = crewShown(own, crew);
  return { own: [...own].sort(newestFirst), crew: [...shown.files, ...shown.shots].sort(newestFirst) };
}
