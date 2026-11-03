import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';

import type { RootScreenProps } from '../navigation/types';
import { KIND_COPY, PUSH_KINDS } from '../notifications/preferences';
import { useNotifications } from '../notifications/NotificationsProvider';
import { fontSize, lineHeight, radius, space, useOmniTheme, weight } from '../theme';
import { Button } from '../ui/Button';

export function NotificationsIntroScreen({ navigation }: RootScreenProps<'NotificationsIntro'>) {
  const { colors } = useOmniTheme();
  const { requestPermission } = useNotifications();
  const [asking, setAsking] = useState(false);

  async function turnOn() {
    setAsking(true);
    try {
      await requestPermission();
    } catch {
      // The settings screen shows where permission stands, so there is nothing to report here.
    }
    navigation.goBack();
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      <Text accessibilityRole="header" style={[styles.title, { color: colors.fg }]}>
        Know when an agent needs you
      </Text>
      <Text style={[styles.body, { color: colors.fg2 }]}>
        Omni can alert this phone when a thread needs an answer, finishes or fails, or a crew member reports back. An
        alert only tells you where to go.
      </Text>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {PUSH_KINDS.map((kind) => (
          <View key={kind} style={styles.kind}>
            <Text style={[styles.kindTitle, { color: colors.fg }]}>{KIND_COPY[kind].title}</Text>
            <Text style={[styles.kindDetail, { color: colors.fg3 }]}>{KIND_COPY[kind].detail}</Text>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <Button label="Turn on notifications" busy={asking} onPress={() => void turnOn()} />
        <Button label="Not now" variant="secondary" disabled={asking} onPress={() => navigation.goBack()} />
      </View>

      <Text style={[styles.footnote, { color: colors.fg3 }]}>
        You can change this any time under Settings, then Notifications.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.s9,
    paddingTop: space.s10,
    paddingBottom: space.s11,
    gap: space.s8,
  },
  title: {
    fontSize: fontSize.titleLg,
    lineHeight: Math.round(fontSize.titleLg * lineHeight.tight),
    fontWeight: weight.semibold,
  },
  body: {
    fontSize: fontSize.input,
    lineHeight: Math.round(fontSize.input * lineHeight.body),
  },
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.s9,
    gap: space.s8,
  },
  kind: {
    gap: space.s2,
  },
  kindTitle: {
    fontSize: fontSize.input,
    fontWeight: weight.semibold,
  },
  kindDetail: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  actions: {
    gap: space.s4,
  },
  footnote: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
    textAlign: 'center',
  },
});
