import { StyleSheet, View } from 'react-native';

import { useOmniTheme } from '../theme';
import type { CheckTone } from './model';

export function CheckDot({ tone }: { tone: CheckTone }) {
  const { colors } = useOmniTheme();
  const look =
    tone === 'done'
      ? { backgroundColor: colors.done, borderColor: colors.lineStrong, borderWidth: StyleSheet.hairlineWidth }
      : tone === 'needs'
        ? { backgroundColor: colors.needs }
        : { borderColor: colors.live, borderWidth: 2 };
  return <View accessibilityElementsHidden importantForAccessibility="no" style={[styles.dot, look]} />;
}

const styles = StyleSheet.create({
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
