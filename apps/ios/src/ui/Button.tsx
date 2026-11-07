import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { fontSize, minTarget, radius, space, useOmniTheme, weight } from '../theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  /** As the design system's Button: primary is ink, secondary a soft fill, ghost only its label. */
  variant?: 'primary' | 'secondary' | 'ghost';
  /** `small` for an action inside a row or a notice: a smaller label and padding, the same 44pt target. */
  size?: 'regular' | 'small';
  busy?: boolean;
  disabled?: boolean;
  /** What VoiceOver reads when the label alone is ambiguous in a list ("Revoke iPhone"). */
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

/**
 * The narrowest a filled button gets, so a short label ("Run", "Edit") still reads as a button and not a tag. A ghost
 * button has no fill to look short in and stops at the tap target.
 */
const MIN_WIDTH = { regular: 88, small: 64 } as const;

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'regular',
  busy = false,
  disabled = false,
  accessibilityLabel = label,
  accessibilityHint,
}: ButtonProps) {
  const { colors } = useOmniTheme();
  const inactive = disabled || busy;
  const labelColor = variant === 'primary' ? colors.onInk : variant === 'ghost' ? colors.fg2 : colors.fg;
  const fill = variant === 'primary' ? colors.fg : variant === 'secondary' ? colors.surface2 : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        size === 'small' ? styles.small : styles.regular,
        { minWidth: variant === 'ghost' ? minTarget : MIN_WIDTH[size] },
        { backgroundColor: variant === 'ghost' && pressed ? colors.wash : fill },
        { opacity: disabled ? 0.4 : pressed && variant !== 'ghost' ? 0.85 : 1 },
      ]}
    >
      {/* The label stays laid out under the spinner, so going busy never changes the button's width. */}
      <Text style={[styles.label, size === 'small' && styles.smallLabel, { color: labelColor, opacity: busy ? 0 : 1 }]}>{label}</Text>
      {busy ? (
        <View style={styles.spinner}>
          <ActivityIndicator color={labelColor} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: minTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  regular: {
    paddingHorizontal: space.s9,
    paddingVertical: space.s6,
  },
  small: {
    paddingHorizontal: space.s6,
    paddingVertical: space.s4,
  },
  label: {
    fontSize: fontSize.input,
    fontWeight: weight.semibold,
  },
  smallLabel: {
    fontSize: fontSize.body,
  },
  spinner: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
