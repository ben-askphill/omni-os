import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from './Icon';
import type { IconName } from './icon-paths';
import { phone, type, useOmniTheme } from './theme';

/** Inset group on surface: settings, channels, checks, files. */
export function MoGroup({ children }: { children: ReactNode }) {
  const { colors } = useOmniTheme();
  return <View style={{ backgroundColor: colors.surface, borderRadius: phone.cardRadius, overflow: 'hidden' }}>{children}</View>;
}

/**
 * Grouped-list row: 52pt minimum, icon, label and sub, a value or control (a Switch) on the right, a chevron when it
 * pushes. The hairline starts after the icon. No red labels: the pops mean status only.
 */
export function MoListRow({ icon, label, sub, value, right, onPress, chevron, last = false }: {
  icon?: IconName | ReactNode; label: string; sub?: string; value?: string; right?: ReactNode; onPress?: () => void;
  chevron?: boolean; last?: boolean;
}) {
  const { colors } = useOmniTheme();
  const pushes = chevron ?? !!onPress;
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.wash }]}>
      {icon ? <View style={styles.icon}>{typeof icon === 'string' ? <Icon name={icon as IconName} size={18} color={colors.fg2} /> : icon}</View> : null}
      <View style={[styles.body, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lineStrong }]}>
        <View style={styles.text}>
          <Text numberOfLines={1} style={[type.row, { color: colors.fg }]}>{label}</Text>
          {sub ? <Text numberOfLines={1} style={[type.sub, { color: colors.fg3 }]}>{sub}</Text> : null}
        </View>
        {value ? <Text style={[type.value, { color: colors.fg3 }]}>{value}</Text> : null}
        {right}
        {pushes && <Icon name="chevronRight" size={16} color={colors.fg4} />}
      </View>
    </Pressable>
  );
}

export function MoRadio({ on }: { on: boolean }) {
  const { colors } = useOmniTheme();
  return (
    <View style={[styles.radio, on ? { backgroundColor: colors.fg } : { borderWidth: 1.5, borderColor: colors.lineStrong }]}>
      {on && <View style={[styles.radioDot, { backgroundColor: colors.bg }]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: phone.rowMin, paddingLeft: 16 },
  icon: { width: 18, alignItems: 'center' },
  body: { flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 16 },
  text: { flex: 1, minWidth: 0, gap: 1, paddingVertical: 10 },
  radio: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 8, height: 8, borderRadius: 4 },
});
