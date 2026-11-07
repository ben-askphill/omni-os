import { sectionDef } from '@omni/shared/settings-catalog.ts';
import { useLayoutEffect } from 'react';

import type { RootScreenProps } from '../navigation/types';
import { SectionBody } from '../settings/sections';

/** One section of Settings, under the title the Web UI's nav gives it. */
export function SettingsSectionScreen({ route, navigation }: RootScreenProps<'SettingsSection'>) {
  const { section } = route.params;
  useLayoutEffect(() => {
    navigation.setOptions({ title: sectionDef(section).title });
  }, [navigation, section]);
  return <SectionBody section={section} />;
}
