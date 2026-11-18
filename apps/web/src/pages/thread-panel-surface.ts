import { readPref, writePref } from '../store.tsx';

/** The thread's right side: hidden, the compact quick card, or the full inspector. */
export type ThreadPanelSurface = 'collapsed' | 'card' | 'inspector';

/**
 * How a thread opens its right side: the quick card, or nothing when Ben hid it. Never the inspector, even when Ben
 * left the last thread on it: the full panel opens only when he clicks into it.
 */
export function readThreadPanelSurface(): ThreadPanelSurface {
  const v = readPref<unknown>('threadPanelSurface', null);
  if (v === 'collapsed') return 'collapsed';
  if (v === 'card' || v === 'inspector') return 'card';
  return readPref('threadPanel', true) ? 'card' : 'collapsed';
}

export function writeThreadPanelSurface(surface: ThreadPanelSurface) {
  writePref('threadPanelSurface', surface);
  writePref('threadPanel', surface !== 'collapsed');
}
