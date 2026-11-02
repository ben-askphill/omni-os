import { useSyncExternalStore } from 'react';

import { createStore } from '../live/store';
import { MAX_ATTACHMENTS, removeStaged, stage, type Problem, type Staged } from './model';

const NONE: readonly Staged[] = [];

/**
 * The files Ben has chosen for each thread's next message. Module level like the text drafts (components/thread/drafts),
 * so they survive leaving the thread and a failed message's Edit can put its files back from outside the composer.
 */
const staged = createStore<Readonly<Record<string, readonly Staged[]>>>({});

export const getStaged = (threadId: string): readonly Staged[] => staged.get()[threadId] ?? NONE;

function setStaged(threadId: string, list: readonly Staged[]): void {
  staged.set((all) => {
    const { [threadId]: _gone, ...rest } = all;
    return list.length ? { ...rest, [threadId]: list } : rest;
  });
}

/** Adds files. Returns what was left out and why. */
export function addStaged(threadId: string, incoming: readonly Staged[], maxMb: number): readonly Problem[] {
  const { list, problems } = stage(getStaged(threadId), incoming, maxMb);
  setStaged(threadId, list);
  return problems;
}

export const removeStagedFile = (threadId: string, id: string): void => setStaged(threadId, removeStaged(getStaged(threadId), id));

export const clearStaged = (threadId: string): void => setStaged(threadId, NONE);

/** Puts files back in front of whatever was chosen since, so neither is lost. */
export function restoreStaged(threadId: string, files: readonly Staged[]): void {
  const have = new Set(files.map((f) => f.uri));
  setStaged(threadId, [...files, ...getStaged(threadId).filter((f) => !have.has(f.uri))].slice(0, MAX_ATTACHMENTS));
}

export function useStaged(threadId: string): readonly Staged[] {
  return useSyncExternalStore(staged.subscribe, () => getStaged(threadId));
}
