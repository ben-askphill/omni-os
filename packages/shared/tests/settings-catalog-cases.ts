import { LEGACY_SETTINGS_SECTIONS, searchSettings, SETTINGS_ENTRIES, SETTINGS_GROUPS, SETTINGS_SECTION_DEFS, type SettingsSurface } from '../settings-catalog.ts';

/** Searches recorded with their answers: ids, best first. */
export const SEARCHES: { query: string; surface: SettingsSurface }[] = [
  { query: 'theme', surface: 'web' },
  { query: 'dark', surface: 'desktop' },
  { query: 'limit', surface: 'web' },
  { query: 'model', surface: 'web' },
  { query: 'hotkey', surface: 'web' },
  { query: 'hotkey', surface: 'desktop' },
  { query: 'tailscale', surface: 'web' },
  { query: 'worktree clean', surface: 'web' },
  { query: 'port', surface: 'desktop' },
  { query: 'Notífy', surface: 'web' },
  { query: '', surface: 'web' },
  { query: 'zzz', surface: 'web' },
];

/** The whole catalog and what the searches find, as settings-catalog.json records it. */
export const catalogFixture = () => ({
  groups: SETTINGS_GROUPS,
  sections: SETTINGS_SECTION_DEFS,
  entries: SETTINGS_ENTRIES,
  legacy: LEGACY_SETTINGS_SECTIONS,
  searches: SEARCHES.map((s) => ({ ...s, expected: searchSettings(s.query, s.surface).map((e) => e.id) })),
});
