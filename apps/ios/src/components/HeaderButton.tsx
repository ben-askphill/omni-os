import { Pressable, StyleSheet } from 'react-native';
import { Text } from '../ui/Text';

import { fontSize, minTarget, useOmniTheme, weight } from '../theme';

export function HeaderButton({
  label,
  onPress,
  accessibilityLabel,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const { colors } = useOmniTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={styles.button}
    >
      <Text style={[styles.label, { color: colors.fg, opacity: disabled ? 0.4 : 1 }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: minTarget,
    justifyContent: 'center',
  },
  label: {
    fontSize: fontSize.input,
    fontWeight: weight.medium,
  },
});
