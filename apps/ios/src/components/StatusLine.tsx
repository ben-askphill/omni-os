import { StyleSheet, Text, View } from 'react-native';

import { linkLabel } from '../live/connection';
import { useLink } from '../live/react';
import { fontSize, space, useOmniTheme } from '../theme';
import { StatusDot } from './StatusDot';

/** The connection state as one quiet line. It carries no banner and no colour beyond the dot. */
export function StatusLine() {
  const { colors } = useOmniTheme();
  const label = linkLabel(useLink());
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={`Connection: ${label.text}`} style={styles.row}>
      <StatusDot tone={label.tone} />
      <Text style={[styles.text, { color: label.tone === 'warn' ? colors.fg : colors.fg3 }]}>{label.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
    paddingVertical: space.s2,
  },
  text: {
    fontSize: fontSize.meta,
    fontWeight: '500',
  },
});
