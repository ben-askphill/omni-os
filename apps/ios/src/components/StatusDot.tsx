import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { motion, useOmniTheme } from '../theme';
import type { Glyph } from './glyph';

export { glyphFor, type Glyph } from './glyph';

export function StatusDot({ glyph, size: asked = 8 }: { glyph: Glyph; size?: number }) {
  const { colors } = useOmniTheme();
  // The needs diamond and the failed cross lose their shape below 8pt (web: StatusDot).
  const size = glyph === 'needs' || glyph === 'failed' ? Math.max(asked, 8) : asked;
  const box = { width: size, height: size };
  switch (glyph) {
    case 'running':
      return (
        <View style={box}>
          <Ping size={size} color={colors.live} />
          <View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: colors.live }]} />
        </View>
      );
    case 'needs':
      return (
        <View style={box}>
          <View style={[StyleSheet.absoluteFill, { borderRadius: 1.5, backgroundColor: colors.needs, transform: [{ rotate: '45deg' }, { scale: 0.86 }] }]} />
        </View>
      );
    case 'failed': {
      const bar = { position: 'absolute' as const, left: -size * 0.1, top: size / 2 - 1, width: size * 1.2, height: 2, borderRadius: 1, backgroundColor: colors.needs };
      return (
        <View style={box}>
          <View style={[bar, { transform: [{ rotate: '45deg' }] }]} />
          <View style={[bar, { transform: [{ rotate: '-45deg' }] }]} />
        </View>
      );
    }
    case 'limited':
      return <View style={[box, { borderRadius: size / 2, borderWidth: 2, borderColor: colors.warn }]} />;
    case 'done':
      return <View style={[box, { borderRadius: size / 2, backgroundColor: colors.done, borderWidth: 1.5, borderColor: colors.doneEdge }]} />;
    case 'settled':
      return <View style={[box, { borderRadius: size / 2, backgroundColor: colors.fg4 }]} />;
    case 'idle':
    case 'queued':
      return <View style={[box, { borderRadius: size / 2, borderWidth: 1.5, borderColor: colors.fg4 }]} />;
  }
}

/** The ring that spreads from a running dot (web: omni-ping). Still under Reduce Motion. */
function Ping({ size, color }: { size: number; color: string }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    t.value = withRepeat(withTiming(1, { duration: motion.ping, easing: Easing.out(Easing.cubic) }), -1, false);
  }, [reduced, t]);
  const style = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - t.value), transform: [{ scale: 1 + 1.4 * t.value }] }));
  if (reduced) return null;
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: color }, style]} />;
}
