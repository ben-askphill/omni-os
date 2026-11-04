import { StyleSheet, Text, View } from 'react-native';

import { Icon } from './Icon';
import type { IconName } from './icon-paths';
import { Press } from './Press';
import { phone, type, useOmniTheme } from './theme';

/** 40pt round button. default: surface-2 · ink: the one primary action · quiet: no fill, on a surface. */
export function MoRoundButton({ icon, label, onPress, tone = 'default', size = phone.round, disabled }: {
  icon: IconName; label: string; onPress?: () => void; tone?: 'default' | 'ink' | 'quiet'; size?: number; disabled?: boolean;
}) {
  const { colors } = useOmniTheme();
  const bg = tone === 'ink' ? colors.fg : tone === 'quiet' ? 'transparent' : colors.surface2;
  const fg = tone === 'ink' ? colors.onInk : colors.fg;
  return (
    <Press accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={Math.max(0, (phone.minTarget - size) / 2)}
      style={[styles.round, { width: size, height: size, backgroundColor: bg, opacity: disabled ? 0.4 : 1 }]}>
      <Icon name={icon} size={size >= phone.round ? 18 : 16} color={fg} />
    </Press>
  );
}

export type MoAction = { label: string; icon?: IconName; tone?: 'default' | 'ink' | 'needs'; diff?: [number, number]; onPress?: () => void };

/** 36pt action chip: this thread's next step. needs = an answer. */
export function MoActionChip({ label, icon, tone = 'default', diff, onPress }: MoAction) {
  const { colors } = useOmniTheme();
  const bg = tone === 'ink' ? colors.fg : tone === 'needs' ? colors.needs : colors.surface2;
  const fg = tone === 'ink' ? colors.onInk : tone === 'needs' ? colors.onNeeds : colors.fg;
  return (
    <Press accessibilityRole="button" onPress={onPress} style={[styles.chip, { backgroundColor: bg }]}>
      {icon && <Icon name={icon} size={15} color={fg} />}
      <Text style={[type.chip, { color: fg }]}>{label}</Text>
      {diff && (
        <Text style={[type.chip, { fontWeight: '400', fontVariant: ['tabular-nums'] }]}>
          <Text style={{ color: colors.fg2 }}>+{diff[0]}</Text> <Text style={{ color: colors.fg3 }}>−{diff[1]}</Text>
        </Text>
      )}
    </Press>
  );
}

export function MoChipRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

const styles = StyleSheet.create({
  round: { borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  chip: { height: phone.chipH, paddingHorizontal: 14, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 7 },
  chipRow: { flexDirection: 'row', gap: 8 },
});
