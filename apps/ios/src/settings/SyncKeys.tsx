import type { OmniApi, RefusedChange, SyncDeviceKey } from '@omni/client-core';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { useLiveHub } from '../live/react';
import type { Remote } from '../live/use-remote';
import { fontSize, lineHeight, minTarget, mono, space, useOmniTheme, weight } from '../theme';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Chip } from '../ui/Chip';
import { ListRow } from '../ui/GroupedList';
import { Text } from '../ui/Text';
import { loadOptional, optionalView, type Optional } from './optional-remote';
import { Group } from './parts';
import { confirmKeyConfirmation, refusedRows, syncKeyRows, withKeyConfirmed, type SyncKeyRow } from './sync-keys-model';

// Settings, Sync: each synced machine's signing-key fingerprint with Confirm new key when it changed, and the changes
// this machine refused. Both hide on a server that predates signed sync (a 404).

export const loadSyncKeys = (api: OmniApi) => loadOptional(api.syncDevices());
export const loadRefused = (api: OmniApi) => loadOptional(api.refusedChanges(50));

function Pending({ title, remote, what }: { title: string; remote: Remote<unknown>; what: string }) {
  const { colors } = useOmniTheme();
  if (!remote.error || remote.loading) return <ActivityIndicator accessibilityLabel={`Loading ${what}`} color={colors.fg3} />;
  return (
    <Group title={title} footer={`Couldn't load ${what}: ${remote.error}`}>
      <ListRow first title="Try again" icon="refresh" onPress={() => void remote.reload()} />
    </Group>
  );
}

export function SyncKeysGroup({ remote }: { remote: Remote<Optional<SyncDeviceKey[]>> }) {
  const hub = useLiveHub();
  const { data, reload, setData } = remote;
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const devices = data && !data.missing ? data.value : null;
  const rows = useMemo(() => syncKeyRows(devices ?? []), [devices]);
  const view = optionalView(remote);

  if (view === 'hidden') return null;
  if (view !== 'ready') return <Pending title="Signing keys" remote={remote} what="the signing keys" />;

  async function confirmKey(row: SyncKeyRow) {
    setConfirming(row.id);
    setError(null);
    try {
      await hub.request((api) => api.confirmSyncKey(row.id));
      setData({ missing: false, value: withKeyConfirmed(devices ?? [], row.id) });
      void reload();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.');
    } finally {
      setConfirming(null);
    }
  }

  function ask(row: SyncKeyRow) {
    const c = confirmKeyConfirmation(row);
    Alert.alert(c.title, c.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: c.confirmLabel, onPress: () => void confirmKey(row) },
    ]);
  }

  return (
    <View style={styles.stack}>
      <Group title="Signing keys" footer="Each machine signs the changes it syncs. When a machine's key changes, what it signs is refused until you confirm the new key.">
        {rows.length ? (
          rows.map((row, i) => <KeyRow key={row.id} row={row} first={i === 0} busy={confirming === row.id} disabled={confirming !== null} onConfirm={() => ask(row)} />)
        ) : (
          <ListRow first title="No synced machines yet" />
        )}
      </Group>
      {error ? <Callout message={error} /> : null}
    </View>
  );
}

function KeyRow({ row, first, busy, disabled, onConfirm }: { row: SyncKeyRow; first: boolean; busy: boolean; disabled: boolean; onConfirm: () => void }) {
  const { colors } = useOmniTheme();
  return (
    <View style={[styles.row, !first && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <View style={styles.line}>
        <Text numberOfLines={1} style={[styles.name, { color: colors.fg }]}>
          {row.name}
        </Text>
        {row.current ? <Chip label="This machine" tone="outline" /> : null}
        {row.keyChanged ? <Chip label="Key changed" tone="needs" /> : null}
      </View>
      <Text selectable accessibilityLabel={`Key fingerprint ${row.fingerprint}`} style={[styles.fingerprint, { color: colors.fg2 }]}>
        {row.fingerprint}
      </Text>
      {row.pinned ? (
        <Text selectable style={[styles.detail, { color: colors.fg3 }]}>
          Pinned key: <Text style={[styles.fingerprint, { color: colors.fg3 }]}>{row.pinned}</Text>
        </Text>
      ) : null}
      {row.confirmLabel ? (
        <View style={styles.action}>
          <Button label="Confirm new key" variant="secondary" size="compact" accessibilityLabel={row.confirmLabel} busy={busy} disabled={disabled} onPress={onConfirm} />
        </View>
      ) : null}
    </View>
  );
}

export function RefusedChangesGroup({ remote }: { remote: Remote<Optional<RefusedChange[]>> }) {
  const rows = useMemo(() => refusedRows(remote.data && !remote.data.missing ? remote.data.value : [], Date.now()), [remote.data]);
  const view = optionalView(remote);
  if (view === 'hidden') return null;
  if (view !== 'ready') return <Pending title="Refused changes" remote={remote} what="the refused changes" />;
  return (
    <Group title="Refused changes" footer="Synced changes this machine did not apply, newest first: a bad or missing signature, a key that changed, or a path outside the allowed folders.">
      {rows.length ? rows.map((r, i) => <ListRow key={r.key} first={i === 0} title={r.title} detail={r.detail} />) : <ListRow first title="None" />}
    </Group>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space.s4,
  },
  row: {
    minHeight: minTarget,
    paddingHorizontal: space.s8,
    paddingVertical: space.s6,
    gap: space.s3,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
  },
  name: {
    flexShrink: 1,
    fontSize: fontSize.subhead,
    fontWeight: weight.medium,
  },
  fingerprint: {
    fontFamily: mono,
    fontSize: fontSize.caption,
    lineHeight: Math.round(fontSize.caption * 1.4),
    fontWeight: '400',
  },
  detail: {
    fontSize: fontSize.small,
    lineHeight: Math.round(fontSize.small * lineHeight.body),
  },
  action: {
    alignItems: 'flex-start',
  },
});
