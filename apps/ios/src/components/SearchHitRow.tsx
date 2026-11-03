import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';

import type { HitRow } from '../search/search-model';
import { fontSize, lineHeight, minTarget, space, useOmniTheme, weight } from '../theme';

export function SearchHitRow({ row, onPress }: { row: HitRow; onPress: () => void }) {
  const { colors } = useOmniTheme();
  const meta = [`#${row.channel}`, row.statusLabel, row.ago].filter(Boolean).join(' · ');
  const excerpt = row.snippet.map((p) => p.text).join('');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[row.title, `#${row.channel}`, row.statusLabel, excerpt].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surface2 : colors.bg }]}
    >
      <View style={styles.body}>
        <Text numberOfLines={2} style={[styles.title, { color: colors.fg }]}>
          {row.title}
        </Text>
        <Text style={[styles.meta, { color: colors.fg3 }]}>{meta}</Text>
        {row.snippet.length ? (
          <Text numberOfLines={3} style={[styles.snippet, { color: colors.fg3 }]}>
            {row.snippet.map((p, i) => (
              <Text key={i} style={p.match ? { color: colors.fg, fontWeight: weight.semibold } : undefined}>
                {p.text}
              </Text>
            ))}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: minTarget,
    paddingHorizontal: space.s9,
    paddingVertical: space.s6,
  },
  body: {
    gap: space.s2 / 2,
  },
  title: {
    fontSize: fontSize.input,
    fontWeight: weight.medium,
    lineHeight: Math.round(fontSize.input * lineHeight.heading),
  },
  meta: {
    fontSize: fontSize.body,
  },
  snippet: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
});
