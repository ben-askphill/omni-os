import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MoRoundButton } from './MoButtons';
import { phone, type, useOmniTheme } from './theme';

/** Pushed-screen header: back, one-line title and subtitle, at most two trailing actions. Clears the status bar. */
export function MoHeader({ title, sub, onBack, left, right, flush = false }: {
  title?: string; sub?: string; onBack?: () => void; left?: ReactNode; right?: ReactNode; flush?: boolean;
}) {
  const { colors } = useOmniTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: flush ? 0 : insets.top, backgroundColor: colors.bg, zIndex: 2 }}>
      <View style={styles.bar}>
        {onBack ? <MoRoundButton icon="chevronLeft" label="Back" onPress={onBack} /> : left}
        <View style={styles.text}>
          {title ? <Text numberOfLines={1} style={[type.navTitle, { color: colors.fg }]}>{title}</Text> : null}
          {sub ? <Text numberOfLines={1} style={[type.navSub, { color: colors.fg3 }]}>{sub}</Text> : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

/** Large title on tab roots only. The subtitle counts what matters now: needs you in ink, running in live text. */
export function MoLargeTitle({ title, sub, needs = 0, running = 0 }: { title: string; sub?: string; needs?: number; running?: number }) {
  const { colors } = useOmniTheme();
  const parts: ReactNode[] = [];
  if (sub) parts.push(<Text key="s">{sub}</Text>);
  if (running) parts.push(<Text key="r" style={{ color: colors.live }}>{running} running</Text>);
  if (needs) parts.push(<Text key="n" style={{ color: colors.fg, fontWeight: '500' }}>{needs} need{needs === 1 ? 's' : ''} you</Text>);
  return (
    <View style={styles.title}>
      <Text accessibilityRole="header" style={[type.largeTitle, { color: colors.fg }]}>{title}</Text>
      {parts.length > 0 && (
        <Text style={[type.titleSub, { color: colors.fg3, marginTop: 6 }]}>
          {parts.flatMap((p, i) => (i ? [' · ', p] : [p]))}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: phone.headerH, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },
  text: { flex: 1, minWidth: 0 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { paddingTop: 4, paddingHorizontal: 20, paddingBottom: 14 },
});
