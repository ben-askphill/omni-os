import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { motion } from './theme';

const APressable = Animated.createAnimatedComponent(Pressable);

/** Every Omni press: scale to .96 with the settle spring, back on release. */
export function Press({ style, children, onPressIn, onPressOut, ...rest }: Omit<PressableProps, 'style' | 'children'> & { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const scale = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <APressable
      {...rest}
      onPressIn={(e) => { scale.value = withSpring(motion.pressScale, motion.settle); onPressIn?.(e); }}
      onPressOut={(e) => { scale.value = withSpring(1, motion.settle); onPressOut?.(e); }}
      style={[style, a]}
    >
      {children}
    </APressable>
  );
}
