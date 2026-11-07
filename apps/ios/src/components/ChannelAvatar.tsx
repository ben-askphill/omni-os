import { StyleSheet, View } from 'react-native';
import { SvgCss } from 'react-native-svg/css';
import { Text } from '../ui/Text';

import { Icon } from '../ui/Icon';
import { rounded, useOmniTheme, weight } from '../theme';
import { channelFace, letterOf, type ChannelFace } from './channel-face';
import { type Glyph, StatusDot } from './StatusDot';

/**
 * A channel as the Web UI's Avatar draws it, everywhere a channel shows: its own icon (an emoji, a design system icon
 * or an uploaded SVG) or its first letter in a soft circle, the Omni mark for the Conductor, and a thread's status glyph
 * on the corner when given.
 */
export function ChannelAvatar({ name, icon, conductor, glyph, size = 36 }: { name: string; icon?: string | null; conductor?: boolean; glyph?: Glyph | null; size?: number }) {
  const { colors } = useOmniTheme();
  return (
    <View style={{ width: size, height: size }} accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={[styles.disc, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surface2 }]}>
        <Face face={channelFace(name, icon, conductor)} name={name} size={size} color={colors.fg2} />
      </View>
      {glyph ? (
        <View style={[styles.badge, { backgroundColor: colors.bg }]}>
          <StatusDot glyph={glyph} size={8} />
        </View>
      ) : null}
    </View>
  );
}

function Face({ face, name, size, color }: { face: ChannelFace; name: string; size: number; color: string }) {
  switch (face.kind) {
    case 'conductor':
      return <OmniMark size={size * 0.56} color={color} />;
    case 'glyph':
      return <Icon name={face.name} size={Math.round(size * 0.46)} color={color} />;
    case 'emoji':
      return <Text style={{ fontSize: size * 0.48, lineHeight: size * 0.62 }}>{face.text}</Text>;
    case 'svg': {
      const box = size * 0.58;
      // Drawn by react-native-svg as native shapes: nothing in it runs, and the shared check refused anything that loads.
      return <SvgCss xml={face.markup} width={box} height={box} color={color} onError={() => {}} fallback={<Letter letter={letterOf(name)} size={size} color={color} />} />;
    }
    case 'letter':
      return <Letter letter={face.letter} size={size} color={color} />;
  }
}

function Letter({ letter, size, color }: { letter: string; size: number; color: string }) {
  return <Text style={[styles.letter, { color, fontSize: size * 0.42, lineHeight: size * 0.5 }]}>{letter}</Text>;
}

/** The static Omni mark (web: StaticMark): a heavy ring with a satellite at its top right. */
export function OmniMark({ size, color }: { size: number; color: string }) {
  const ring = size * 0.72;
  const moon = size * 0.18;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          left: (size - ring) / 2 - size * 0.03,
          top: (size - ring) / 2 + size * 0.03,
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: size * 0.15,
          borderColor: color,
        }}
      />
      <View style={{ position: 'absolute', right: size * 0.06, top: size * 0.08, width: moon, height: moon, borderRadius: moon / 2, backgroundColor: color }} />
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontFamily: rounded,
    fontWeight: weight.medium,
  },
  badge: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
