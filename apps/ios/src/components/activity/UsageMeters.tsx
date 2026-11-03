import { StyleSheet, View } from 'react-native';
import { Text } from '../../ui/Text';

import type { UsageMeter } from '../../live/activity-model';
import { fontSize, radius, space, useOmniTheme } from '../../theme';

const BAR = 48;

/** Each plan's fullest window as a pill: name, a small meter, "42% 5h". Nothing while no harness reports one. */
export function UsageMeters({ meters }: { meters: UsageMeter[] }) {
  const { colors } = useOmniTheme();
  if (!meters.length) return null;
  return (
    <View accessibilityLabel="Plan usage" style={styles.row}>
      {meters.map((m) => {
        const pct = Math.round(m.fraction * 100);
        return (
          <View
            key={m.id}
            accessible
            accessibilityLabel={`${m.name}, ${pct}% of the ${m.unit === '5h' ? 'five-hour' : 'monthly'} limit used`}
            style={[styles.pill, { backgroundColor: colors.surface }]}
          >
            <Text style={[styles.name, { color: colors.fg }]}>{m.name}</Text>
            <View style={[styles.track, { backgroundColor: colors.surface3 }]}>
              <View style={[styles.fill, { width: m.fraction * BAR, backgroundColor: colors.fg }]} />
            </View>
            <Text style={[styles.value, { color: colors.fg3 }]}>
              {`${pct}% `}
              <Text style={{ color: colors.fg4 }}>{m.unit}</Text>
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.s4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
    borderRadius: radius.pill,
    paddingVertical: space.s2 + 2,
    paddingHorizontal: space.s6,
  },
  name: {
    fontSize: fontSize.meta + 1,
  },
  track: {
    width: BAR,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: 6,
    borderRadius: 3,
  },
  value: {
    fontSize: fontSize.meta + 1,
    fontVariant: ['tabular-nums'],
  },
});
