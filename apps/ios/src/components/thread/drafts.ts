import { useEffect, useSyncExternalStore, type RefObject } from 'react';

import { createStore } from '../../live/store';

/**
 * What Ben has typed in each thread's composer. It lives at module level, so a draft survives leaving the thread and
 * coming back, and so a failed message's Edit can put its text back from outside the composer.
 */
const drafts = createStore<Readonly<Record<string, string>>>({});

export function getDraft(threadId: string): string {
  return drafts.get()[threadId] ?? '';
}

export function setDraft(threadId: string, text: string): void {
  drafts.set((all) => {
    if ((all[threadId] ?? '') === text) return all;
    const { [threadId]: _gone, ...rest } = all;
    return text ? { ...rest, [threadId]: text } : rest;
  });
}

/** Puts text back in front of whatever has been typed since, so neither is lost. */
export function restoreDraft(threadId: string, text: string): void {
  const typed = getDraft(threadId);
  setDraft(threadId, typed.trim() ? `${text}\n\n${typed}` : text);
}

const focusers = new Map<string, Set<() => void>>();

/** Asks the thread's mounted composer to take focus. Nothing happens when it is not on screen. */
export function requestFocus(threadId: string): void {
  for (const focus of focusers.get(threadId) ?? []) focus();
}

/** Calls `focus` on each `requestFocus` for the thread, until the returned function is called. */
export function onFocusRequest(threadId: string, focus: () => void): () => void {
  const set = focusers.get(threadId) ?? new Set<() => void>();
  set.add(focus);
  focusers.set(threadId, set);
  return () => {
    set.delete(focus);
    if (set.size === 0) focusers.delete(threadId);
  };
}

/** Hands the composer's box to `requestFocus` while it is mounted. */
export function useFocusRequests(threadId: string, input: RefObject<{ focus(): void } | null>): void {
  useEffect(() => onFocusRequest(threadId, () => input.current?.focus()), [threadId, input]);
}

/** Moves a message back into the box to be reworded, and puts the cursor there. */
export function editInComposer(threadId: string, text: string): void {
  restoreDraft(threadId, text);
  requestFocus(threadId);
}

export function useDraft(threadId: string): string {
  return useSyncExternalStore(drafts.subscribe, () => getDraft(threadId));
}
