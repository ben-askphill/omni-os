import { StyleSheet, View } from 'react-native';

import { useOmniTheme } from '../theme';

export type DotTone = 'ok' | 'muted' | 'warn';

/**
 * A status dot. The theme has no success or danger colour yet, so the tone is carried by fill and ring: `ok` is solid,
 * `warn` is a ring, `muted` is faint.
 */
export function StatusDot({ tone }: { tone: DotTone }) {
  const { colors } = useOmniTheme();
  if (tone === 'warn') {
    return <View style={[styles.dot, { borderWidth: 2, borderColor: colors.fg }]} />;
  }
  return <View style={[styles.dot, { backgroundColor: tone === 'ok' ? colors.fg : colors.fg4 }]} />;
}

const styles = StyleSheet.create({
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
