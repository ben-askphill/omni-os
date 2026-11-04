import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { motion, useOmniTheme } from './theme';

export type StatusState = 'running' | 'needs' | 'done' | 'settled' | 'idle' | 'queued' | 'failed' | 'stopped';

const norm = (s: StatusState) => (s === 'failed' ? 'needs' : s === 'stopped' ? 'settled' : s);

/**
 * The only place the three pops appear. running: ultramarine disc with a ping · needs: still vermilion diamond ·
 * done: volt disc with an ink edge in light · settled: grey dot · idle and queued: hollow ring.
 */
export function StatusGlyph({ state = 'settled', size = 8 }: { state?: StatusState; size?: number }) {
  const { colors } = useOmniTheme();
  const s = norm(state);
  const box = { width: size, height: size };
  if (s === 'needs') {
    return <View style={box}><View style={[StyleSheet.absoluteFill, { borderRadius: 1.5, backgroundColor: colors.needs, transform: [{ rotate: '45deg' }, { scale: 0.86 }] }]} /></View>;
  }
  if (s === 'running') return <Ping size={size} color={colors.live} />;
  const fill = s === 'done' ? { backgroundColor: colors.done, borderWidth: 1, borderColor: colors.doneEdge }
    : s === 'settled' ? { backgroundColor: colors.fg4 }
    : { borderWidth: 1.5, borderColor: colors.fg4 };
  return <View style={[box, { borderRadius: size / 2 }, fill]} />;
}

function Ping({ size, color }: { size: number; color: string }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    p.value = withRepeat(withTiming(1, { duration: motion.duration.ping, easing: Easing.bezier(...motion.bezier.out) }), -1, false);
  }, [p, reduce]);
  const ring = useAnimatedStyle(() => ({
    opacity: p.value < 0.8 ? 0.55 * (1 - p.value / 0.8) : 0,
    transform: [{ scale: 1 + 1.6 * Math.min(p.value / 0.8, 1) }],
  }));
  const dot = { width: size, height: size, borderRadius: size / 2, backgroundColor: color };
  return (
    <View style={{ width: size, height: size }}>
      {!reduce && <Animated.View style={[StyleSheet.absoluteFill, dot, ring]} />}
      <View style={[StyleSheet.absoluteFill, dot]} />
    </View>
  );
}
