import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';

import { contextLabels } from '../context/labels';
import { fontSize, radius, space, useOmniTheme, weight } from '../theme';

/** The context a sent message carries, as chips above its bubble. A message that is only context has no bubble. */
export function ContextChips({ records }: { records: unknown }) {
  const { colors } = useOmniTheme();
  const labels = contextLabels(records);
  if (!labels.length) return null;
  return (
    <View accessibilityLabel="Added to this message" style={styles.row}>
      {labels.map((label, i) => (
        <View key={i} style={[styles.chip, { backgroundColor: colors.surface2 }]}>
          <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.label, { color: colors.fg2 }]}>
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    maxWidth: '92%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: space.s2,
  },
  chip: {
    maxWidth: 260,
    borderRadius: radius.pill,
    paddingVertical: space.s2,
    paddingHorizontal: space.s4,
  },
  label: {
    fontSize: fontSize.meta + 1,
    fontWeight: weight.semibold,
  },
});
