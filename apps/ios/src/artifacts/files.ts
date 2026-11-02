import type { Artifact } from '@omni/client-core';
import { Directory, File, Paths } from 'expo-file-system';

import type { LiveHub } from '../live/hub';
import { cacheFileName } from './viewer-kind';

type Version = Pick<Artifact, 'id' | 'name' | 'size' | 'updated_at'>;

/** How many files download at once, so a Library of images does not open sixty connections. */
const PARALLEL = 3;

const cacheDir = () => new Directory(Paths.cache, 'omni-artifacts');

const inFlight = new Map<string, Promise<File>>();
const waiting: (() => void)[] = [];
let running = 0;

async function slot<T>(run: () => Promise<T>): Promise<T> {
  if (running >= PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await run();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

/**
 * The artifact's file in the app's cache, fetched with the token if it is not there. A rewrite changes the name, so a
 * copy is never shown for a newer version. The file holds the artifact's bytes and nothing else.
 */
export function artifactFile(hub: Pick<LiveHub, 'fetchArtifactFile'>, artifact: Version): Promise<File> {
  const name = cacheFileName(artifact);
  const file = new File(cacheDir(), name);
  if (file.exists && file.size === artifact.size) return Promise.resolve(file);

  const pending = inFlight.get(name);
  if (pending) return pending;
  const load = slot(async () => {
    // No abort signal: callers share one download, and a finished one lands in the cache for the next open.
    const { bytes } = await hub.fetchArtifactFile(artifact);
    cacheDir().create({ idempotent: true, intermediates: true });
    file.create({ overwrite: true });
    await file.write(bytes);
    return file;
  }).finally(() => {
    inFlight.delete(name);
  });
  inFlight.set(name, load);
  return load;
}

/** A copy of the cached file under the artifact's own name, so the share sheet offers "report.html" and not a cache key. */
export async function shareableFile(file: File, artifact: Pick<Artifact, 'id' | 'name'>): Promise<File> {
  const dir = new Directory(cacheDir(), 'share', String(artifact.id));
  dir.create({ idempotent: true, intermediates: true });
  const copy = new File(dir, artifact.name.replace(/[/\\]/g, '_'));
  await file.copy(copy, { overwrite: true });
  return copy;
}

/** Forgets every cached file. Runs when a session starts, so one server's files never show under another. */
export function clearArtifactCache(): void {
  try {
    const dir = cacheDir();
    if (dir.exists) dir.delete();
  } catch {
    // A cache that will not clear is only stale. The names carry the version.
  }
}
