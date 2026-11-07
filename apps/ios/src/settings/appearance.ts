import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

import { createStore } from '../live/store';
import { colorSchemeFor, parseThemePref, type ThemePref } from './appearance-model';

const KEY = 'omni.appearance.theme';
const theme = createStore<ThemePref>('system');

function apply(pref: ThemePref) {
  theme.set(pref);
  Appearance.setColorScheme(colorSchemeFor(pref));
}

/** Reads the saved theme once at launch. Until it answers, the app follows the system. */
export function restoreThemePref() {
  SecureStore.getItemAsync(KEY)
    .then((saved) => apply(parseThemePref(saved)))
    .catch(() => {});
}

/** Applies at once, then saves. A failed save keeps the theme for this launch. */
export function setThemePref(pref: ThemePref) {
  apply(pref);
  void SecureStore.setItemAsync(KEY, pref).catch(() => {});
}

export const useThemePref = () => useSyncExternalStore(theme.subscribe, theme.get);
