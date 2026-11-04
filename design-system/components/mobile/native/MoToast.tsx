import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeOutDown, ZoomIn } from 'react-native-reanimated';

import { StatusGlyph, type StatusState } from './StatusGlyph';
import { type, useOmniTheme } from './theme';

/** Ink pill that springs up above the tab bar: what just happened, in a few words. Position it 112pt above the bottom. */
export function MoToast({ status, children }: { status?: StatusState; children: ReactNode }) {
  const { colors, shadow } = useOmniTheme();
  return (
    <Animated.View accessibilityRole="alert" entering={ZoomIn.springify().damping(14)} exiting={FadeOutDown}
      style={[styles.toast, { backgroundColor: colors.fg, boxShadow: shadow.menu }]}>
      {status && <StatusGlyph state={status} size={8} />}
      <Text style={[type.toast, { color: colors.onInk }]}>{children}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 18, borderRadius: 999 },
});
