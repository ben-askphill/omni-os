import { Tabs } from './ui.tsx';
import { href, SETTINGS_LABEL, SETTINGS_SECTIONS, type SettingsSection } from '../router.ts';

// The Settings section nav: General, Workspace, Machines and Secrets, the same four in the same order as the Mac
// app's tabs and the phone's Settings list. Links, so a section has a hash of its own. Hidden on a phone, where the
// Settings screen lists the sections itself and each one opens under a back bar.

export function SettingsNav({ section, className = '' }: { section: SettingsSection; className?: string }) {
  return (
    <Tabs
      className={`hidden md:block ${className}`}
      value={section}
      tabs={SETTINGS_SECTIONS.map((id) => ({ id, label: SETTINGS_LABEL[id], href: href.settingsSection(id) }))}
    />
  );
}
