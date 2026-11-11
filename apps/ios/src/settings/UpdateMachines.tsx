import type { OmniApi } from '@omni/client-core';
import {
  fleetSummary,
  leftOutNote,
  rowAction,
  rowLabel,
  rowTone,
  sinceLine,
  TRACK_LABEL,
  versionLine,
  type FleetMachine,
  type FleetRequest,
  type FleetSkip,
  type FleetView,
} from '@omni/shared/update-fleet.ts';
import { useEffect, useState } from 'react';
import { Alert, AppState, StyleSheet, View } from 'react-native';

import { StatusDot } from '../components/StatusDot';
import { useLiveHub } from '../live/react';
import type { Remote } from '../live/use-remote';
import { fontSize, lineHeight, minTarget, mono, space, useOmniTheme, weight } from '../theme';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Chip } from '../ui/Chip';
import { Text } from '../ui/Text';
import { Footnote, Group } from './parts';
import { skippedText, updateConfirmation, updateSplit } from './update-machines-model';

// Settings, Machines: Update all machines, as the Web UI's card (apps/web/src/pages/UpdateMachines.tsx). Check,
// Download all and Update all ask every synced machine through POST /api/update/fleet; each row is that machine's own
// answer, so one failing or offline machine never holds up the others.

const POLL_MS = 15_000;
const SKIPPED_SHOWN_MS = 10_000;

export const loadFleet = (api: OmniApi) => api.updateFleet();

export function UpdateMachinesGroup({ fleet }: { fleet: Remote<FleetView> }) {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const { data, reload, setData } = fleet;
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<FleetSkip[]>([]);

  // A remote machine's answer and its reach change without a feed event the phone hears, so poll while the app is up.
  useEffect(() => {
    const t = setInterval(() => AppState.currentState === 'active' && void reload(), POLL_MS);
    return () => clearInterval(t);
  }, [reload]);
  useEffect(() => {
    if (!skipped.length) return;
    const t = setTimeout(() => setSkipped([]), SKIPPED_SHOWN_MS);
    return () => clearTimeout(t);
  }, [skipped]);

  const rows = data?.machines ?? [];
  const { asked } = updateSplit(rows);

  /** `key` names the button that shows the spinner. */
  const send = async (key: string, request: FleetRequest) => {
    setSending(key);
    setError(null);
    setSkipped([]);
    try {
      const result = await hub.request((api) => api.askFleet(request));
      setData(result);
      setSkipped(result.skipped);
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setSending(null);
    }
  };

  const confirmUpdate = () => {
    const c = updateConfirmation(rows);
    if (!c) return;
    Alert.alert(c.title, c.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: c.confirmLabel, onPress: () => void send('update', { action: 'update' }) },
    ]);
  };

  return (
    <View style={styles.group}>
      <Group title="Update all machines">
        <View style={styles.head}>
          <Text style={[styles.detail, { color: colors.fg3 }]}>
            Download fetches the update on every machine without restarting anything. Update downloads what is missing, then restarts each machine once no turn runs
            there.
          </Text>
          <View style={styles.buttons}>
            <Button label="Check" variant="ghost" size="small" busy={sending === 'check'} disabled={!data || !!sending} onPress={() => void send('check', { action: 'check' })} />
            <Button
              label="Download all"
              variant="secondary"
              size="small"
              busy={sending === 'download'}
              disabled={!data || !!sending}
              onPress={() => void send('download', { action: 'download' })}
            />
            <Button label="Update all" size="small" busy={sending === 'update'} disabled={!asked.length || !!sending} onPress={confirmUpdate} />
          </View>
          {data ? <Text style={[styles.detail, { color: colors.fg2 }]}>{fleetSummary(rows)}</Text> : null}
        </View>
        {rows.map((m) => (
          <FleetRow key={m.id} m={m} sending={sending} onSend={send} />
        ))}
      </Group>
      {error ? <Callout message={error} /> : null}
      {fleet.error && !data ? <Callout message={`Couldn't load the machines: ${fleet.error}`} /> : null}
      {skipped.length ? (
        <Callout message="Left out">
          <Text style={[styles.detail, { color: colors.fg2 }]}>{skippedText(skipped)}</Text>
        </Callout>
      ) : null}
      {data && !data.synced ? (
        <Footnote>Only this server's machine is listed. Sync your other machines with it and this list updates them too. Sync is set up on the computer.</Footnote>
      ) : null}
    </View>
  );
}

function FleetRow({ m, sending, onSend }: { m: FleetMachine; sending: string | null; onSend: (key: string, request: FleetRequest) => Promise<void> }) {
  const { colors } = useOmniTheme();
  const version = versionLine(m.status);
  const lasting = sinceLine(m);
  const note = leftOutNote(m);
  const action = rowAction(m);
  const label = rowLabel(m);
  return (
    <View style={[styles.row, { borderTopColor: colors.line }]} accessible={!action} accessibilityLabel={`${m.name}, ${label}`}>
      <View style={styles.line}>
        <StatusDot glyph={rowTone(m.state)} size={7} />
        <Text numberOfLines={1} style={[styles.name, { color: colors.fg }]}>
          {m.name}
        </Text>
        <Text numberOfLines={1} style={[styles.state, { color: colors.fg2 }]}>
          {label}
        </Text>
      </View>
      {m.current || m.status || lasting ? (
        <View style={[styles.meta, styles.indent]}>
          {m.current ? <Chip label="This server" tone="outline" /> : null}
          {m.status ? <Text style={[styles.small, { color: colors.fg3 }]}>{TRACK_LABEL[m.status.track]}</Text> : null}
          {version ? <Text style={[styles.small, styles.mono, { color: colors.fg3 }]}>{version}</Text> : null}
          {lasting ? <Text style={[styles.small, { color: colors.fg3 }]}>{lasting}</Text> : null}
        </View>
      ) : null}
      {m.state === 'failed' && m.status?.error ? <Text style={[styles.detail, styles.indent, { color: colors.fg2 }]}>{m.status.error}</Text> : null}
      {note ? <Text style={[styles.detail, styles.indent, { color: colors.fg3 }]}>{note}</Text> : null}
      {action ? (
        <View style={styles.indent}>
          <Button
            label={action.label}
            variant={action.label === 'Update' ? 'primary' : 'secondary'}
            size="compact"
            accessibilityLabel={`${action.label} ${m.name}`}
            busy={sending === `row:${m.id}`}
            disabled={!!sending}
            onPress={() => void onSend(`row:${m.id}`, action.request)}
          />
        </View>
      ) : null}
    </View>
  );
}

/** The dot's width and the gap after it, so a row's second line starts under its name. */
const INDENT = 7 + space.s4;

const styles = StyleSheet.create({
  group: {
    gap: space.s4,
  },
  head: {
    paddingHorizontal: space.s8,
    paddingVertical: space.s6,
    gap: space.s5,
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.s4,
  },
  row: {
    minHeight: minTarget,
    paddingHorizontal: space.s8,
    paddingVertical: space.s6,
    gap: space.s3,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
  },
  name: {
    flex: 1,
    fontSize: fontSize.subhead,
    fontWeight: weight.medium,
  },
  state: {
    flexShrink: 0,
    maxWidth: '55%',
    fontSize: fontSize.ui,
    textAlign: 'right',
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.s4,
    rowGap: space.s2,
  },
  indent: {
    paddingLeft: INDENT,
    alignItems: 'flex-start',
  },
  small: {
    fontSize: fontSize.caption,
  },
  mono: {
    fontFamily: mono,
  },
  detail: {
    fontSize: fontSize.small,
    lineHeight: Math.round(fontSize.small * lineHeight.body),
  },
});
