import { useSyncExternalStore } from 'react';
import { readPref, writePref } from './store.tsx';

/**
 * The desktop shell's layout, per browser: the channel rail with a list panel beside it ("D · Ink rail", a Beta
 * Ben turns on in Settings, Appearance), or the classic single sidebar (the default). The phone layout ignores it.
 */
export type LayoutPref = 'rail' | 'classic';

const KEY = 'layout';
const listeners = new Set<() => void>();

export const readLayout = (): LayoutPref => (readPref<LayoutPref>(KEY, 'classic') === 'rail' ? 'rail' : 'classic');

export function setLayout(next: LayoutPref) {
  writePref(KEY, next);
  for (const fn of listeners) fn();
}

export function useLayout(): LayoutPref {
  return useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    readLayout,
    () => 'classic',
  );
}
