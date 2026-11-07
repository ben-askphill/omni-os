import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../ui/Text';

import type { NeedsButton, NeedsRow as NeedsRowModel } from '../../live/activity-model';
import { useChannels } from '../../live/react';
import { fontSize, lineHeight, minTarget, space, useOmniTheme, weight } from '../../theme';
import { Button } from '../../ui/Button';
import { ChannelAvatar } from '../ChannelAvatar';

/**
 * A Needs you item as phone web's card heads it: where it came from, the thread, then why it is here. Tapping opens the
 * thread. The buttons under it answer on the spot (Retry, Resume, Mark done) or open the thread to Answer. One button
 * runs at a time, and a failure shows under the row.
 */
export function NeedsRow({ row, onPress, onButton }: { row: NeedsRowModel; onPress: () => void; onButton: (b: NeedsButton) => Promise<void> }) {
  const { colors } = useOmniTheme();
  const { channels } = useChannels();
  const home = channels?.find((c) => c.id === row.thread.channel_id);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const title = row.thread.title || 'Untitled';
  const press = async (b: NeedsButton) => {
    if (running) return;
    setRunning(b.key);
    setError(null);
    try {
      await onButton(b);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Something went wrong');
    } finally {
      setRunning(null);
    }
  };
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[title, row.label, row.detail, row.meta].filter(Boolean).join(', ')}
        onPress={onPress}
        style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.wash : colors.bg }]}
      >
        <ChannelAvatar name={home?.name ?? row.thread.channel_id} icon={home?.icon} conductor={row.thread.channel_id === 'conductor'} glyph={row.glyph} />
        <View style={styles.body}>
          <Text numberOfLines={1} style={[styles.meta, { color: colors.fg3 }]}>
            {row.meta}
          </Text>
          <View style={styles.top}>
            <Text numberOfLines={2} style={[styles.title, { color: colors.fg }]}>
              {title}
            </Text>
            <Text style={[styles.ago, { color: colors.fg3 }]}>{row.ago}</Text>
          </View>
          <Text numberOfLines={4} style={[styles.reason, { color: colors.fg2 }]}>
            <Text style={{ color: colors.fg, fontWeight: weight.medium }}>{row.label}</Text>
            {row.detail ? ` · ${row.detail}` : null}
          </Text>
        </View>
      </Pressable>
      {row.buttons.length > 0 ? (
        <View style={styles.buttons}>
          {row.buttons.map((b, i) => (
            <Button
              key={b.key}
              label={b.label}
              variant={i === 0 && row.glyph === 'needs' ? 'primary' : 'secondary'}
              busy={running === b.key}
              disabled={running !== null && running !== b.key}
              onPress={() => void press(b)}
            />
          ))}
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.fg }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  buttons: {
    flexDirection: 'row',
    gap: space.s4,
    paddingLeft: space.s8 + 36 + space.s6,
    paddingRight: space.s9,
    paddingBottom: space.s6,
  },
  error: {
    fontSize: fontSize.small,
    paddingLeft: space.s8 + 36 + space.s6,
    paddingRight: space.s9,
    paddingBottom: space.s4,
  },
  row: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.s6,
    paddingHorizontal: space.s8,
    paddingVertical: space.s6,
  },
  body: {
    flex: 1,
    gap: space.s2,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.s4,
  },
  title: {
    flex: 1,
    fontSize: fontSize.subhead,
    lineHeight: Math.round(fontSize.subhead * 1.3),
    fontWeight: weight.medium,
  },
  ago: {
    fontSize: fontSize.caption,
    fontVariant: ['tabular-nums'],
  },
  reason: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
  },
  meta: {
    fontSize: fontSize.caption,
  },
});
