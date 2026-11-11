import { readPref, writePref } from '../store.tsx';

/** The thread's right side: hidden, the compact quick card, or the full inspector. */
export type ThreadPanelSurface = 'collapsed' | 'card' | 'inspector';

export function readThreadPanelSurface(): ThreadPanelSurface {
  const v = readPref<unknown>('threadPanelSurface', null);
  if (v === 'collapsed' || v === 'card' || v === 'inspector') return v;
  return readPref('threadPanel', true) ? 'card' : 'collapsed';
}

export function writeThreadPanelSurface(surface: ThreadPanelSurface) {
  writePref('threadPanelSurface', surface);
  writePref('threadPanel', surface !== 'collapsed');
}
