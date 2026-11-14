import { ACTION_PORT_HINT, ACTION_SETUP_HINT, ACTION_TEARDOWN_HINT, actionInput, draftOf, type ActionDraft, type PortMode, type SetupMode } from '@omni/shared/channel-actions.ts';
import { useCallback, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';

import { HeaderButton } from '../components/HeaderButton';
import { ListHeading } from '../components/ListHeading';
import { useLiveHub } from '../live/react';
import type { RootScreenProps } from '../navigation/types';
import { Footnote, Group, InputRow, SettingsPage } from '../settings/parts';
import { space, useOmniTheme } from '../theme';
import { Callout } from '../ui/Callout';
import { ListRow } from '../ui/GroupedList';
import { SegmentedControl } from '../ui/SegmentedControl';

const PORTS: readonly { value: PortMode; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'free', label: 'Free per run' },
  { value: 'fixed', label: 'Fixed' },
];

const SETUPS: readonly { value: SetupMode | 'off'; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'blocking', label: 'Before agent' },
  { value: 'background', label: 'Alongside' },
];

const TEARDOWNS: readonly { value: 'off' | 'on'; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'Before removal' },
];

/** One channel action, new or edited, with the fields and checks the Web UI's action editor has. Saved on its own. */
export function ChannelActionScreen({ route, navigation }: RootScreenProps<'ChannelAction'>) {
  const { channel, action } = route.params;
  const hub = useLiveHub();
  const { colors } = useOmniTheme();
  const [d, setD] = useState<ActionDraft>(() => draftOf(action));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ActionDraft>(k: K, v: ActionDraft[K]) => setD((prev) => ({ ...prev, [k]: v }));

  const save = useCallback(async () => {
    const parsed = actionInput(d);
    if ('error' in parsed) return setError(parsed.error);
    setBusy(true);
    setError(null);
    try {
      await hub.request((api) => (action ? api.updateChannelAction(channel, action.id, parsed.input) : api.addChannelAction(channel, parsed.input)));
      navigation.goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }, [action, channel, d, hub, navigation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: action ? action.name : 'New action',
      headerLeft: () => <HeaderButton label="Cancel" onPress={() => navigation.goBack()} />,
      headerRight: () => (busy ? <ActivityIndicator color={colors.fg3} /> : <HeaderButton label={action ? 'Save' : 'Add'} disabled={!d.name.trim() || !d.command.trim()} onPress={() => void save()} />),
    });
  }, [navigation, action, busy, d.name, d.command, save, colors.fg3]);

  function confirmDelete() {
    if (!action) return;
    Alert.alert(`Delete ${action.name}?`, 'Threads in this channel can no longer run it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void hub
            .request((api) => api.deleteChannelAction(channel, action.id))
            .then(() => navigation.goBack())
            .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong. Try again.')),
      },
    ]);
  }

  return (
    <SettingsPage>
      {error ? <Callout message={error} /> : null}
      <Group>
        <InputRow first label="Name" value={d.name} placeholder="Theme preview" autoCapitalize="sentences" onChangeText={(t) => set('name', t)} />
        <InputRow
          label="Command"
          value={d.command}
          code
          multiline
          placeholder="shopify theme dev --port $OMNI_PORT"
          hint="Runs in the thread's checkout with the login shell on the server's machine. Use $OMNI_PORT for the preview port."
          onChangeText={(t) => set('command', t)}
        />
        <InputRow
          label="Secrets"
          value={d.secrets}
          code
          placeholder="SHOPIFY_CLI_THEME_TOKEN"
          hint="Names only, separated by commas or spaces. The command reads each one as $NAME. Billing and sync keys are refused."
          onChangeText={(t) => set('secrets', t.toUpperCase())}
        />
      </Group>
      <View style={{ gap: space.s2 }}>
        <ListHeading inset>Port</ListHeading>
        <SegmentedControl options={PORTS} value={d.portMode} onChange={(m) => set('portMode', m)} />
        <Footnote>{ACTION_PORT_HINT[d.portMode]}</Footnote>
      </View>
      {d.portMode === 'fixed' ? (
        <Group>
          <InputRow first label="Fixed port" value={d.port} code keyboardType="number-pad" placeholder="9292" onChangeText={(t) => set('port', t.replace(/\D/g, ''))} />
        </Group>
      ) : null}
      <View style={{ gap: space.s2 }}>
        <ListHeading inset>Run in new worktrees</ListHeading>
        <SegmentedControl options={SETUPS} value={d.setup ?? 'off'} onChange={(m) => set('setup', m === 'off' ? null : m)} />
        <Footnote>{ACTION_SETUP_HINT[d.setup ?? 'off']}</Footnote>
      </View>
      <View style={{ gap: space.s2 }}>
        <ListHeading inset>Run before a worktree is removed</ListHeading>
        <SegmentedControl options={TEARDOWNS} value={d.teardown ? 'on' : 'off'} onChange={(m) => set('teardown', m === 'on')} />
        <Footnote>{ACTION_TEARDOWN_HINT[d.teardown ? 'on' : 'off']}</Footnote>
      </View>
      {action ? (
        <Group>
          <ListRow first icon="trash" tone="destructive" title="Delete action" onPress={confirmDelete} />
        </Group>
      ) : null}
    </SettingsPage>
  );
}
