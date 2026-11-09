import type { ClaudeArtifactsState } from '@omni/shared/claude-artifacts.ts';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { fontSize, space, useOmniTheme } from '../../theme';
import { Text } from '../../ui/Text';
import { StatusDot } from '../StatusDot';
import { freshnessText } from './model';

/** When the claude.ai list was fetched, a spinner while a listing runs, and the needs diamond when it is a day old or failed. */
export function FreshnessLine({ server, now }: { server: ClaudeArtifactsState | null; now: number }) {
  const { colors } = useOmniTheme();
  const f = freshnessText(server, now);
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={f.text} style={styles.row}>
      {f.busy ? <ActivityIndicator size="small" color={colors.fg3} /> : f.tone === 'warn' ? <StatusDot glyph="needs" /> : null}
      <Text numberOfLines={1} style={[styles.text, { color: f.tone === 'warn' ? colors.fg : colors.fg3 }]}>
        {f.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s4, minHeight: 20 },
  text: { fontSize: fontSize.caption, flexShrink: 1 },
});
