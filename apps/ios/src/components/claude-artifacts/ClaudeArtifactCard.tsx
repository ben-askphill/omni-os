import type { ClaudeArtifact } from '@omni/shared/claude-artifacts.ts';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { fontSize, radius, space, useOmniTheme, weight } from '../../theme';
import { Icon } from '../../ui/Icon';
import { Text } from '../../ui/Text';
import { ArtifactTypeBadge } from './ArtifactTypeBadge';
import { cardDetail, openUrl, rowLabel, typeIcon } from './model';

/**
 * One claude.ai artifact as a grid card: its type's drawing, title, type badge, whose it is and when it changed. Opens
 * like a row. claude.ai has no preview image to show, and the iOS Library draws pages by kind rather than running
 * them, so the picture is the type's drawing (the web grid shows a thread's local copy when there is one).
 */
export function ClaudeArtifactCard({ artifact, now, width }: { artifact: ClaudeArtifact; now: number; width: number }) {
  const { colors } = useOmniTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={rowLabel(artifact, now)}
      accessibilityHint="Opens on claude.ai"
      onPress={() => void Linking.openURL(openUrl(artifact))}
      style={({ pressed }) => [styles.card, { width, backgroundColor: pressed ? colors.surface3 : colors.surface }]}
    >
      <View style={[styles.thumb, { backgroundColor: colors.surface2, borderColor: colors.line }]}>
        <Icon name={typeIcon(artifact.type)} size={26} color={colors.fg4} />
        {/* A hairline edge: in dark, elev and the tile's surface2 are nearly the same grey. */}
        <View style={[styles.open, { backgroundColor: colors.elev, borderColor: colors.line }]}>
          <Icon name="arrowUpRight" size={12} color={colors.fg3} />
        </View>
      </View>
      <View style={styles.meta}>
        <Text numberOfLines={1} style={[styles.title, { color: colors.fg }]}>
          {artifact.title}
        </Text>
        <View style={styles.badges}>
          <ArtifactTypeBadge type={artifact.type} />
        </View>
        <Text numberOfLines={1} style={[styles.detail, { color: colors.fg3 }]}>
          {cardDetail(artifact, now)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.s2 + 2, gap: space.s4 },
  thumb: { height: 96, borderRadius: radius.md - 1, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  open: { position: 'absolute', top: space.s3, right: space.s3, width: 22, height: 22, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  meta: { paddingHorizontal: space.s2 + 2, paddingBottom: space.s2 + 2, gap: space.s2 },
  title: { fontSize: fontSize.small, fontWeight: weight.medium },
  badges: { flexDirection: 'row' },
  detail: { fontSize: fontSize.caption },
});
