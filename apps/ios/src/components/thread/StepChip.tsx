import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import type { StepChip as Chip } from '../../pr/step';
import { chipHeight, chipSlop, fontSize, radius, space, useOmniTheme, weight } from '../../theme';
import { tap } from '../../ui/haptics';
import { Icon } from '../../ui/Icon';
import { Text } from '../../ui/Text';

/**
 * The branch step over the composer: "Opening PR" with a spinner while the agent works on it, or a step to press (Open
 * PR when the agent just asked whether to open one, or a step that was parked before the agent got it).
 */
export function StepChip({ chip, onAsk }: { chip: Chip; onAsk: (prompt: string) => void }) {
  const { colors } = useOmniTheme();
  if (!chip) return null;
  if (chip.kind === 'working') {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={chip.label} accessibilityState={{ disabled: true, busy: true }} disabled style={[styles.chip, { backgroundColor: colors.surface2 }]}>
        <ActivityIndicator size="small" color={colors.fg3} />
        <Text style={[styles.label, { color: colors.fg2 }]}>{chip.label}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={chip.label}
      accessibilityHint={chip.hint}
      hitSlop={chipSlop}
      onPress={() => {
        tap();
        onAsk(chip.prompt);
      }}
      style={({ pressed }) => [styles.chip, styles.ask, { backgroundColor: pressed ? colors.surface3 : colors.surface2, borderColor: colors.lineStrong }]}
    >
      <Icon name="pr" size={13} color={colors.fg2} />
      <Text style={[styles.label, { color: colors.fg }]}>{chip.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: chipHeight,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
    borderRadius: radius.pill,
    paddingHorizontal: space.s6,
  },
  ask: {
    borderWidth: 1,
  },
  label: {
    fontSize: fontSize.caption,
    fontWeight: weight.semibold,
  },
});
