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

export type ChipTone = 'live' | 'done' | 'needs' | 'outline';

export function Chip({ label, tone }: { label: string; tone: ChipTone }) {
  const { colors } = useOmniTheme();
  const look = {
    live: { backgroundColor: colors.surface2, color: colors.live },
    done: { backgroundColor: colors.done, color: colors.ink },
    needs: { backgroundColor: colors.needs, color: colors.ink },
    outline: { backgroundColor: colors.surface2, color: colors.fg3 },
  }[tone];
  return (
    <View style={[styles.chip, { backgroundColor: look.backgroundColor }]}>
      <Text style={[styles.chipLabel, { color: look.color }]}>{label}</Text>
    </View>
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
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: space.s4,
    paddingVertical: 3,
  },
  chipLabel: {
    fontSize: fontSize.meta + 1,
    fontWeight: weight.semibold,
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
    borderRadius: radius.md,
    overflow: 'hidden',
  },
});
