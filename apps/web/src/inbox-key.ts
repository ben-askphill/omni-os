import { useEffect, useRef, useSyncExternalStore } from 'react';
import { readPref, writePref } from './store.tsx';

/** True when a plain "i" keypress should open the Inbox: no modifiers, no field or terminal focused, no layer open. */
export function isInboxKey(e: KeyboardEvent): boolean {
  if (e.key !== 'i' || e.repeat || e.isComposing || e.defaultPrevented) return false;
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
  const el = e.target instanceof HTMLElement ? e.target : null;
  if (el && (el.isContentEditable || el.matches('input, textarea, select') || el.closest('.xterm, [contenteditable]'))) return false;
  if (document.querySelector('[aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"]')) return false;
  return true;
}

// Whether "i" opens the Inbox, per browser (Settings, Appearance). On unless Ben turned it off.
const KEY = 'keys.inbox';
const listeners = new Set<() => void>();

export const readInboxKeyOn = (): boolean => readPref<boolean>(KEY, true) !== false;

export function setInboxKeyOn(on: boolean) {
  writePref(KEY, on);
  for (const fn of listeners) fn();
}

export function useInboxKeyOn(): boolean {
  return useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    readInboxKeyOn,
    () => true,
  );
}

/**
 * Press "i" anywhere outside a text field to open the Inbox, unless Settings turned it off. Each desktop layout's
 * navigation and the phone shell call it: the classic Sidebar, the ChannelRail and MobileShell.
 */
export function useInboxKey(open: () => void) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!readInboxKeyOn() || !isInboxKey(e)) return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
