import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';

import type { RootScreenProps } from '../navigation/types';
import { describePairingError } from '../pairing/messages';
import { usePairing } from '../pairing/PairingProvider';
import type { PairedServer } from '../pairing/servers';
import { STATUS_LABEL } from '../pairing/status';
import { fontSize, lineHeight, minTarget, radius, space, useOmniTheme, weight } from '../theme';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';

export function ServersScreen({ navigation }: RootScreenProps<'Servers'>) {
  const { colors } = useOmniTheme();
  const { servers, activeServer, statusById, select, remove } = usePairing();

  function report(error: unknown) {
    Alert.alert('Something went wrong', describePairingError(error));
  }

  function confirmRemove(server: PairedServer) {
    Alert.alert(`Remove ${server.name}?`, 'This signs this phone out of that server.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void remove(server.id).catch(report) },
    ]);
  }

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      {servers.map((server) => {
        const active = server.id === activeServer?.id;
        const status = statusById[server.id];
        const statusLabel = status ? STATUS_LABEL[status] : null;
        return (
          <View
            key={server.id}
            style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.line }]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={[server.name, server.origin, statusLabel, active ? 'Active' : null]
                .filter(Boolean)
                .join(', ')}
              accessibilityHint={active ? undefined : 'Makes this the active server'}
              onPress={() => void select(server.id).catch(report)}
              style={styles.rowMain}
            >
              <View style={styles.nameRow}>
                <Text style={[styles.name, { color: colors.fg }]}>{server.name}</Text>
                {active && <Chip label="Active" tone="outline" />}
              </View>
              <Text style={[styles.meta, { color: colors.fg3 }]}>{server.origin}</Text>
              {statusLabel !== null && (
                <Text style={[styles.meta, { color: colors.fg3 }]}>{statusLabel}</Text>
              )}
            </Pressable>
            <View style={styles.remove}>
              <Button label="Remove" variant="ghost" size="small" accessibilityLabel={`Remove ${server.name}`} onPress={() => confirmRemove(server)} />
            </View>
          </View>
        );
      })}

      <Button label="Add server" variant="secondary" onPress={() => navigation.navigate('AddServer')} />
      <Button label="Notifications" variant="secondary" onPress={() => navigation.navigate('NotificationSettings')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.s9,
    paddingTop: space.s9,
    paddingBottom: space.s11,
    gap: space.s8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowMain: {
    flex: 1,
    minHeight: minTarget,
    padding: space.s9,
    gap: space.s2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
  },
  name: {
    fontSize: fontSize.heading,
    fontWeight: weight.semibold,
  },
  meta: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  remove: {
    paddingRight: space.s4,
  },
});
