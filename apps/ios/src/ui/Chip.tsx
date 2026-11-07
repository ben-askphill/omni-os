import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { fontSize, radius, space, useOmniTheme, weight } from '../theme';

export type ChipTone = 'neutral' | 'outline' | 'live' | 'done' | 'needs';

/** The height of a chip (design system: --h-chip). */
const HEIGHT = 20;

/**
 * A word that labels a row and does nothing when tapped: "Setup", "This device", a PR's state (design system: Chip,
 * .om-chip). Neutral is a soft fill, outline a hairline ring; live writes in blue; needs and done fill with ink text.
 * `strong` sets the label in ink and bold, for a result that matters (a check that passed or failed).
 */
export function Chip({ label, tone = 'neutral', strong = false }: { label: string; tone?: ChipTone; strong?: boolean }) {
  const { colors } = useOmniTheme();
  const look = {
    neutral: { fill: colors.surface2, ink: colors.fg2, edge: 'transparent' },
    outline: { fill: 'transparent', ink: colors.fg3, edge: colors.lineStrong },
    live: { fill: colors.surface2, ink: colors.live, edge: 'transparent' },
    done: { fill: colors.done, ink: colors.onDone, edge: 'transparent' },
    needs: { fill: colors.needs, ink: colors.onNeeds, edge: 'transparent' },
  }[tone];
  return (
    <View style={[styles.chip, { backgroundColor: look.fill, borderColor: look.edge }]}>
      <Text numberOfLines={1} style={[styles.label, { color: strong ? colors.fg : look.ink }, strong && styles.strong]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: HEIGHT,
    flexShrink: 0,
    justifyContent: 'center',
    paddingHorizontal: space.s4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: fontSize.meta,
    fontWeight: weight.regular,
  },
  strong: {
    fontWeight: weight.bold,
  },
});
