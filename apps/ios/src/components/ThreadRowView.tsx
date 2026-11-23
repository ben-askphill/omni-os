import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';

import type { ThreadRow } from '../live/channel-model';
import { useAgents } from '../live/react';
import { fontSize, lineHeight, minTarget, space, useOmniTheme, weight } from '../theme';
import { Icon } from '../ui/Icon';
import { crewRoleName } from '@omni/shared/crew-role.ts';
import { MarkLine } from './MarkLine';
import { StatusDot } from './StatusDot';
import { ThreadAvatar } from './ThreadAvatar';

/**
 * A thread in a list, as phone web's MoRow draws it: its agent's avatar (else its channel's), the title, its age and
 * the status dot at the far end, then the state on a second line. A row from several channels names its channel there
 * first.
 */
export function ThreadRowView({ row, onPress, onLongPress }: { row: ThreadRow & { channel?: string }; onPress: () => void; onLongPress?: () => void }) {
  const { colors } = useOmniTheme();
  const agents = useAgents();
  const channel = row.channel ? `#${row.channel}` : null;
  const marked = row.target.done ? 'Marked done' : null;
  const glyph = row.target.done ? 'settled' : row.glyph;
  const settled = !row.busy && (row.target.done || row.status !== 'failed');
  // The server stores no owner for the user's own threads, so any owner it names is someone else's (thread-owner.ts).
  const owner = row.owner ? `for ${row.owner}` : null;
  const meta = [channel, owner, marked].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[row.title, row.agent && crewRoleName(row.agent, agents), channel, row.pinned ? 'pinned' : null, marked ? 'marked done' : null, row.markLine ?? row.statusLabel, row.ago].filter(Boolean).join(', ')}
      accessibilityHint={onLongPress ? 'Swipe left for pin, done and archive. Hold for more.' : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.wash : colors.bg }]}
    >
      <ThreadAvatar agent={row.agent} eyes={row.eyes} channelId={row.target.channelId} channel={row.channel} />
      <View style={[styles.body, { borderBottomColor: colors.line }]}>
        <View style={styles.top}>
          <Text numberOfLines={2} style={[styles.title, { color: settled ? colors.fg2 : colors.fg }]}>
            {row.title}
          </Text>
          {row.pinned ? (
            <View style={styles.pin}>
              <Icon name="pin" size={11} color={colors.fg4} />
            </View>
          ) : null}
          <Text style={[styles.ago, { color: colors.fg3 }]}>{row.ago}</Text>
          <View style={styles.dot}>
            <StatusDot glyph={glyph} size={8} />
          </View>
        </View>
        {/* A group thread at work says who on its second line, as phone web's row does (ADR 0019). */}
        {row.markLine ? (
          <MarkLine faces={row.faces} text={row.markLine} />
        ) : meta || row.statusLabel ? (
          <Text numberOfLines={1} style={[styles.meta, { color: colors.fg3 }]}>
            {meta}
            {meta && row.statusLabel ? ' · ' : null}
            {row.statusLabel ? <Text style={row.busy ? { color: colors.live } : null}>{row.statusLabel}</Text> : null}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const TITLE_LINE = Math.round(fontSize.subhead * 1.3);

const styles = StyleSheet.create({
  row: {
    minHeight: minTarget + space.s6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
    paddingLeft: space.s8,
  },
  body: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
    gap: space.s1,
    paddingVertical: space.s5,
    paddingRight: space.s8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.s3,
  },
  pin: {
    paddingTop: space.s2,
  },
  title: {
    flex: 1,
    fontSize: fontSize.subhead,
    lineHeight: TITLE_LINE,
    fontWeight: weight.medium,
  },
  /** On the title's first line, centred on it. */
  dot: {
    height: TITLE_LINE,
    justifyContent: 'center',
  },
  ago: {
    paddingTop: space.s1,
    fontSize: fontSize.caption,
    fontVariant: ['tabular-nums'],
  },
  meta: {
    fontSize: fontSize.small,
    lineHeight: Math.round(fontSize.small * lineHeight.body),
  },
});
