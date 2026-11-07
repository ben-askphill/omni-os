import { Pressable, StyleSheet } from 'react-native';
import { Text } from '../ui/Text';

import { fontSize, minTarget, useOmniTheme, weight } from '../theme';
import { Icon, type IconName } from '../ui/Icon';

/**
 * A button in the navigation bar. With `icon` it draws the SF Symbol and the label is read aloud instead, as phone web's
 * round icon buttons are; without it, the label is the button (Cancel, Start).
 */
export function HeaderButton({
  label,
  icon,
  onPress,
  accessibilityLabel,
  disabled = false,
}: {
  label: string;
  icon?: IconName;
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
      style={[styles.button, icon && styles.square, { opacity: disabled ? 0.4 : 1 }]}
    >
      {icon ? <Icon name={icon} size={19} color={colors.fg} /> : <Text style={[styles.label, { color: colors.fg }]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: minTarget,
    justifyContent: 'center',
  },
  square: {
    minWidth: minTarget - 8,
    alignItems: 'center',
  },
  label: {
    fontSize: fontSize.input,
    fontWeight: weight.medium,
  },
});
