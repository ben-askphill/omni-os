import type { ClaudeArtifact } from '@omni/shared/claude-artifacts.ts';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { fontSize, minTarget, radius, space, useOmniTheme, weight } from '../../theme';
import { Icon } from '../../ui/Icon';
import { Text } from '../../ui/Text';
import { ArtifactTypeBadge } from './ArtifactTypeBadge';
import { rowDetail, rowLabel, typeIcon } from './model';

/**
 * One claude.ai artifact: its type's drawing, title, type badge, whose it is and when it changed, and the thread that
 * published it when one did. A tap opens it on claude.ai through the system: the Claude app when it claims the link,
 * otherwise Safari, where Ben is signed in. Never an in-app browser, which has no claude.ai session.
 */
export function ClaudeArtifactRow({ artifact, now, first }: { artifact: ClaudeArtifact; now: number; first?: boolean }) {
  const { colors } = useOmniTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={rowLabel(artifact, now)}
      accessibilityHint="Opens on claude.ai"
      onPress={() => void Linking.openURL(artifact.url)}
      style={({ pressed }) => [styles.row, !first && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }, { opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={[styles.disc, { backgroundColor: colors.surface2 }]}>
        <Icon name={typeIcon(artifact.type)} size={16} color={colors.fg3} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.fg }]}>
            {artifact.title}
          </Text>
          <ArtifactTypeBadge type={artifact.type} />
        </View>
        <Text numberOfLines={1} style={[styles.meta, { color: colors.fg3 }]}>
          {rowDetail(artifact, now)}
        </Text>
      </View>
      <Icon name="arrowUpRight" size={15} color={colors.fg4} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s6, minHeight: minTarget + space.s6, paddingHorizontal: space.s7, paddingVertical: space.s5 },
  disc: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: space.s1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.s4 },
  title: { flexShrink: 1, fontSize: fontSize.body, fontWeight: weight.medium },
  meta: { fontSize: fontSize.caption },
});
