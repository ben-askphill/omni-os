import { useEffect, useRef, useSyncExternalStore } from 'react';
import { readPref, writePref } from './store.tsx';

/** True when a plain `key` keypress is a shortcut: no modifiers, no field or terminal focused, no layer open. */
export function isPlainKey(e: KeyboardEvent, key: string): boolean {
  if (e.key.toLowerCase() !== key || e.repeat || e.isComposing || e.defaultPrevented) return false;
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
  const el = e.target instanceof HTMLElement ? e.target : null;
  if (el && (el.isContentEditable || el.matches('input, textarea, select') || el.closest('.xterm, [contenteditable]'))) return false;
  if (document.querySelector('[aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"]')) return false;
  return true;
}

/** True when a plain "i" keypress should open the Inbox. */
export const isInboxKey = (e: KeyboardEvent) => isPlainKey(e, 'i');

/** A per-browser on/off switch for a shortcut (Settings, Appearance, Keyboard). On unless Ben turned it off. */
function keyPref(key: string) {
  const listeners = new Set<() => void>();
  const read = (): boolean => readPref<boolean>(key, true) !== false;
  const set = (on: boolean) => {
    writePref(key, on);
    for (const fn of listeners) fn();
  };
  const use = (): boolean =>
    useSyncExternalStore(
      (fn) => (listeners.add(fn), () => listeners.delete(fn)),
      read,
      () => true,
    );
  return { read, set, use };
}

const inboxPref = keyPref('keys.inbox');
export const readInboxKeyOn = inboxPref.read;
export const setInboxKeyOn = inboxPref.set;
export const useInboxKeyOn = inboxPref.use;

const donePref = keyPref('keys.done');
export const readDoneKeyOn = donePref.read;
export const setDoneKeyOn = donePref.set;
export const useDoneKeyOn = donePref.use;

/** Calls `run` on a plain press of `key` while `on()` holds. */
function useKey(key: string, on: () => boolean, run: (e: KeyboardEvent) => boolean | void) {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!on() || !isPlainKey(e, key)) return;
      if (latest.current(e) !== false) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, on]);
}

/**
 * Press "i" anywhere outside a text field to open the Inbox, unless Settings turned it off. Each desktop layout's
 * navigation and the phone shell call it: the classic Sidebar, the ChannelRail and MobileShell.
 */
export function useInboxKey(open: () => void) {
  useKey('i', readInboxKeyOn, () => open());
}

/**
 * Press "e" while the Inbox view is on screen to mark its selected thread done, unless Settings turned it off. The
 * selected thread is the card with keyboard focus, else the open one. `markDone` returns false when it had nothing to
 * mark, so the key passes through.
 */
export function useDoneKey(markDone: (focusedId: string | null) => boolean) {
  useKey('e', readDoneKeyOn, () => {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('[data-inbox-thread]') : null;
    return markDone(focused?.dataset.inboxThread ?? null);
  });
}
