import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixture } from '@omni/test-fixtures';
import { searchSettings, sectionShows, sectionsIn, SETTINGS_ENTRIES, SETTINGS_GROUPS, SETTINGS_SECTION_DEFS, settingsSectionNamed } from '../settings-catalog.ts';
import { SETTING_FIELDS } from '../settings.ts';
import { catalogFixture } from './settings-catalog-cases.ts';

describe('settings catalog', () => {
  it('matches settings-catalog.json (run scripts/settings-catalog-fixture.ts after a change)', () => {
    expect(JSON.parse(readFileSync(fixture('settings-catalog.json'), 'utf8'))).toEqual(JSON.parse(JSON.stringify(catalogFixture())));
  });

  it('lists every section in exactly one group, and every group has one', () => {
    const groups = new Set(SETTINGS_GROUPS.map((g) => g.id));
    for (const s of SETTINGS_SECTION_DEFS) expect(groups.has(s.group)).toBe(true);
    for (const g of SETTINGS_GROUPS) expect(SETTINGS_SECTION_DEFS.some((s) => s.group === g.id)).toBe(true);
    expect(new Set(SETTINGS_SECTION_DEFS.map((s) => s.id)).size).toBe(SETTINGS_SECTION_DEFS.length);
  });

  it('gives every entry a unique id in a real section, and every section an entry', () => {
    expect(new Set(SETTINGS_ENTRIES.map((e) => e.id)).size).toBe(SETTINGS_ENTRIES.length);
    for (const s of SETTINGS_SECTION_DEFS) expect([s.id, SETTINGS_ENTRIES.some((e) => e.section === s.id)]).toEqual([s.id, true]);
  });

  it('shows each config field in a section that exists', () => {
    for (const f of SETTING_FIELDS) if (f.page) expect(settingsSectionNamed(f.page)).toBe(f.page);
  });

  it('opens old names on the section that holds them now', () => {
    expect(settingsSectionNamed('storage')).toBe('worktrees');
    expect(settingsSectionNamed('profile')).toBe('general');
    expect(settingsSectionNamed('sync')).toBe('sync');
    expect(settingsSectionNamed('garage')).toBeNull();
  });

  it('ranks a title match over a keyword, folds accents and needs every word', () => {
    expect(searchSettings('limit', 'web')[0]?.id).toBe('limits');
    expect(searchSettings('NOTÍFY', 'web')[0]?.id).toBe('notify');
    expect(searchSettings('worktree zebra', 'web')).toEqual([]);
  });

  it('lists the desktop app\'s section only in the desktop app', () => {
    const ids = (desktopApp: boolean) => sectionsIn('app', { desktopApp }).map((s) => s.id);
    expect(ids(false)).toEqual(['about']);
    expect(ids(true)).toEqual(['desktop', 'about']);
    expect(sectionShows('desktop', false)).toBe(false);
    expect(sectionShows('desktop', true)).toBe(true);
    expect(sectionShows('general', false)).toBe(true);
    expect(settingsSectionNamed('desktop')).toBe('desktop');
  });

  it('finds the desktop app\'s settings only in the desktop app, which finds every web setting too', () => {
    expect(searchSettings('hotkey', 'desktop').map((e) => e.id)).toEqual(['desktop-quick-prompt']);
    expect(searchSettings('hotkey', 'web')).toEqual([]);
    expect(searchSettings('login', 'web').map((e) => e.id)).not.toContain('desktop-login');
    expect(searchSettings('login', 'desktop', { loginItem: true }).map((e) => e.id)).toContain('desktop-login');
    // Linux opens no app at login, and its Desktop app section draws no such card: no hit that lands on nothing.
    expect(searchSettings('login', 'desktop', { loginItem: false }).map((e) => e.id)).not.toContain('desktop-login');
    expect(searchSettings('autostart', 'desktop')).toEqual([]);
    expect(searchSettings('theme', 'desktop').map((e) => e.id)).toEqual(searchSettings('theme', 'web').map((e) => e.id));
  });

  it('finds Quick Prompt only in the desktop app', () => {
    expect(searchSettings('quick prompt', 'web')).toEqual([]);
    expect(searchSettings('quick prompt', 'desktop').map((e) => e.id)).toEqual(['desktop-quick-prompt']);
  });
});
