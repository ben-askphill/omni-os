import { CommonActions } from '@react-navigation/native';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOmniTheme } from '../theme';
import { tap } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { navigationRef } from './ref';
import { newButtonFrame } from './tabs-model';

// web: --shadow-menu, light and dark.
const SHADOW = {
  light: '0 0 0 0.5px rgba(23, 24, 26, 0.08), 0 2px 4px rgba(23, 24, 26, 0.04), 0 18px 44px -10px rgba(23, 24, 26, 0.2)',
  dark: '0 0 0 0.5px rgba(255, 255, 255, 0.08), 0 2px 4px rgba(0, 0, 0, 0.3), 0 18px 44px -10px rgba(0, 0, 0, 0.65)',
} as const;

// web: mo-fade on the way in. Reanimated skips both under Reduce Motion.
const entering = FadeIn.duration(220).reduceMotion(ReduceMotion.System);
const exiting = FadeOut.duration(120).reduceMotion(ReduceMotion.System);

/**
 * Phone web's floating + beside the tab bar, on every tab root. It opens New thread on the tab it was tapped from, with
 * no channel picked, so the Conductor is the first choice.
 */
export function NewThreadButton({ tab }: { tab: string }) {
  const { scheme, colors } = useOmniTheme();
  const { size, right, bottom } = newButtonFrame(useSafeAreaInsets().bottom);
  const open = () => {
    tap();
    navigationRef.dispatch(CommonActions.navigate({ name: tab, params: { screen: 'NewThread' } }));
  };
  return (
    <Animated.View entering={entering} exiting={exiting} style={[styles.dock, { right, bottom }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New thread"
        onPress={open}
        style={({ pressed }) => [
          styles.disc,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.fg, boxShadow: SHADOW[scheme] },
          pressed && styles.pressed,
        ]}
      >
        <Icon name="plus" size={20} weight="semibold" color={colors.onInk} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
  },
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // web: mo-press
  pressed: {
    transform: [{ scale: 0.96 }],
  },
});
