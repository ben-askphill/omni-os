import { useSyncExternalStore } from 'react';
import { readPref, writePref } from './store.tsx';

/**
 * The desktop shell's layout, per browser: the channel rail with a list panel beside it ("D · Ink rail", the
 * default), or the classic single sidebar. The phone layout ignores it.
 */
export type LayoutPref = 'rail' | 'classic';

const KEY = 'layout';
const listeners = new Set<() => void>();

export const readLayout = (): LayoutPref => (readPref<LayoutPref>(KEY, 'rail') === 'classic' ? 'classic' : 'rail');

export function setLayout(next: LayoutPref) {
  writePref(KEY, next);
  for (const fn of listeners) fn();
}

export function useLayout(): LayoutPref {
  return useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    readLayout,
    () => 'rail',
  );
}
