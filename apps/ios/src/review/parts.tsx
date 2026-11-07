import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';

import { fontSize, radius, space, useOmniTheme, weight } from '../theme';

export function DiffCount({ add, del }: { add: number; del: number }) {
  const { colors } = useOmniTheme();
  return (
    <Text accessibilityLabel={`${add} added, ${del} removed`} style={styles.count}>
      <Text style={{ color: colors.fg2 }}>+{add}</Text>
      <Text style={{ color: colors.fg3 }}> −{del}</Text>
    </Text>
  );
}

export function Loading({ label }: { label: string }) {
  const { colors } = useOmniTheme();
  return (
    <View accessibilityLabel={label} style={[styles.loading, { backgroundColor: colors.bg }]}>
      <ActivityIndicator color={colors.fg3} />
    </View>
  );
}

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.fg3 }]}>
        {count === undefined ? title : `${title} · ${count}`}
      </Text>
      <View style={[styles.group, { backgroundColor: colors.surface }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    paddingTop: space.s12,
  },
  count: {
    fontSize: fontSize.body,
    fontVariant: ['tabular-nums'],
  },
  section: {
    gap: space.s2,
  },
  sectionTitle: {
    fontSize: fontSize.meta,
    fontWeight: weight.semibold,
    textTransform: 'uppercase',
    paddingHorizontal: space.s2,
  },
  group: {
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
});
