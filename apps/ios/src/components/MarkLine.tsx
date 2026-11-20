import type { AvatarMark } from '@omni/shared/members.ts';
import { StyleSheet, View } from 'react-native';

import { fontSize, lineHeight, space, useOmniTheme, weight } from '../theme';
import { Text } from '../ui/Text';
import { AgentAvatar } from './AgentAvatar';

/**
 * A group thread's second line while its agents ask or work (ADR 0019, Q35), as phone web's MarkLine draws it: the
 * faces (the one asking first in the Needs you ring, then the working ones, two at most, else one and a count), a red
 * dot when one failed beside them, then "Builder asks you · Designer working".
 */
export function MarkLine({ faces, text, size = 14 }: { faces: AvatarMark | null; text: string; size?: number }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.line} accessible accessibilityLabel={text}>
      {faces ? (
        <View style={styles.faces}>
          {faces.faces.map((f, i) => (
            <View key={f.agent} style={i > 0 && styles.overlap}>
              <AgentAvatar agent={f.agent} size={size} ring={f.ring} />
            </View>
          ))}
          {faces.more ? <Text style={[styles.more, { color: colors.fg3 }]}>{`+${faces.more}`}</Text> : null}
          {faces.failed ? <View style={[styles.dot, { backgroundColor: colors.needs }]} /> : null}
        </View>
      ) : null}
      <Text numberOfLines={1} style={[styles.text, { color: colors.fg2 }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.s3, minWidth: 0 },
  faces: { flexDirection: 'row', alignItems: 'center', gap: space.s1 },
  overlap: { marginLeft: -4 },
  more: { fontSize: fontSize.meta, fontWeight: weight.medium },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { flexShrink: 1, fontSize: fontSize.small, lineHeight: Math.round(fontSize.small * lineHeight.body) },
});
