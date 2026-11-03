import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';

import type { RootScreenProps } from '../navigation/types';
import { describePairingError } from '../pairing/messages';
import { usePairing } from '../pairing/PairingProvider';
import type { PairedServer } from '../pairing/servers';
import { STATUS_LABEL } from '../pairing/status';
import { fontSize, lineHeight, minTarget, radius, space, useOmniTheme, weight } from '../theme';
import { Button } from '../ui/Button';

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
                {active && (
                  <Text
                    style={[styles.activeMarker, { color: colors.fg2, borderColor: colors.lineStrong }]}
                  >
                    Active
                  </Text>
                )}
              </View>
              <Text style={[styles.meta, { color: colors.fg3 }]}>{server.origin}</Text>
              {statusLabel !== null && (
                <Text style={[styles.meta, { color: colors.fg3 }]}>{statusLabel}</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${server.name}`}
              onPress={() => confirmRemove(server)}
              style={styles.remove}
            >
              <Text style={[styles.removeLabel, { color: colors.fg2 }]}>Remove</Text>
            </Pressable>
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
  activeMarker: {
    fontSize: fontSize.meta,
    fontWeight: weight.semibold,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: space.s4,
    paddingVertical: 1,
  },
  meta: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  remove: {
    minHeight: minTarget,
    minWidth: minTarget,
    paddingHorizontal: space.s8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeLabel: {
    fontSize: fontSize.body,
    fontWeight: weight.semibold,
  },
});
