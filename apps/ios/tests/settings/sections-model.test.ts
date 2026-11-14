import { describe, expect, it } from 'vitest';

import { colorSchemeFor, parseThemePref } from '../../src/settings/appearance-model';
import { harnessRows } from '../../src/settings/harness-model';
import { dayChoices } from '../../src/settings/retention-model';
import { settingsGroups, settingsHits, targetOf } from '../../src/settings/sections-model';
import { syncLine } from '../../src/settings/sync-model';
import { catalog } from '../thread/fixtures';

describe('Settings sections on the phone', () => {
  it('lists the catalog in its order, without the desktop app', () => {
    const ids = settingsGroups().flatMap((g) => g.rows.map((r) => r.id));
    expect(ids).toEqual(['general', 'appearance', 'notifications', 'models', 'accounts', 'threads', 'channels', 'workspace', 'worktrees', 'machines', 'sync', 'access', 'secrets', 'about']);
    expect(settingsGroups()[0].title).toBe('Omni');
  });

  it('opens notifications and secrets on their own screens', () => {
    expect(targetOf('notifications')).toEqual({ route: 'NotificationSettings' });
    expect(targetOf('secrets')).toEqual({ route: 'Secrets' });
    expect(targetOf('threads', 'run-on')).toEqual({ route: 'SettingsSection', section: 'threads', focus: 'run-on' });
  });

  it('finds a setting by its words, and never a desktop-app one', () => {
    expect(settingsHits('emoji')[0]).toMatchObject({ id: 'channel-basics', section: 'Channels' });
    expect(settingsHits('quick prompt')).toEqual([]);
  });
});

describe('small models', () => {
  it('follows the system unless light or dark was saved', () => {
    expect(parseThemePref(null)).toBe('system');
    expect(parseThemePref('dark')).toBe('dark');
    expect(colorSchemeFor('system')).toBe('unspecified');
  });

  it('describes each harness and how to fix one', () => {
    const rows = harnessRows(catalog());
    expect(rows[0]).toMatchObject({ name: 'Claude Code', ready: true, detail: 'Claude plan · 2 models · default Sonnet 5.5 · 0 of 4 running', fix: null });
    expect(rows.find((r) => r.id === 'hermes')).toMatchObject({ ready: false, fix: 'hermes login' });
  });

  it('offers the saved idle days even when it is not a usual choice', () => {
    expect(dayChoices({ enabled: true, idleDays: 14 })).toEqual([3, 7, 14, 30, 60, 90]);
    expect(dayChoices({ enabled: true, idleDays: 45 })).toEqual([3, 7, 14, 30, 45, 60, 90]);
  });

  it('reads sync as one line', () => {
    expect(syncLine(null, 0).text).toBe('Reading sync');
    const base = { configured: true, enabled: true, signedOut: false, lastError: null, legacyRelay: false, lastSyncAt: null } as never;
    expect(syncLine(base, 0)).toEqual({ glyph: 'done', text: 'Not synced yet' });
    expect(syncLine({ ...(base as object), enabled: false } as never, 0).text).toBe('Paused');
  });
});
