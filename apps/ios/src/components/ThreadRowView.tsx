import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';

import type { ThreadRow } from '../live/channel-model';
import { useChannels } from '../live/react';
import { fontSize, lineHeight, minTarget, space, useOmniTheme, weight } from '../theme';
import { Icon } from '../ui/Icon';
import { ChannelAvatar } from './ChannelAvatar';
import { glyphFor } from './StatusDot';

/**
 * A thread in a list, as phone web's MoRow draws it: the channel's avatar with the thread's status on its corner, the
 * title and age, then the state on a second line. A row from several channels names its channel there first.
 */
export function ThreadRowView({ row, onPress, onLongPress }: { row: ThreadRow & { channel?: string }; onPress: () => void; onLongPress?: () => void }) {
  const { colors } = useOmniTheme();
  const { channels } = useChannels();
  const home = channels?.find((c) => c.id === row.target.channelId);
  const channel = row.channel ? `#${row.channel}` : null;
  const marked = row.target.done ? 'Marked done' : null;
  const glyph = row.target.done ? 'settled' : glyphFor(row.status);
  const settled = !row.busy && (row.target.done || row.status !== 'failed');
  const meta = [channel, marked].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[row.title, channel, row.pinned ? 'pinned' : null, marked ? 'marked done' : null, row.statusLabel, row.ago].filter(Boolean).join(', ')}
      accessibilityHint={onLongPress ? 'Swipe left for pin, done and archive. Hold for more.' : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.wash : colors.bg }]}
    >
      <ChannelAvatar name={home?.name ?? row.channel ?? row.target.channelId} icon={home?.icon} conductor={row.target.channelId === 'conductor'} glyph={glyph} />
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
        </View>
        {meta || row.statusLabel ? (
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
    paddingTop: 4,
  },
  title: {
    flex: 1,
    fontSize: fontSize.subhead,
    lineHeight: Math.round(fontSize.subhead * 1.3),
    fontWeight: weight.medium,
  },
  ago: {
    paddingTop: 2,
    fontSize: fontSize.caption,
    fontVariant: ['tabular-nums'],
  },
  meta: {
    fontSize: fontSize.small,
    lineHeight: Math.round(fontSize.small * lineHeight.body),
  },
});
