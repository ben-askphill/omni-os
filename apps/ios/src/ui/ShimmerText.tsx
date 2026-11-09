import { SHIMMER_EASING, SHIMMER_MS, SHIMMER_SIZE, shimmerStops, shimmerX } from '@omni/shared/shimmer.ts';
import { useEffect, useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { ClipPath, Defs, G, LinearGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { tracking, useOmniTheme, weight } from '../theme';
import { breakable, ELLIPSIS, fitLabel, type MeasuredLine } from './shimmer-fit';
import { Text } from './Text';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

/** Slack past the measured width, so a glyph that SVG lays out a hair wider than React Native is not cut. */
const SLACK = 2;

interface Box {
  width: number;
  height: number;
  /** From the line's top, as React Native lays the label out. */
  baseline: number;
}

/**
 * One line of muted text with a vermilion highlight sweeping across it: the web's `.shimmer-text`
 * (apps/web/src/index.css), from the shared spec in @omni/shared/shimmer.ts. The web clips a moving gradient to the
 * glyphs with `background-clip: text`; here the glyphs are SVG text clipping a gradient rectangle that slides under
 * them, tiled as CSS repeats a background. A transparent copy of the label sizes the line and carries it for VoiceOver. Reduce Motion draws the label
 * still, in fg3, as the web does.
 */
export function ShimmerText({ label, size }: { label: string; size: number }) {
  const { colors } = useOmniTheme();
  const reduced = useReducedMotion();
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const [baseline, setBaseline] = useState<number | null>(null);
  const [fit, setFit] = useState<{ label: string; room: number; text: string } | null>(null);
  const font = { fontSize: size };

  if (reduced) {
    return (
      <Text numberOfLines={1} style={[styles.shrink, font, { color: colors.fg3 }]}>
        {label}
      </Text>
    );
  }
  const box: Box | null = area && baseline !== null ? { ...area, baseline } : null;
  const text = box && fit?.label === label && fit.room === box.width ? fit.text : null;
  return (
    <View style={styles.shrink}>
      <Text
        numberOfLines={1}
        style={[font, styles.clear]}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setArea((b) => (b && b.width === width && b.height === height ? b : { width, height }));
        }}
        onTextLayout={(e) => {
          const line = e.nativeEvent.lines[0];
          if (line) setBaseline(line.y + line.ascender);
        }}
      >
        {label}
      </Text>
      {box ? (
        // The same label with a break after every character, laid out in the room an ellipsis leaves: its first line is
        // what fits. Never drawn, never read.
        <View style={[styles.measure, { width: box.width }]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text
            style={[font, styles.grow]}
            onTextLayout={(e) => {
              const lines: MeasuredLine[] = e.nativeEvent.lines.map((l) => ({ text: l.text, width: l.width }));
              setFit({ label, room: box.width, text: fitLabel(label, lines, box.width) });
            }}
          >
            {breakable(label)}
          </Text>
          <Text style={font}>{ELLIPSIS}</Text>
        </View>
      ) : null}
      {box && text !== null ? <Sweep text={text} box={box} size={size} /> : null}
    </View>
  );
}

function Sweep({ text, box, size }: { text: string; box: Box; size: number }) {
  const { colors } = useOmniTheme();
  const id = useId().replace(/:/g, '');
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: SHIMMER_MS, easing: Easing.bezier(...SHIMMER_EASING) }), -1, false);
    return () => cancelAnimation(p);
  }, [p]);
  const width = box.width;
  // CSS repeats the background, so a tile sits either side of the one that moves: the label is never left bare at the
  // ends of a sweep, and the muted ends of neighbouring tiles meet seamlessly.
  const tile = SHIMMER_SIZE * width;
  const before = useAnimatedProps(() => ({ x: shimmerX(p.value, width) - tile }));
  const moving = useAnimatedProps(() => ({ x: shimmerX(p.value, width) }));
  const after = useAnimatedProps(() => ({ x: shimmerX(p.value, width) + tile }));
  const stops = shimmerStops({ fg3: colors.fg3, fg4: colors.fg4, vermilion: colors.needs });
  return (
    <Svg width={width + SLACK} height={box.height} style={styles.over} accessible={false} pointerEvents="none">
      <Defs>
        <LinearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="0">
          {stops.map((s) => (
            <Stop key={s.offset} offset={s.offset} stopColor={s.color} />
          ))}
        </LinearGradient>
        <ClipPath id={`c${id}`}>
          <SvgText x={0} y={box.baseline} fontSize={size} fontWeight={weight.regular} letterSpacing={tracking(size)}>
            {text}
          </SvgText>
        </ClipPath>
      </Defs>
      <G clipPath={`url(#c${id})`}>
        {[before, moving, after].map((props, i) => (
          <AnimatedRect key={i} animatedProps={props} y={0} width={tile} height={box.height} fill={`url(#g${id})`} />
        ))}
      </G>
    </Svg>
  );
}

const styles = StyleSheet.create({
  shrink: { flexShrink: 1, minWidth: 0 },
  grow: { flex: 1 },
  clear: { color: 'transparent' },
  // No bottom edge and no stretch: a row one line tall would lay the copy out in one line and never wrap it.
  measure: { position: 'absolute', left: 0, top: 0, flexDirection: 'row', alignItems: 'flex-start', opacity: 0 },
  over: { position: 'absolute', left: 0, top: 0 },
});
