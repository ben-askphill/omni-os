import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';

import { linkLabel } from '../live/connection';
import { useLink } from '../live/react';
import { fontSize, space, useOmniTheme, weight } from '../theme';
import { StatusDot } from './StatusDot';

/**
 * The connection state as one quiet line, shown only while the link is not live (phone web shows nothing then). A link
 * that needs the user wears the needs-you diamond; one in between, an idle ring.
 */
export function StatusLine() {
  const { colors } = useOmniTheme();
  const label = linkLabel(useLink());
  if (label.tone === 'ok') return null;
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={`Connection: ${label.text}`} style={styles.row}>
      <StatusDot glyph={label.tone === 'warn' ? 'needs' : 'idle'} />
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
    fontSize: fontSize.small,
    fontWeight: weight.medium,
  },
});
