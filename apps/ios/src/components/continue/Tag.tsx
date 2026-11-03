import { StyleSheet, View } from 'react-native';
import { Text } from '../../ui/Text';

import { fontSize, radius, space, useOmniTheme, weight } from '../../theme';

/** A word beside a row: a file's change, a check's result, "Shortened", "Too big". */
export function Tag({ label, tone }: { label: string; tone?: 'pass' | 'fail' }) {
  const { colors } = useOmniTheme();
  return (
    <View style={[styles.tag, { backgroundColor: colors.surface2 }]}>
      <Text style={[styles.label, { color: tone ? colors.fg : colors.fg3, fontWeight: tone ? weight.bold : weight.medium }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    borderRadius: radius.pill,
    paddingHorizontal: space.s4,
    paddingVertical: 2,
  },
  label: {
    fontSize: fontSize.meta,
  },
});
