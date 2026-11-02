import type { OmniApi } from '@omni/client-core';
import Constants from 'expo-constants';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ListHeading } from '../components/ListHeading';
import { useRemote } from '../live/use-remote';
import type { RootScreenProps } from '../navigation/types';
import { describePairingError } from '../pairing/messages';
import { usePairing } from '../pairing/PairingProvider';
import { automationsDetail, versionLabel } from '../settings/settings-model';
import { fontSize, space, useOmniTheme } from '../theme';
import { GroupedList, ListRow } from '../ui/GroupedList';

const loadAutomations = (api: OmniApi) => api.automations();

export function SettingsScreen({ navigation }: RootScreenProps<'Settings'>) {
  const { colors } = useOmniTheme();
  const { activeServer, remove } = usePairing();
  const automations = useRemote(loadAutomations);

  function confirmSignOut() {
    if (!activeServer) return;
    Alert.alert(`Sign out of ${activeServer.name}?`, 'This phone stops being paired with that server. Pair it again to come back.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => void remove(activeServer.id).catch((e: unknown) => Alert.alert('Something went wrong', describePairingError(e))),
      },
    ]);
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <ListHeading>Server</ListHeading>
        <GroupedList>
          <ListRow first title="Servers" value={activeServer?.name} chevron onPress={() => navigation.navigate('Servers')} />
        </GroupedList>
      </View>

      <View style={styles.section}>
        <ListHeading>Preferences</ListHeading>
        <GroupedList>
          <ListRow first title="Notifications" detail="Which alerts this phone gets" chevron onPress={() => navigation.navigate('NotificationSettings')} />
        </GroupedList>
      </View>

      <View style={styles.section}>
        <ListHeading>Account</ListHeading>
        <GroupedList>
          <ListRow first title="Devices" detail="Where this server is signed in" chevron onPress={() => navigation.navigate('Devices')} />
          <ListRow
            title="Automations"
            detail={automationsDetail(automations.data?.length ?? null, automations.error, activeServer?.name ?? null)}
            chevron
            onPress={() => navigation.navigate('Automations')}
          />
        </GroupedList>
      </View>

      {activeServer ? (
        <View style={styles.section}>
          <GroupedList>
            <ListRow first tone="destructive" title={`Sign out of ${activeServer.name}`} onPress={confirmSignOut} />
          </GroupedList>
        </View>
      ) : null}

      <Text style={[styles.version, { color: colors.fg4 }]}>
        {versionLabel(Constants.expoConfig?.version, Constants.expoConfig?.ios?.buildNumber)}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.s8,
    paddingTop: space.s4,
    paddingBottom: space.s11,
    gap: space.s6,
  },
  section: {
    gap: space.s2,
  },
  version: {
    fontSize: fontSize.meta,
    textAlign: 'center',
    paddingTop: space.s6,
  },
});
