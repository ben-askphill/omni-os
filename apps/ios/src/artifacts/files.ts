import type { Artifact } from '@omni/client-core';
import { Directory, File, Paths } from 'expo-file-system';

import type { LiveHub } from '../live/hub';
import { cacheFileName } from './viewer-kind';

type Version = Pick<Artifact, 'id' | 'name' | 'size' | 'updated_at'>;
type Session = Pick<LiveHub, 'fetchArtifactFile'>;

/** How many files download at once, so a Library of images does not open sixty connections. */
const PARALLEL = 3;

const rootDir = () => new Directory(Paths.cache, 'omni-artifacts');

/**
 * Each session's hub gets its own generation: an id no earlier session or launch of the app used, its own folder in the
 * cache, and one abort for its downloads. A file, a share copy or a download of one generation is never handed to
 * another, so a viewer opened after a server switch never shows the last server's bytes, even for an artifact with the
 * same id and version.
 */
interface Generation {
  id: string;
  downloads: AbortController;
}

const generations = new WeakMap<Session, Generation>();
let current: Generation | null = null;
let started = 0;

const sessionDir = (generation: Generation) => new Directory(rootDir(), generation.id);
const inside = (file: File, dir: Directory) => file.uri.startsWith(dir.uri.endsWith('/') ? dir.uri : `${dir.uri}/`);

const inFlight = new Map<string, Promise<File>>();
const waiting: (() => void)[] = [];
let running = 0;

class EndedSession extends Error {
  constructor() {
    super('The server changed while this file loaded.');
  }
}

/** The hub's generation while it is the session in use. An ended session gets no file at all. */
function liveGeneration(hub: Session): Generation {
  const generation = generations.get(hub);
  if (!generation || generation !== current) throw new EndedSession();
  return generation;
}

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
 * Starts the cache for a new session's hub. Runs when a session starts. The last session's downloads are aborted, so
 * they free their slots and cache nothing, and every file and share copy it kept is deleted.
 */
export function startArtifactSession(hub: Session): void {
  current?.downloads.abort();
  started += 1;
  // The time keeps the id apart from an earlier launch's, whose folder may still be there if the delete below fails.
  current = { id: `${Date.now().toString(36)}-${started}`, downloads: new AbortController() };
  generations.set(hub, current);
  try {
    const dir = rootDir();
    if (dir.exists) dir.delete();
  } catch {
    // A cache that will not clear is only stale: this session reads its own folder.
  }
}

/**
 * The artifact's file in this session's cache, fetched with the token if it is not there. A rewrite changes the name, so
 * a copy is never shown for a newer version. The file holds the artifact's bytes and nothing else.
 */
export function artifactFile(hub: Session, artifact: Version): Promise<File> {
  let generation: Generation;
  try {
    generation = liveGeneration(hub);
  } catch (e) {
    return Promise.reject(e);
  }
  const name = cacheFileName(artifact);
  const dir = sessionDir(generation);
  const file = new File(dir, name);
  if (file.exists && file.size === artifact.size) return Promise.resolve(file);

  const key = `${generation.id}/${name}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const ended = () => generation !== current;
  const load = slot(async () => {
    try {
      // A download that waited for a slot past a server switch is not started.
      if (ended()) throw new EndedSession();
      // The session's abort, not a viewer's: viewers share one download, and only a server switch ends it.
      const { bytes } = await hub.fetchArtifactFile(artifact, generation.downloads.signal);
      if (ended()) throw new EndedSession();
      dir.create({ idempotent: true, intermediates: true });
      file.create({ overwrite: true });
      await file.write(bytes);
      if (ended()) throw new EndedSession();
      return file;
    } catch (e) {
      if (!ended()) throw e;
      // Whatever failed after a switch, the answer is the same, and none of the bytes stay in the cache.
      try {
        if (file.exists) file.delete();
      } catch {
        // The next session's start deletes the folder.
      }
      throw new EndedSession();
    }
  }).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, load);
  return load;
}

/**
 * A copy of the file the viewer opened, under the artifact's own name, so the share sheet offers "report.html" and not
 * a cache key. Only a file from this session's own folder is copied, and the copy lives there too, so the next session's
 * start deletes it.
 */
export async function shareableFile(hub: Session, file: File, artifact: Pick<Artifact, 'id' | 'name'>): Promise<File> {
  const generation = liveGeneration(hub);
  const sessionFolder = sessionDir(generation);
  // A server switch can leave the viewer holding the last session's file.
  if (!inside(file, sessionFolder)) throw new EndedSession();
  const dir = new Directory(sessionFolder, 'share', String(artifact.id));
  dir.create({ idempotent: true, intermediates: true });
  const copy = new File(dir, artifact.name.replace(/[/\\]/g, '_'));
  await file.copy(copy, { overwrite: true });
  // A switch during the copy, with a folder that would not clear, leaves the copy in the last session's folder.
  if (generation !== current) {
    try {
      if (copy.exists) copy.delete();
    } catch {
      // The next session's start deletes the folder.
    }
    throw new EndedSession();
  }
  return copy;
}
