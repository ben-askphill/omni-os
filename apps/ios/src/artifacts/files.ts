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
 * Each session's hub gets its own generation and its own folder in the cache. A file, a share copy or a download of
 * one generation is never handed to another, so a viewer opened after a server switch never shows the last server's
 * bytes, even for an artifact with the same id and version.
 */
const generations = new WeakMap<Session, number>();
let current = 0;

const sessionDir = (generation: number) => new Directory(rootDir(), String(generation));

const inFlight = new Map<string, Promise<File>>();
const waiting: (() => void)[] = [];
let running = 0;

class EndedSession extends Error {
  constructor() {
    super('The server changed while this file loaded.');
  }
}

/** The hub's generation while it is the session in use, else an error: an ended session gets no file at all. */
function liveGeneration(hub: Session): number {
  const generation = generations.get(hub);
  if (generation === undefined || generation !== current) throw new EndedSession();
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
 * Starts the cache for a new session's hub. Runs when a session starts. Every file and share copy an earlier session
 * kept is deleted, and its downloads still on the way are refused when they finish, so nothing of theirs is cached.
 */
export function startArtifactSession(hub: Session): void {
  current += 1;
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
  let generation: number;
  try {
    generation = liveGeneration(hub);
  } catch (e) {
    return Promise.reject(e);
  }
  const name = cacheFileName(artifact);
  const dir = sessionDir(generation);
  const file = new File(dir, name);
  if (file.exists && file.size === artifact.size) return Promise.resolve(file);

  const key = `${generation}/${name}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const load = slot(async () => {
    // A download that waited for a slot past a server switch is not started.
    liveGeneration(hub);
    // No abort signal: callers share one download, and a finished one lands in the cache for the next open.
    const { bytes } = await hub.fetchArtifactFile(artifact);
    // The server changed while it came in: its bytes are not this session's.
    liveGeneration(hub);
    dir.create({ idempotent: true, intermediates: true });
    file.create({ overwrite: true });
    await file.write(bytes);
    if (generation !== current) {
      file.delete();
      throw new EndedSession();
    }
    return file;
  }).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, load);
  return load;
}

/**
 * A copy of the artifact's cached file under its own name, so the share sheet offers "report.html" and not a cache key.
 * It comes from this session's cache, and the copy lives there too, so the next session's start deletes it.
 */
export async function shareableFile(hub: Session, artifact: Version): Promise<File> {
  const file = await artifactFile(hub, artifact);
  const dir = new Directory(sessionDir(liveGeneration(hub)), 'share', String(artifact.id));
  dir.create({ idempotent: true, intermediates: true });
  const copy = new File(dir, artifact.name.replace(/[/\\]/g, '_'));
  await file.copy(copy, { overwrite: true });
  return copy;
}
