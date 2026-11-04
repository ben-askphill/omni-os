import { Image, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';

import { Icon } from './Icon';
import { Press } from './Press';
import { StatusGlyph } from './StatusGlyph';
import { mono, phone, type, useOmniTheme } from './theme';

/**
 * An artifact in the thread: a white peek of the page on its surface card, the file name in mono, maximize to open
 * full screen. image = a snapshot of the page (or render a WebView there); without one the peek shows the name on surface-2.
 */
export function MoArtifactCard({ name, sub, image, live = false, onPress }: { name: string; sub?: string; image?: ImageSourcePropType; live?: boolean; onPress?: () => void }) {
  const { colors, shadow } = useOmniTheme();
  return (
    <Press accessibilityRole="button" accessibilityLabel={`Open ${name}`} onPress={onPress} style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={[styles.peek, { backgroundColor: colors.elev, boxShadow: shadow.card }]}>
        {image ? <Image source={image} style={StyleSheet.absoluteFill} resizeMode="cover" /> : (
          <View style={[StyleSheet.absoluteFill, styles.empty, { backgroundColor: colors.surface2 }]}>
            <Text style={[type.code, { fontSize: 11, color: colors.fg3 }]}>{name}</Text>
          </View>
        )}
        {live && <View style={styles.live}><StatusGlyph state="running" size={8} /></View>}
      </View>
      <View style={styles.foot}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={1} style={[type.code, { color: colors.fg, fontFamily: mono }]}>{name}</Text>
          {sub ? <Text numberOfLines={1} style={[type.meta, { color: colors.fg3 }]}>{sub}</Text> : null}
        </View>
        <Icon name="maximize" size={16} color={colors.fg3} />
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: phone.cardRadius, overflow: 'hidden' },
  peek: { height: 150, marginTop: 8, marginHorizontal: 8, borderRadius: phone.innerRadius, overflow: 'hidden' },
  empty: { alignItems: 'center', justifyContent: 'center' },
  live: { position: 'absolute', top: 8, right: 8 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, paddingHorizontal: 14, paddingBottom: 12 },
});
