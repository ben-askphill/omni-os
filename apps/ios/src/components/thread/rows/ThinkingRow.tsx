import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { duration } from '../../../thread/format';
import type { ThreadRow } from '../../../thread/rows';
import { fontSize, radius, space, useOmniTheme } from '../../../theme';
import { ShimmerText } from '../../../ui/ShimmerText';
import { Text } from '../../../ui/Text';
import { ThinkingMark } from '../../../ui/ThinkingMark';

/** Seconds since `since`, ticking; from when the row appeared when `since` does not parse. */
function useElapsed(since: string): number {
  const [mounted] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const start = new Date(since).getTime();
  return Math.max(0, now - (Number.isFinite(start) ? start : mounted));
}

/**
 * The running turn's thinking line, as phone web's ThinkingLine card (apps/web/src/components/thread/ThinkingLine.tsx):
 * the mark thinking, the label shimmering ("Thinking" or the agent's status) and how long the turn has run.
 */
export function ThinkingRow({ row }: { row: Extract<ThreadRow, { kind: 'thinking' }> }) {
  const { colors } = useOmniTheme();
  const took = duration(Math.floor(useElapsed(row.since) / 1000) * 1000);
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={`${row.label}, ${took}`} style={[styles.card, { backgroundColor: colors.surface }]}>
      <ThinkingMark size={16} color={colors.fg3} />
      <ShimmerText label={row.label} size={fontSize.body} />
      <Text style={[styles.took, { color: colors.fg3 }]}>{took}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Phone web: rounded-2xl bg-surface px-3.5 py-3, items centered, gap-2.
  card: { flexDirection: 'row', alignItems: 'center', gap: space.s4, borderRadius: radius.xl, paddingHorizontal: space.s7, paddingVertical: space.s6 },
  took: { flexShrink: 0, fontSize: fontSize.body, fontVariant: ['tabular-nums'] },
});
