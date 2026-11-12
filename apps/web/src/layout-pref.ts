import { useSyncExternalStore } from 'react';
import { readPref, writePref } from './store.tsx';

/**
 * The desktop shell's layout, per browser: the channel rail with a list panel beside it ("D · Ink rail", a Beta
 * Ben turns on in Settings, Appearance), or the classic single sidebar (the default). The phone layout ignores it.
 */
export type LayoutPref = 'rail' | 'classic';

/** How the rail paints channel discs at rest: greyscale until hover, focus or selection (the default), or full colour. */
export type RailColorPref = 'grey' | 'full';

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));

function write(key: string, value: string) {
  writePref(key, value);
  for (const fn of listeners) fn();
}

export const readLayout = (): LayoutPref => (readPref<LayoutPref>('layout', 'classic') === 'rail' ? 'rail' : 'classic');
export const readRailColor = (): RailColorPref => (readPref<RailColorPref>('railColor', 'grey') === 'full' ? 'full' : 'grey');

export const setLayout = (next: LayoutPref) => write('layout', next);
export const setRailColor = (next: RailColorPref) => write('railColor', next);

export const useLayout = (): LayoutPref => useSyncExternalStore(subscribe, readLayout, () => 'classic');
export const useRailColor = (): RailColorPref => useSyncExternalStore(subscribe, readRailColor, readRailColor);
