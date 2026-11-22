import { StyleSheet, View } from 'react-native';

import { progressInk, progressLine, type StepProgress } from '@omni/shared/steps.ts';
import { fontSize, space, useOmniTheme } from '../../theme';
import { Text } from '../../ui/Text';

/** Ticks at most: a long list keeps the bar short (the web's BranchProgress). */
const MAX_TICKS = 12;

/**
 * A delegated thread's step list in brief on its row of a delegation card, as the web's BranchProgress shows it: a
 * segmented bar, the step it is on, and what it does now while it runs (@omni/shared/steps.ts StepProgress).
 */
export function BranchProgress({ p }: { p: StepProgress }) {
  const { colors } = useOmniTheme();
  const ticks = Math.min(MAX_TICKS, Math.max(1, p.count));
  const value = p.count ? p.done / p.count : 0;
  const on = value > 0 ? Math.max(1, Math.round(value * ticks)) : 0;
  const ink = progressInk(p);
  const fill = ink === 'needs' ? colors.needs : ink === 'muted' ? colors.fg3 : colors.fg;
  const line = progressLine(p);
  return (
    <View style={styles.wrap} accessible accessibilityLabel={p.now ? `${line}. Now: ${p.now}` : line}>
      <View style={styles.row}>
        <View style={styles.bar}>
          {Array.from({ length: ticks }, (_, i) => (
            <View key={i} style={[styles.tick, i < on ? { backgroundColor: fill, height: 7 } : { backgroundColor: colors.lineStrong }]} />
          ))}
        </View>
        <Text numberOfLines={1} style={[styles.text, { color: p.live ? colors.fg2 : colors.fg3 }]}>
          {line}
        </Text>
      </View>
      {p.now ? (
        <Text numberOfLines={1} style={[styles.text, { color: colors.fg3 }]}>
          {`Now: ${p.now}`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space.s3, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s5 },
  bar: { width: 64, height: 7, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  tick: { flex: 1, height: 4, borderRadius: 1.5 },
  text: { flexShrink: 1, fontSize: fontSize.meta },
});
