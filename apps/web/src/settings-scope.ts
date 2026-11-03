import { useSyncExternalStore } from 'react';
import { readPref, writePref } from './store.tsx';

// Settings' scope: '' for Every channel (this machine's values), or a channel id. It stays picked from section to
// section and across reloads (localStorage `omni.settings.scope`), like T3's project selector. A channel that is gone or archived reads as Every channel; the picker
// checks that, since this store does not know the channels.

const KEY = 'settings.scope';
let scope = readPref<string>(KEY, '');
const listeners = new Set<() => void>();

export function setSettingsScope(next: string) {
  if (next === scope) return;
  scope = next;
  writePref(KEY, next);
  for (const l of listeners) l();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const useSettingsScope = () => useSyncExternalStore(subscribe, () => scope);
