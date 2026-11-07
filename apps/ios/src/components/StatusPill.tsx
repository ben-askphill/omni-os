import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';

import { fontSize, radius, space, useOmniTheme, weight } from '../theme';
import { type Glyph, StatusDot } from './StatusDot';

/**
 * A status as a pill (web: .spill). Neutral, except running, which writes in blue, and needs and done, which fill with
 * their colour and carry ink text.
 */
export function StatusPill({ glyph, label }: { glyph: Glyph; label: string }) {
  const { colors } = useOmniTheme();
  const fill = glyph === 'needs' ? colors.needs : glyph === 'done' ? colors.done : colors.surface2;
  const ink = glyph === 'needs' ? colors.onNeeds : glyph === 'done' ? colors.onDone : glyph === 'running' ? colors.live : colors.fg2;
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={label} style={[styles.pill, { backgroundColor: fill }]}>
      {glyph === 'needs' || glyph === 'done' ? <View style={[styles.dot, { backgroundColor: ink }]} /> : <StatusDot glyph={glyph} size={6} />}
      <Text numberOfLines={1} style={[styles.label, { color: ink }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.s3,
    paddingLeft: space.s4,
    paddingRight: space.s5,
    borderRadius: radius.pill,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: fontSize.caption,
    fontWeight: weight.medium,
  },
});
