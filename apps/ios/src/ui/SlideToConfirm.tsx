import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, PanResponder, StyleSheet, Text, View } from 'react-native';

import { fontSize, radius, useOmniTheme } from '../theme';
import { clampSlide, slideReached } from './slide';

const THUMB = 44;
const PAD = 4;

interface SlideToConfirmProps {
  label: string;
  doneLabel: string;
  busyLabel: string;
  disabled?: boolean;
  /** Resolves true when it worked. False puts the thumb back at the start so the slide can be tried again. */
  onConfirm: () => Promise<boolean>;
}

type Phase = 'idle' | 'busy' | 'done';

/**
 * A slider for an action that cannot be taken back: the thumb has to be dragged across and let go near the end. A screen
 * reader gets a button whose Activate action does the same, since it cannot drag.
 */
export function SlideToConfirm({ label, doneLabel, busyLabel, disabled = false, onConfirm }: SlideToConfirmProps) {
  const { colors } = useOmniTheme();
  const x = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const travel = Math.max(width - THUMB - 2 * PAD, 0);

  const live = useRef({ travel, disabled, phase, onConfirm });
  live.current = { travel, disabled, phase, onConfirm };
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const slideTo = useCallback((value: number) => Animated.timing(x, { toValue: value, duration: 140, useNativeDriver: false }).start(), [x]);

  const confirm = useCallback(async () => {
    if (live.current.phase !== 'idle' || live.current.disabled) return;
    live.current.phase = 'busy';
    setPhase('busy');
    slideTo(live.current.travel);
    const ok = await live.current.onConfirm().catch(() => false);
    if (!mounted.current) return;
    live.current.phase = ok ? 'done' : 'idle';
    setPhase(ok ? 'done' : 'idle');
    if (!ok) slideTo(0);
  }, [slideTo]);

  const pan = useMemo(() => {
    const free = () => !live.current.disabled && live.current.phase === 'idle';
    return PanResponder.create({
      onStartShouldSetPanResponder: free,
      onMoveShouldSetPanResponder: free,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => x.setValue(clampSlide(g.dx, live.current.travel)),
      onPanResponderRelease: (_e, g) => {
        if (slideReached(g.dx, live.current.travel)) void confirm();
        else slideTo(0);
      },
      onPanResponderTerminate: () => slideTo(0),
    });
  }, [x, confirm, slideTo]);

  const text = phase === 'done' ? doneLabel : phase === 'busy' ? busyLabel : label;
  const inactive = disabled && phase === 'idle';
  const fill = x.interpolate({ inputRange: [0, Math.max(travel, 1)], outputRange: [THUMB + PAD, width], extrapolate: 'clamp' });

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityHint={phase === 'idle' && !disabled ? 'Double tap to confirm' : undefined}
      accessibilityState={{ disabled: inactive, busy: phase === 'busy' }}
      accessibilityActions={phase === 'idle' && !disabled ? [{ name: 'activate' }] : []}
      onAccessibilityAction={() => void confirm()}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.track, { backgroundColor: colors.surface2, opacity: inactive ? 0.4 : 1 }]}
    >
      <Animated.View pointerEvents="none" style={[styles.fill, { width: fill, backgroundColor: colors.surface3 }]} />
      <Text numberOfLines={1} style={[styles.label, { color: phase === 'idle' ? colors.fg3 : colors.fg }]}>
        {text}
      </Text>
      {phase === 'done' ? null : (
        <Animated.View {...pan.panHandlers} style={[styles.thumb, { backgroundColor: colors.fg, transform: [{ translateX: x }] }]}>
          {phase === 'busy' ? <ActivityIndicator size="small" color={colors.onInk} /> : <Text style={[styles.arrow, { color: colors.onInk }]}>→</Text>}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: THUMB + 2 * PAD,
    borderRadius: radius.pill,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius.pill,
  },
  label: {
    textAlign: 'center',
    fontSize: fontSize.body,
    fontWeight: '500',
    paddingHorizontal: THUMB + PAD * 3,
  },
  thumb: {
    position: 'absolute',
    left: PAD,
    top: PAD,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
  },
});
