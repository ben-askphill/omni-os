import type { OmniApi } from '@omni/client-core';
import { relTime } from '@omni/shared/format.ts';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { ActivityIndicator, View } from 'react-native';

import { ListHeading } from '../../components/ListHeading';
import { useRemote } from '../../live/use-remote';
import { useOmniTheme } from '../../theme';
import { ListRow } from '../../ui/GroupedList';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { setThemePref, useThemePref } from '../appearance';
import { THEME_OPTIONS } from '../appearance-model';
import { ConfigForm } from '../ConfigForm';
import { Footnote, Group, SettingsPage } from '../parts';
import { versionLabel } from '../settings-model';

const loadSetup = (api: OmniApi) => api.setup();
const loadStatus = (api: OmniApi) => api.status();

/** The server's config, for the sections that show its fields. */
export const useSetup = () => useRemote(loadSetup);

export function Loading({ error, retry }: { error: string | null; retry: () => Promise<void> }) {
  const { colors } = useOmniTheme();
  if (error)
    return (
      <Group footer={error}>
        <ListRow first title="Try again" icon="refresh" onPress={() => void retry()} />
      </Group>
    );
  return <ActivityIndicator accessibilityLabel="Loading" color={colors.fg3} />;
}

export function GeneralSection() {
  const setup = useSetup();
  return (
    <SettingsPage onRefresh={setup.reload}>
      {setup.data ? <ConfigForm page="general" state={setup.data} onSaved={setup.setData} /> : <Loading error={setup.error} retry={setup.reload} />}
      <Footnote>Run setup again on the computer: it checks the harnesses installed there.</Footnote>
    </SettingsPage>
  );
}

export function AppearanceSection() {
  const theme = useThemePref();
  return (
    <SettingsPage>
      <View>
        <ListHeading inset>Theme</ListHeading>
        <SegmentedControl options={THEME_OPTIONS} value={theme} onChange={setThemePref} />
        <Footnote>This phone only. Match system follows Light or Dark in iOS Settings.</Footnote>
      </View>
      <Footnote>Text size follows Text Size in iOS Settings, under Display & Brightness.</Footnote>
    </SettingsPage>
  );
}

export function AboutSection() {
  const status = useRemote(loadStatus);
  const server = status.data?.server;
  return (
    <SettingsPage onRefresh={status.reload}>
      <Group title="Server">
        <ListRow first title="Version" value={server?.version ?? (status.error ? 'Unknown' : '…')} />
        <ListRow title="Commit" value={server?.gitHead?.slice(0, 12) ?? 'Unknown'} />
        {server?.startedAt ? <ListRow title="Started" value={relTime(server.startedAt)} /> : null}
        {status.data?.device ? <ListRow title="Machine" value={status.data.device.name} /> : null}
      </Group>
      <Group title="This app" footer="Where the server keeps its files is a folder on its machine. The Web UI's About shows it.">
        <ListRow first title="Version" value={versionLabel(Constants.expoConfig?.version, Constants.nativeBuildVersion ?? Constants.expoConfig?.ios?.buildNumber)} />
        <ListRow title="Channel" value={Updates.channel || 'Development'} />
        <ListRow title="Runtime" detail={Updates.runtimeVersion ?? 'Development'} />
        <ListRow title="Update" detail={Updates.isEmbeddedLaunch ? 'Bundled with this build' : Updates.updateId ?? 'Development'} />
        {Updates.createdAt ? <ListRow title="Published" value={Updates.createdAt.toISOString()} /> : null}
      </Group>
    </SettingsPage>
  );
}
