import type { OmniApi } from '@omni/client-core';
import Constants from 'expo-constants';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/Text';

import { ListHeading } from '../components/ListHeading';
import { useRemote } from '../live/use-remote';
import type { RootScreenProps } from '../navigation/types';
import { describePairingError } from '../pairing/messages';
import { usePairing } from '../pairing/PairingProvider';
import { settingsGroups, settingsHits, targetOf, type SettingsTarget } from '../settings/sections-model';
import { automationsDetail, versionLabel } from '../settings/settings-model';
import { fontSize, minTarget, radius, space, useOmniTheme } from '../theme';
import { GroupedList, ListRow } from '../ui/GroupedList';
import { isIconName } from '../ui/Icon';

const loadAutomations = (api: OmniApi) => api.automations();
const GROUPS = settingsGroups();

/** What a section row says under its title where the phone has its own words. The rest show the catalog's blurb. */
const PHONE_DETAIL: Partial<Record<string, string>> = {
  notifications: 'Which alerts this phone gets',
  appearance: 'How Omni looks on this phone',
};

/**
 * Settings: Servers first, then a search over every setting and the same groups of sections as the Web UI and phone
 * web (@omni/shared/settings-catalog.ts), then Devices and Automations, and Sign out.
 */
export function SettingsScreen({ navigation }: RootScreenProps<'Settings'>) {
  const { colors } = useOmniTheme();
  const { activeServer, remove } = usePairing();
  const automations = useRemote(loadAutomations);
  const [q, setQ] = useState('');
  const hits = q.trim() ? settingsHits(q) : null;

  const go = (t: SettingsTarget) => (t.route === 'SettingsSection' ? navigation.navigate('SettingsSection', { section: t.section, focus: t.focus }) : navigation.navigate(t.route));

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
    <ScrollView style={{ backgroundColor: colors.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
        value={q}
        onChangeText={setQ}
        placeholder="Search settings"
        placeholderTextColor={colors.fg4}
        accessibilityLabel="Search settings"
        style={[styles.search, { color: colors.fg, backgroundColor: colors.surface2 }]}
      />

      {hits ? (
        <View style={styles.section}>
          <ListHeading inset count={hits.length}>
            Matching settings
          </ListHeading>
          {hits.length ? (
            <GroupedList>
              {hits.map((h, i) => (
                <ListRow key={h.id} first={i === 0} icon={isIconName(h.icon) ? h.icon : 'settings'} title={h.title} detail={h.section} chevron onPress={() => go(h.target)} />
              ))}
            </GroupedList>
          ) : (
            <Text style={[styles.none, { color: colors.fg3 }]}>No setting matches.</Text>
          )}
        </View>
      ) : (
        <>
          <View style={styles.section}>
            <ListHeading inset>Server</ListHeading>
            <GroupedList>
              <ListRow first icon="server" title="Servers" value={activeServer?.name} chevron onPress={() => navigation.navigate('Servers')} />
            </GroupedList>
          </View>

          {GROUPS.map((g) => (
            <View key={g.id} style={styles.section}>
              <ListHeading inset>{g.title}</ListHeading>
              <GroupedList>
                {g.rows.map((r, i) => (
                  <ListRow
                    key={r.id}
                    first={i === 0}
                    icon={isIconName(r.icon) ? r.icon : 'settings'}
                    title={r.title}
                    detail={PHONE_DETAIL[r.id] ?? r.blurb}
                    chevron
                    onPress={() => go(targetOf(r.id))}
                  />
                ))}
              </GroupedList>
            </View>
          ))}

          <View style={styles.section}>
            <ListHeading inset>Features</ListHeading>
            <GroupedList>
              <ListRow first icon="devices" title="Devices" detail="Where this server is signed in" chevron onPress={() => navigation.navigate('Devices')} />
              <ListRow
                icon="automation"
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
                <ListRow first icon="signOut" tone="destructive" title={`Sign out of ${activeServer.name}`} onPress={confirmSignOut} />
              </GroupedList>
            </View>
          ) : null}

          <Text style={[styles.version, { color: colors.fg4 }]}>{versionLabel(Constants.expoConfig?.version, Constants.expoConfig?.ios?.buildNumber)}</Text>
        </>
      )}
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
  search: {
    minHeight: minTarget,
    borderRadius: radius.pill,
    paddingHorizontal: space.s8,
    fontSize: fontSize.input,
  },
  none: {
    fontSize: fontSize.body,
    paddingHorizontal: space.s2,
  },
  version: {
    fontSize: fontSize.meta,
    textAlign: 'center',
    paddingTop: space.s6,
  },
});
