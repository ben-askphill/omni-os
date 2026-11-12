import type { SettingsSectionId } from '@omni/shared/settings-catalog.ts';

import { ModelsSection, ThreadsSection } from './AgentSections';
import { ChannelsSection, WorkspaceSection, WorktreesSection } from './CodeSections';
import { AccessSection, MachinesSection, SyncSection } from './ConnectionSections';
import { AboutSection, AppearanceSection, GeneralSection } from './OmniSections';

/**
 * Each catalog section's body on the phone. Notifications and Secrets open screens of their own (sections-model.ts); the
 * desktop app's section never lists here.
 */
const SECTIONS: Partial<Record<SettingsSectionId, () => React.JSX.Element>> = {
  general: GeneralSection,
  appearance: AppearanceSection,
  models: ModelsSection,
  threads: ThreadsSection,
  channels: ChannelsSection,
  workspace: WorkspaceSection,
  worktrees: WorktreesSection,
  machines: MachinesSection,
  sync: SyncSection,
  access: AccessSection,
  about: AboutSection,
};

export function SectionBody({ section }: { section: SettingsSectionId }) {
  const Body = SECTIONS[section] ?? AboutSection;
  return <Body />;
}
