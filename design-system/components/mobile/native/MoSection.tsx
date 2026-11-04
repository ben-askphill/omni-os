import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { phone, type, useOmniTheme } from './theme';

/** A list section: sentence-case caption, a quiet count, an optional trailing action. */
export function MoSection({ title, count, right, flush = false, children }: { title: string; count?: number; right?: ReactNode; flush?: boolean; children?: ReactNode }) {
  const { colors } = useOmniTheme();
  return (
    <View style={[styles.section, !flush && { paddingHorizontal: phone.gutter }]}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[type.caption, { color: colors.fg3 }]}>{title}</Text>
        {count != null && <Text style={[type.meta, { color: colors.fg4 }]}>{count}</Text>}
        <View style={{ flex: 1 }} />
        {right}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 20, paddingHorizontal: 4 },
});
