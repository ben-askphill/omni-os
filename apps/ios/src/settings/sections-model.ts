import { searchSettings, sectionDef, sectionsIn, SETTINGS_GROUPS, type SettingsSectionId } from '@omni/shared/settings-catalog.ts';

/**
 * Settings on the phone: the same groups and sections, in the same order, as the Web UI's nav and phone web's Settings
 * screen (@omni/shared/settings-catalog.ts). The desktop app's own section never lists here.
 */
export interface SectionRow {
  id: SettingsSectionId;
  title: string;
  icon: string;
  blurb: string;
}

export interface SectionGroup {
  id: string;
  title: string;
  rows: SectionRow[];
}

export function settingsGroups(): SectionGroup[] {
  return SETTINGS_GROUPS.map((g) => ({
    id: g.id,
    title: g.title || (g.id === 'omni' ? 'Omni' : 'App'),
    rows: sectionsIn(g.id, { desktopApp: false }).map((d) => ({ id: d.id as SettingsSectionId, title: d.title, icon: d.icon, blurb: d.blurb })),
  })).filter((g) => g.rows.length > 0);
}

/** Where a section opens. Notifications and Secrets have screens of their own; the rest share the section screen. */
export type SettingsTarget =
  | { route: 'NotificationSettings' }
  | { route: 'Secrets' }
  | { route: 'SettingsSection'; section: SettingsSectionId; focus?: string };

export function targetOf(section: SettingsSectionId, focus?: string): SettingsTarget {
  if (section === 'notifications') return { route: 'NotificationSettings' };
  if (section === 'secrets') return { route: 'Secrets' };
  return focus ? { route: 'SettingsSection', section, focus } : { route: 'SettingsSection', section };
}

export interface SettingsHit {
  id: string;
  title: string;
  /** The section's title, under the hit. */
  section: string;
  icon: string;
  target: SettingsTarget;
}

/** What a search finds, best first, as phone web's Settings search ranks it. */
export function settingsHits(query: string): SettingsHit[] {
  return searchSettings(query, 'web').map((e) => ({
    id: e.id,
    title: e.title,
    section: sectionDef(e.section).title,
    icon: sectionDef(e.section).icon,
    target: targetOf(e.section, e.id),
  }));
}
