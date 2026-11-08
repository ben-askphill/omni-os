import type { ThreadStatus } from '@omni/client-core';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { fontSize, useOmniTheme, weight } from '../../theme';
import { Icon } from '../../ui/Icon';
import { Text } from '../../ui/Text';
import { glyphFor, StatusDot } from '../StatusDot';

/** Room the back button and the menu button take on either side of the bar, as the design draws them (73 and 79). */
const SIDES = 73 + 79;

interface ThreadTitleProps {
  title: string;
  status: ThreadStatus | undefined;
  statusLabel: string;
  channel: string | null;
  device: string | null;
  /** Opens the Runs on page. Without it the machine name is plain text: there is nothing to pick. */
  onOpenMachine?: () => void;
}

/**
 * The open thread's navigation bar title, left-aligned: the title on one line, and under it the status dot and word,
 * the channel and the machine the thread runs on. They replace the status and chips rows under the bar.
 */
export function ThreadTitle({ title, status, statusLabel, channel, device, onOpenMachine }: ThreadTitleProps) {
  const { colors } = useOmniTheme();
  const { width } = useWindowDimensions();
  const live = status === 'running';
  const sep = (
    <Text accessibilityElementsHidden style={[styles.sub, { color: colors.fg4 }]}>
      ·
    </Text>
  );
  return (
    <View style={[styles.box, { width: Math.max(0, width - SIDES) }]}>
      <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: colors.fg }]}>
        {title}
      </Text>
      <View style={styles.row}>
        {statusLabel ? (
          <>
            <StatusDot glyph={glyphFor(status)} size={6} />
            <Text style={[styles.sub, { color: live ? colors.live : colors.fg2 }]}>{statusLabel}</Text>
          </>
        ) : null}
        {statusLabel && channel ? sep : null}
        {channel ? (
          <Text numberOfLines={1} style={[styles.sub, styles.channel, { color: colors.fg3 }]}>
            #{channel}
          </Text>
        ) : null}
        {(statusLabel || channel) && device ? sep : null}
        {device ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Runs on ${device}`}
            accessibilityHint={onOpenMachine ? 'Opens the list of machines' : undefined}
            disabled={!onOpenMachine}
            hitSlop={{ top: 12, bottom: 12, left: 4, right: 8 }}
            onPress={onOpenMachine}
            style={({ pressed }) => [styles.device, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Icon name="machine" size={12} strokeWidth={2} color={colors.fg3} />
            <Text numberOfLines={1} style={[styles.sub, { color: colors.fg3 }]}>
              {device}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: 2,
  },
  title: {
    fontSize: fontSize.heading,
    lineHeight: 22,
    fontWeight: weight.medium,
  },
  row: {
    height: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 0,
  },
  sub: {
    fontSize: fontSize.caption,
    lineHeight: 16,
    fontWeight: weight.regular,
  },
  channel: {
    flexShrink: 1,
  },
  device: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexShrink: 0,
  },
});
