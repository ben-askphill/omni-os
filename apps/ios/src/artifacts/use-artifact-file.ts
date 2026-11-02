import type { Artifact } from '@omni/client-core';
import type { File } from 'expo-file-system';
import { useEffect, useState } from 'react';

import { useLiveHub } from '../live/react';
import { artifactFile } from './files';
import { tooLarge } from './viewer-kind';

export type FileLoad =
  | { status: 'loading' }
  | { status: 'ready'; file: File }
  | { status: 'too-large' }
  | { status: 'error'; message: string };

/** The artifact's file from the cache, fetched first if it is not there. A new version of the row loads again. */
export function useArtifactFile(artifact: Pick<Artifact, 'id' | 'name' | 'size' | 'updated_at'>, enabled = true): FileLoad & { retry: () => void } {
  const hub = useLiveHub();
  const [load, setLoad] = useState<FileLoad>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const { id, name, size, updated_at } = artifact;

  useEffect(() => {
    if (!enabled) return;
    if (tooLarge({ size })) {
      setLoad({ status: 'too-large' });
      return;
    }
    let live = true;
    setLoad({ status: 'loading' });
    artifactFile(hub, { id, name, size, updated_at }).then(
      (file) => live && setLoad({ status: 'ready', file }),
      (e: unknown) => live && setLoad({ status: 'error', message: e instanceof Error && e.message ? e.message : 'Could not load this file.' }),
    );
    return () => {
      live = false;
    };
  }, [hub, id, name, size, updated_at, enabled, attempt]);

  return { ...load, retry: () => setAttempt((n) => n + 1) };
}
