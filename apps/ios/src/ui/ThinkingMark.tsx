import { MARK_TRANSFORM } from '@omni/shared/brand.ts';
import { easeWeights, MARK_DROPLETS, MARK_R, MARK_START, MARK_TARGETS, MARK_W, markFrame } from '@omni/shared/mark.ts';
import Animated, { useAnimatedProps, useFrameCallback, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { OmniMark } from '../components/ChannelAvatar';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const RING = `M${MARK_R} 0A${MARK_R} ${MARK_R} 0 1 1 ${-MARK_R} 0A${MARK_R} ${MARK_R} 0 1 1 ${MARK_R} 0Z`;

/**
 * The Omni mark thinking, as the web's OmniMark with state "thinking" (apps/web/src/components/brand.tsx): it starts
 * as the idle mark and eases into a rippling ring while the satellite drains away. The frames come from
 * @omni/shared/mark.ts on the UI thread. No pointer to lean toward on a phone. Reduce Motion draws the still mark.
 */
export function ThinkingMark({ size, color }: { size: number; color: string }) {
  const reduced = useReducedMotion();
  const frame = useSharedValue({ d: RING, sx: 49.5, sy: -49.5, sr: 12 });
  const weights = useSharedValue({ ...MARK_START });
  useFrameCallback((info) => {
    'worklet';
    const dt = Math.min(0.05, (info.timeSincePreviousFrame ?? 0) / 1000);
    const w = { ...weights.value };
    easeWeights(w, MARK_TARGETS.thinking, dt);
    weights.value = w;
    const f = markFrame(info.timeSinceFirstFrame / 1000, w, 0, -2.4, MARK_DROPLETS);
    const sat = w.sat > 0.001 ? f.drops[0] : null;
    frame.value = { d: f.d, sx: sat ? sat.x : 0, sy: sat ? sat.y : 0, sr: sat && sat.r > 0.2 ? sat.r : 0 };
  }, !reduced);
  const ring = useAnimatedProps(() => ({ d: frame.value.d }));
  const satellite = useAnimatedProps(() => ({ cx: frame.value.sx, cy: frame.value.sy, r: frame.value.sr }));
  if (reduced) return <OmniMark size={size} color={color} />;
  return (
    <Svg width={size} height={size} viewBox="-64 -64 128 128" accessible={false}>
      <G transform={MARK_TRANSFORM}>
        <AnimatedPath animatedProps={ring} fill="none" stroke={color} strokeWidth={MARK_W} strokeLinejoin="round" />
        <AnimatedCircle animatedProps={satellite} fill={color} />
      </G>
    </Svg>
  );
}
