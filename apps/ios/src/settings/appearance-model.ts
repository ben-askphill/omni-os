/** Settings, Appearance: this phone's theme. Kept on the phone only, as the Web UI keeps its theme per browser. */
export type ThemePref = 'system' | 'light' | 'dark';

export const THEME_OPTIONS: readonly { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'Match system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** A saved value as a theme. Anything else, nothing saved included, follows the system. */
export const parseThemePref = (saved: string | null | undefined): ThemePref => (saved === 'light' || saved === 'dark' ? saved : 'system');

/** What React Native's Appearance takes: `unspecified` hands the choice back to iOS. */
export const colorSchemeFor = (pref: ThemePref) => (pref === 'system' ? 'unspecified' : pref);
