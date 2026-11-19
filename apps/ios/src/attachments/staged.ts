import { useSyncExternalStore } from 'react';

import { createStore } from '../live/store';
import type { ThreadKey } from '../live/thread-key';
import { MAX_ATTACHMENTS, removeStaged, stage, type Problem, type Staged } from './model';

const NONE: readonly Staged[] = [];

/**
 * The files Ben has chosen for each thread's next message, per server and thread (live/thread-key.ts). Module level like
 * the text drafts (components/thread/drafts), so they survive leaving the thread and a failed message's Edit can put its
 * files back from outside the composer. Files chosen on one server never show on another server's thread with that id.
 */
const staged = createStore<Readonly<Record<string, readonly Staged[]>>>({});

export const getStaged = (key: ThreadKey): readonly Staged[] => staged.get()[key] ?? NONE;

function setStaged(key: ThreadKey, list: readonly Staged[]): void {
  staged.set((all) => {
    const { [key]: _gone, ...rest } = all;
    return list.length ? { ...rest, [key]: list } : rest;
  });
}

/** Adds files. Returns what was left out and why. */
export function addStaged(key: ThreadKey, incoming: readonly Staged[], maxMb: number): readonly Problem[] {
  const { list, problems } = stage(getStaged(key), incoming, maxMb);
  setStaged(key, list);
  return problems;
}

export const removeStagedFile = (key: ThreadKey, id: string): void => setStaged(key, removeStaged(getStaged(key), id));

export const clearStaged = (key: ThreadKey): void => setStaged(key, NONE);

/** Puts files back in front of whatever was chosen since, so neither is lost. */
export function restoreStaged(key: ThreadKey, files: readonly Staged[]): void {
  const have = new Set(files.map((f) => f.uri));
  setStaged(key, [...files, ...getStaged(key).filter((f) => !have.has(f.uri))].slice(0, MAX_ATTACHMENTS));
}

export function useStaged(key: ThreadKey): readonly Staged[] {
  return useSyncExternalStore(staged.subscribe, () => getStaged(key));
}
