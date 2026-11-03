import type { AppPushKind } from '@omni/shared/app-pairing.ts';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Text } from '../ui/Text';

import { useNotifications } from '../notifications/NotificationsProvider';
import type { PermissionState } from '../notifications/permission';
import { KIND_COPY, PUSH_KINDS } from '../notifications/preferences';
import { usePushPreferences } from '../notifications/usePushPreferences';
import { usePairing } from '../pairing/PairingProvider';
import type { PairedServer } from '../pairing/servers';
import { fontSize, lineHeight, minTarget, radius, space, useOmniTheme, weight } from '../theme';
import { Button } from '../ui/Button';

type PermissionKey = PermissionState | 'checking';

/** What "On this phone" says for each permission state, and the one thing a person can do about it. */
const PERMISSION_COPY: Record<
  PermissionKey,
  { text: string; action?: { label: string; run: 'requestPermission' | 'openSystemSettings' } }
> = {
  checking: { text: 'Checking what iOS allows.' },
  granted: { text: 'Notifications are on.' },
  undetermined: {
    text: 'Notifications are not turned on yet.',
    action: { label: 'Turn on notifications', run: 'requestPermission' },
  },
  denied: {
    text: 'Notifications are off for Omni OS in iOS Settings.',
    action: { label: 'Open Settings', run: 'openSystemSettings' },
  },
};

const REGISTRATION_FAILED =
  'This server could not register this phone for alerts. Omni tries again when you open the app.';

export function NotificationSettingsScreen() {
  const { colors } = useOmniTheme();
  const { servers } = usePairing();

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      <Section title="On this phone">
        <PermissionBody />
      </Section>
      {servers.map((server) => (
        <Section key={server.id} title={server.name} meta={server.origin}>
          <ServerBody server={server} />
        </Section>
      ))}
    </ScrollView>
  );
}

function Section({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  const { colors } = useOmniTheme();
  return (
    <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={styles.sectionHead}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.fg }]}>
          {title}
        </Text>
        {meta ? <Text style={[styles.meta, { color: colors.fg3 }]}>{meta}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function PermissionBody() {
  const { colors } = useOmniTheme();
  const notifications = useNotifications();
  const [busy, setBusy] = useState(false);
  const { text, action } = PERMISSION_COPY[notifications.permission ?? 'checking'];

  async function run(name: 'requestPermission' | 'openSystemSettings') {
    setBusy(true);
    try {
      await notifications[name]();
    } catch {
      // The screen reads permission from the provider, so a failed ask just leaves it unchanged.
    }
    setBusy(false);
  }

  return (
    <View style={styles.body}>
      <View style={styles.statusRow}>
        <Text style={[styles.text, styles.fill, { color: colors.fg2 }]}>{text}</Text>
        {notifications.permission === null ? <ActivityIndicator color={colors.fg3} /> : null}
      </View>
      {action ? <Button label={action.label} variant="secondary" busy={busy} onPress={() => void run(action.run)} /> : null}
    </View>
  );
}

function ServerBody({ server }: { server: PairedServer }) {
  const { colors } = useOmniTheme();
  const { registration } = useNotifications();
  const prefs = usePushPreferences(server);

  function renderPrefs() {
    switch (prefs.status) {
      case 'loading':
        return <ActivityIndicator accessibilityLabel={`Loading alerts for ${server.name}`} color={colors.fg3} />;
      case 'error':
        return (
          <View style={styles.body}>
            <Text style={[styles.text, { color: colors.fg2 }]}>{prefs.message}</Text>
            <Button label="Try again" variant="secondary" onPress={prefs.retry} />
          </View>
        );
      case 'ready':
        return (
          <View>
            {PUSH_KINDS.map((kind, index) => (
              <AlertSwitchRow
                key={kind}
                kind={kind}
                serverName={server.name}
                value={prefs.values?.[kind] ?? false}
                first={index === 0}
                onChange={(next) => prefs.toggle(kind, next)}
              />
            ))}
            {prefs.saveError ? <Text style={[styles.note, { color: colors.fg2 }]}>{prefs.saveError}</Text> : null}
          </View>
        );
    }
  }

  return (
    <View>
      {renderPrefs()}
      {registration[server.id] === 'failed' ? (
        <Text style={[styles.note, { color: colors.fg2 }]}>{REGISTRATION_FAILED}</Text>
      ) : null}
    </View>
  );
}

function AlertSwitchRow({
  kind,
  serverName,
  value,
  first,
  onChange,
}: {
  kind: AppPushKind;
  serverName: string;
  value: boolean;
  first: boolean;
  onChange: (next: boolean) => void;
}) {
  const { colors } = useOmniTheme();
  const { title, detail } = KIND_COPY[kind];
  return (
    <View style={[styles.row, !first && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <View style={styles.fill}>
        <Text style={[styles.rowTitle, { color: colors.fg }]}>{title}</Text>
        <Text style={[styles.rowDetail, { color: colors.fg3 }]}>{detail}</Text>
      </View>
      <Switch accessibilityLabel={`${title}, ${serverName}`} value={value} onValueChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.s9,
    paddingTop: space.s9,
    paddingBottom: space.s11,
    gap: space.s8,
  },
  section: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.s9,
    paddingVertical: space.s8,
    gap: space.s6,
  },
  sectionHead: {
    gap: space.s2,
  },
  sectionTitle: {
    fontSize: fontSize.heading,
    fontWeight: weight.semibold,
  },
  meta: {
    fontSize: fontSize.body,
  },
  body: {
    gap: space.s6,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
  },
  fill: {
    flex: 1,
  },
  text: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  note: {
    fontSize: fontSize.meta,
    lineHeight: Math.round(fontSize.meta * lineHeight.body),
    paddingTop: space.s4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
    minHeight: minTarget,
    paddingVertical: space.s6,
  },
  rowTitle: {
    fontSize: fontSize.input,
    fontWeight: weight.semibold,
  },
  rowDetail: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
});
