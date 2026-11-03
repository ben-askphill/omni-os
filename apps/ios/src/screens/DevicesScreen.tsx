import type { OmniApi } from '@omni/client-core';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';

import { useLiveHub } from '../live/react';
import { useRemote } from '../live/use-remote';
import { RemoteList } from '../settings/RemoteList';
import { deviceRows, revokeConfirmation, withoutDevice, type DeviceRow } from '../settings/devices-model';
import { fontSize, minTarget, radius, space, useOmniTheme, weight } from '../theme';
import { GroupedList, ListRow } from '../ui/GroupedList';

const loadDevices = (api: OmniApi) => api.signedInDevices();

export function DevicesScreen() {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const remote = useRemote(loadDevices);
  const { data, reload, setData } = remote;
  const [revoking, setRevoking] = useState<string | null>(null);
  const rows = useMemo(() => deviceRows(data ?? [], Date.now()), [data]);

  async function revoke(row: DeviceRow) {
    setRevoking(row.id);
    try {
      await hub.request((api) => api.revokeDevice(row.id));
      if (data) setData(withoutDevice(data, row.id));
      await reload();
    } catch (e) {
      Alert.alert("Couldn't revoke", e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setRevoking(null);
    }
  }

  function confirm(row: DeviceRow) {
    const { title, message } = revokeConfirmation(row);
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: () => void revoke(row) },
    ]);
  }

  return (
    <RemoteList remote={remote} what="devices" emptyTitle="No signed-in devices" emptyHint="Devices show up here once this server has an owner signed in.">
      <GroupedList>
        {rows.map((row, i) => (
          <ListRow
            key={row.id}
            first={i === 0}
            title={row.name}
            detail={row.detail}
            trailing={
              <View style={styles.trailing}>
                {row.current ? <Text style={[styles.marker, { color: colors.fg2, borderColor: colors.lineStrong }]}>This device</Text> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={row.revokeLabel}
                  accessibilityState={{ disabled: revoking !== null }}
                  disabled={revoking !== null}
                  onPress={() => confirm(row)}
                  style={({ pressed }) => [styles.revoke, { opacity: revoking !== null && revoking !== row.id ? 0.5 : pressed ? 0.6 : 1 }]}
                >
                  <Text style={[styles.revokeLabel, { color: colors.fg2 }]}>{revoking === row.id ? 'Revoking' : 'Revoke'}</Text>
                </Pressable>
              </View>
            }
          />
        ))}
      </GroupedList>
    </RemoteList>
  );
}

const styles = StyleSheet.create({
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
  },
  marker: {
    fontSize: fontSize.meta,
    fontWeight: weight.semibold,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: space.s4,
    paddingVertical: 1,
  },
  revoke: {
    minHeight: minTarget,
    minWidth: minTarget,
    paddingHorizontal: space.s4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  revokeLabel: {
    fontSize: fontSize.body,
    fontWeight: weight.semibold,
  },
});
