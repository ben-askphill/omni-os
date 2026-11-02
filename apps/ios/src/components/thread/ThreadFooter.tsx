import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { space } from '../../theme';

/**
 * Below the transcript. The composer goes here; with nothing to show it takes no room. It clears the home indicator
 * while the keyboard is down and gives that room up as the keyboard rises, which covers the indicator itself.
 */
export function ThreadFooter({ children }: { children?: ReactNode }) {
  const { bottom } = useSafeAreaInsets();
  const { progress } = useReanimatedKeyboardAnimation();
  const inset = useAnimatedStyle(() => ({ paddingBottom: space.s4 + bottom * (1 - progress.value) }), [bottom]);
  if (!children) return null;
  return <Animated.View style={[styles.footer, inset]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: space.s9,
    paddingTop: space.s4,
  },
});
