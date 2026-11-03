import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { fontSize, lineHeight, radius, space, useOmniTheme } from '../theme';

interface CalloutProps {
  message: string;
  children?: ReactNode;
}

export function Callout({ message, children }: CalloutProps) {
  const { colors } = useOmniTheme();

  return (
    <View
      accessibilityRole="alert"
      style={[styles.callout, { backgroundColor: colors.surface3, borderColor: colors.lineStrong }]}
    >
      <Text style={[styles.message, { color: colors.fg }]}>{message}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  callout: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.s8,
    gap: space.s6,
  },
  message: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
});
