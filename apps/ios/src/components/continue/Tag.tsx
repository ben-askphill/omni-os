import { StyleSheet, Text, View } from 'react-native';

import { fontSize, radius, space, useOmniTheme } from '../../theme';

/** A word beside a row: a file's change, a check's result, "Shortened", "Too big". */
export function Tag({ label, tone }: { label: string; tone?: 'pass' | 'fail' }) {
  const { colors } = useOmniTheme();
  return (
    <View style={[styles.tag, { backgroundColor: colors.surface2 }]}>
      <Text style={[styles.label, { color: tone ? colors.fg : colors.fg3, fontWeight: tone ? '700' : '500' }]}>{label}</Text>
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
