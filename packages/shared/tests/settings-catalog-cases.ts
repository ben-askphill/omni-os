import { LEGACY_SETTINGS_SECTIONS, searchSettings, SETTINGS_ENTRIES, SETTINGS_GROUPS, SETTINGS_SECTION_DEFS, type SettingsSectionDef, type SettingsSurface } from '../settings-catalog.ts';

/** Searches both ports must answer the same way: ids, best first. */
export const SEARCHES: { query: string; surface: SettingsSurface }[] = [
  { query: 'theme', surface: 'web' },
  { query: 'dark', surface: 'mac' },
  { query: 'limit', surface: 'web' },
  { query: 'model', surface: 'web' },
  { query: 'hotkey', surface: 'web' },
  { query: 'hotkey', surface: 'mac' },
  { query: 'tailscale', surface: 'web' },
  { query: 'worktree clean', surface: 'web' },
  { query: 'port', surface: 'mac' },
  { query: 'Notífy', surface: 'web' },
  { query: '', surface: 'web' },
  { query: 'zzz', surface: 'web' },
];

const desktopOnly = new Set<string>(SETTINGS_SECTION_DEFS.filter((s: SettingsSectionDef) => s.desktopApp).map((s) => s.id));

/** What the Mac app draws: every section but the desktop app's own (apps/desktop), and their entries. */
export const catalogFixture = () => ({
  groups: SETTINGS_GROUPS,
  sections: SETTINGS_SECTION_DEFS.filter((s) => !desktopOnly.has(s.id)),
  entries: SETTINGS_ENTRIES.filter((e) => !desktopOnly.has(e.section)),
  legacy: LEGACY_SETTINGS_SECTIONS,
  searches: SEARCHES.map((s) => ({ ...s, expected: searchSettings(s.query, s.surface).map((e) => e.id) })),
});
