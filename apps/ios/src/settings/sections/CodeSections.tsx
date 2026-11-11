import type { OmniApi, WorktreesView } from '@omni/client-core';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert } from 'react-native';

import { ChannelAvatar } from '../../components/ChannelAvatar';
import { useChannels, useLiveHub } from '../../live/react';
import { useRemote } from '../../live/use-remote';
import type { RootStackParamList } from '../../navigation/types';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { ListRow } from '../../ui/GroupedList';
import { channelTitle, channelWhere } from '../channel-settings-model';
import { ConfigForm } from '../ConfigForm';
import { ChoiceRow, Footnote, Group, ServerOptionsGroup, SettingsPage, SwitchRow } from '../parts';
import { dayChoices, daysLabel } from '../retention-model';
import { Loading, useSetup } from './OmniSections';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// `archived: true` lists every channel, the archived ones included.
const loadArchived = async (api: OmniApi) => (await api.channels({ archived: true })).filter((c) => c.archived);
const loadWorktrees = (api: OmniApi) => api.worktrees();

/** Channels: each one opens its settings. New channel, and the archived ones with Unarchive. */
export function ChannelsSection() {
  const navigation = useNavigation<Nav>();
  const hub = useLiveHub();
  const { channels } = useChannels();
  const archived = useRemote(loadArchived);
  const [unarchiving, setUnarchiving] = useState<string | null>(null);
  const listed = (channels ?? []).filter((c) => !c.archived);

  async function unarchive(id: string) {
    setUnarchiving(id);
    try {
      await hub.request((api) => api.updateChannel(id, { archived: 0 }));
      await Promise.all([archived.reload(), hub.refreshChannels()]);
    } catch (e) {
      Alert.alert("Couldn't unarchive the channel", e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setUnarchiving(null);
    }
  }

  return (
    <SettingsPage onRefresh={() => Promise.all([hub.refreshChannels(), archived.reload()])}>
      <Group title="Your channels" footer="One per client or project. Its name, icon, default model, notes, repo, store, actions and secrets.">
        {listed.map((c, i) => (
          <ListRow
            key={c.id}
            first={i === 0}
            leading={<ChannelAvatar name={c.name} icon={c.icon} avatarBg={c.avatar_bg} conductor={c.id === 'conductor'} size={28} />}
            title={channelTitle(c)}
            detail={channelWhere(c)}
            chevron
            onPress={() => navigation.navigate('ChannelSettings', { id: c.id })}
          />
        ))}
        <ListRow first={listed.length === 0} icon="plus" title="New channel" onPress={() => navigation.navigate('ChannelSettings', {})} />
      </Group>
      {archived.data && archived.data.length > 0 ? (
        <Group title="Archived">
          {archived.data.map((c, i) => (
            <ListRow
              key={c.id}
              first={i === 0}
              title={channelTitle(c)}
              trailing={<Button label="Unarchive" variant="secondary" busy={unarchiving === c.id} disabled={unarchiving !== null} onPress={() => void unarchive(c.id)} />}
            />
          ))}
        </Group>
      ) : null}
      {channels === null ? <Loading error={null} retry={hub.refreshChannels} /> : null}
    </SettingsPage>
  );
}

export function WorkspaceSection() {
  const setup = useSetup();
  return (
    <SettingsPage onRefresh={setup.reload}>
      {setup.data ? (
        <ConfigForm page="workspace" state={setup.data} onSaved={setup.setData} footer="Folders are paths on the server's machine, so they change on that computer. The GitHub owner can change here." />
      ) : (
        <Loading error={setup.error} retry={setup.reload} />
      )}
      <Footnote>A channel with a repo runs each thread in a worktree of it; without one, in its base directory, else the workspace folder.</Footnote>
    </SettingsPage>
  );
}

/** Worktrees: this machine's retention, then the .env options. The disk scan and a hand-picked cleanup stay on the computer. */
export function WorktreesSection() {
  const hub = useLiveHub();
  const remote = useRemote(loadWorktrees);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const policy = remote.data?.cleanup.policy;

  async function save(patch: { enabled?: boolean; idleDays?: number }) {
    setBusy(true);
    setError(null);
    try {
      remote.setData((await hub.request((api) => api.setRetention(patch))) as WorktreesView);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPage onRefresh={remote.reload}>
      {policy ? (
        <>
          <Group title="Automatic cleanup" footer="Only the server's machine: the setting is not synced. It covers worktrees of archived, merged or deleted threads with nothing unsaved.">
            <SwitchRow first title="Remove idle worktrees on a schedule" value={policy.enabled} disabled={busy} onValueChange={(on) => void save({ enabled: on })} />
          </Group>
          {policy.enabled ? (
            <Group title="Idle for at least" footer="Without a turn or a message.">
              {dayChoices(policy).map((d, i) => (
                <ChoiceRow key={d} first={i === 0} title={daysLabel(d)} selected={policy.idleDays === d} disabled={busy} onPress={() => void save({ idleDays: d })} />
              ))}
            </Group>
          ) : null}
          {error ? <Callout message={error} /> : null}
        </>
      ) : (
        <Loading error={remote.error} retry={remote.reload} />
      )}
      <Footnote>Scanning the disk and picking worktrees to remove by hand happen on the computer.</Footnote>
      <ServerOptionsGroup section="worktrees" />
    </SettingsPage>
  );
}
