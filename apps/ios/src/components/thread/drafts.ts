import { useEffect, useSyncExternalStore, type RefObject } from 'react';

import { createStore } from '../../live/store';
import type { ThreadKey } from '../../live/thread-key';

/**
 * What Ben has typed in each thread's composer, per server and thread (live/thread-key.ts). It lives at module level,
 * so a draft survives leaving the thread and coming back, and so a failed message's Edit can put its text back from
 * outside the composer. A draft for one server's thread never shows on another server's thread with the same id.
 */
const drafts = createStore<Readonly<Record<string, string>>>({});

export function getDraft(key: ThreadKey): string {
  return drafts.get()[key] ?? '';
}

export function setDraft(key: ThreadKey, text: string): void {
  drafts.set((all) => {
    if ((all[key] ?? '') === text) return all;
    const { [key]: _gone, ...rest } = all;
    return text ? { ...rest, [key]: text } : rest;
  });
}

/** Puts text back in front of whatever has been typed since, so neither is lost. */
export function restoreDraft(key: ThreadKey, text: string): void {
  const typed = getDraft(key);
  setDraft(key, typed.trim() ? `${text}\n\n${typed}` : text);
}

const focusers = new Map<ThreadKey, Set<() => void>>();

/** Asks the thread's mounted composer to take focus. Nothing happens when it is not on screen. */
export function requestFocus(key: ThreadKey): void {
  for (const focus of focusers.get(key) ?? []) focus();
}

/** Calls `focus` on each `requestFocus` for the thread, until the returned function is called. */
export function onFocusRequest(key: ThreadKey, focus: () => void): () => void {
  const set = focusers.get(key) ?? new Set<() => void>();
  set.add(focus);
  focusers.set(key, set);
  return () => {
    set.delete(focus);
    if (set.size === 0) focusers.delete(key);
  };
}

/** Hands the composer's box to `requestFocus` while it is mounted. */
export function useFocusRequests(key: ThreadKey, input: RefObject<{ focus(): void } | null>): void {
  useEffect(() => onFocusRequest(key, () => input.current?.focus()), [key, input]);
}

/** Moves a message back into the box to be reworded, and puts the cursor there. */
export function editInComposer(key: ThreadKey, text: string): void {
  restoreDraft(key, text);
  requestFocus(key);
}

export function useDraft(key: ThreadKey): string {
  return useSyncExternalStore(drafts.subscribe, () => getDraft(key));
}
