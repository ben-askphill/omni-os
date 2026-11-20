import type { OmniApi } from '@omni/client-core';
import { relTime } from '@omni/shared/format.ts';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ListHeading } from '../../components/ListHeading';
import { useLiveHub, useStore } from '../../live/react';
import { useRemote } from '../../live/use-remote';
import { useOmniTheme } from '../../theme';
import { ListRow } from '../../ui/GroupedList';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { setThemePref, useThemePref } from '../appearance';
import { THEME_OPTIONS } from '../appearance-model';
import { ConfigForm } from '../ConfigForm';
import { Footnote, Group, SettingsPage, SwitchRow } from '../parts';
import { versionLabel } from '../settings-model';

const loadSetup = (api: OmniApi) => api.setup();
const loadStatus = (api: OmniApi) => api.status();
const loadAnalytics = (api: OmniApi) => api.analytics();

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
      <TechnicalGroup />
      <Footnote>Text size follows Text Size in iOS Settings, under Display & Brightness.</Footnote>
    </SettingsPage>
  );
}

/** Show technical details: kept by the server, so it changes every client (packages/shared/display.ts). */
function TechnicalGroup() {
  const hub = useLiveHub();
  const display = useStore(hub.display);
  const [error, setError] = useState<string | null>(null);
  // An older server has no switch: its threads read as they always did.
  if (!display) return null;
  return (
    <Group
      title="Detail"
      footer={
        error ??
        'Status names like Steering and Checks failing, the AI app and effort by their own names, and pull requests, branches and token counts in every channel. Off, a channel with a repo still shows its code detail. Every device.'
      }
    >
      <SwitchRow first title="Show technical details" value={display.technical} onValueChange={(on) => void hub.setDisplay({ technical: on }).then(setError)} />
    </Group>
  );
}

/** Usage analytics: the server sends it, to its owner's PostHog, and keeps the switch for every client (apps/server/analytics.ts). */
function AnalyticsGroup() {
  const hub = useLiveHub();
  const state = useRemote(loadAnalytics);
  const [error, setError] = useState<string | null>(null);
  // An older server has no switch.
  if (!state.data) return null;
  const footer = state.data.configured
    ? 'The server sends which features get used, and errors, to PostHog. Never messages, prompts, files, names or secrets. This app sends nothing itself. Every device.'
    : 'Nothing is sent yet: the server has no PostHog project key. Add the global secret POSTHOG_KEY on the computer.';
  return (
    <Group title="Usage analytics" footer={error ?? footer}>
      <SwitchRow
        first
        title="Send usage analytics"
        value={state.data.enabled}
        onValueChange={(on) =>
          void hub
            .request((api) => api.setAnalytics(on))
            .then((next) => (state.setData(next), setError(null)))
            .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not save. Try again.'))
        }
      />
    </Group>
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
      <AnalyticsGroup />
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
