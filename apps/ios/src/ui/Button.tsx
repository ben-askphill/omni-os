import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { Text } from './Text';

import { fontSize, minTarget, radius, space, useOmniTheme, weight } from '../theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  busy?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
  accessibilityHint,
}: ButtonProps) {
  const { colors } = useOmniTheme();
  const inactive = disabled || busy;
  const primary = variant === 'primary';
  const labelColor = primary ? colors.onInk : colors.fg;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: primary ? colors.fg : colors.surface2 },
        { opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: minTarget,
    borderRadius: radius.pill,
    paddingHorizontal: space.s9,
    paddingVertical: space.s6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: fontSize.input,
    fontWeight: weight.semibold,
  },
});
