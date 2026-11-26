import { useSyncExternalStore } from 'react';
import { readPref, writePref } from './store.tsx';

/**
 * The desktop shell's layout, per browser: the channel rail with a list panel beside it ("D · Ink rail", the
 * default), or the classic single sidebar, which Settings, Appearance turns on. The phone layout ignores it.
 */
export type LayoutPref = 'rail' | 'classic';

/** How the rail paints channel discs at rest: greyscale until hover, focus or selection (the default), or full colour. */
export type RailColorPref = 'grey' | 'full';

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));

function write(key: string, value: unknown) {
  writePref(key, value);
  for (const fn of listeners) fn();
}

export const readLayout = (): LayoutPref => (readPref<LayoutPref>('layout', 'rail') === 'classic' ? 'classic' : 'rail');
export const readRailColor = (): RailColorPref => (readPref<RailColorPref>('railColor', 'grey') === 'full' ? 'full' : 'grey');

/**
 * The rail's list panel, collapsed to a 48px strip of marks and avatars (the Collapsed list), or at its 264px. One flag
 * for every list the panel shows, per browser and desktop app like the layout: it does not sync, since how wide a
 * window is differs per machine.
 */
export const readListCollapsed = (): boolean => readPref<boolean>('rail.listCollapsed', false) === true;

export const setLayout = (next: LayoutPref) => write('layout', next);
export const setListCollapsed = (next: boolean) => write('rail.listCollapsed', next);
export const toggleListCollapsed = () => setListCollapsed(!readListCollapsed());
export const setRailColor = (next: RailColorPref) => write('railColor', next);

export const useListCollapsed = (): boolean => useSyncExternalStore(subscribe, readListCollapsed, readListCollapsed);
export const useLayout = (): LayoutPref => useSyncExternalStore(subscribe, readLayout, () => 'rail');
export const useRailColor = (): RailColorPref => useSyncExternalStore(subscribe, readRailColor, readRailColor);
