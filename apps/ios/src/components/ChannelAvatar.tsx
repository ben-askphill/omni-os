import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';

import { Icon, isIconName } from '../ui/Icon';
import { rounded, useOmniTheme, weight } from '../theme';
import { type Glyph, StatusDot } from './StatusDot';

/**
 * Who works a thread, as the phone web's MoAvatar draws it: the channel's icon or first letter in a soft circle, the Omni
 * mark for the Conductor, and the thread's status glyph on the corner when given.
 */
export function ChannelAvatar({ name, icon, conductor, glyph, size = 36 }: { name: string; icon?: string | null; conductor?: boolean; glyph?: Glyph | null; size?: number }) {
  const { colors } = useOmniTheme();
  return (
    <View style={{ width: size, height: size }} accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={[styles.disc, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surface2 }]}>
        {conductor ? <OmniMark size={size * 0.56} color={colors.fg2} /> : <Face name={name} icon={icon} size={size} color={colors.fg2} />}
      </View>
      {glyph ? (
        <View style={[styles.badge, { backgroundColor: colors.bg }]}>
          <StatusDot glyph={glyph} size={8} />
        </View>
      ) : null}
    </View>
  );
}

/** A stored channel icon (`icon:<name>`, an emoji, or `svg:` markup) or the name's first letter. SVGs draw as the letter. */
function Face({ name, icon, size, color }: { name: string; icon?: string | null; size: number; color: string }) {
  const value = icon?.trim() ?? '';
  if (value.startsWith('icon:')) {
    const glyph = value.slice('icon:'.length);
    if (isIconName(glyph)) return <Icon name={glyph} size={Math.round(size * 0.46)} color={color} />;
  } else if (value && !value.startsWith('svg:')) {
    return <Text style={{ fontSize: size * 0.48, lineHeight: size * 0.62 }}>{value}</Text>;
  }
  const letter = name.replace(/[^a-z0-9]/gi, '').slice(0, 1).toUpperCase() || '?';
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
