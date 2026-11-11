// Phone web's Inbox rows (apps/web/src/mobile/InboxRows.tsx) on the Activity tab: a thread with its status, a Done row,
// a shelf's header and Show more. A row's actions sit over its right end as siblings of the row, so tapping one never
// opens the thread.
import { delegateLabel, type DelegateSummary } from '@omni/shared/delegate-count.ts';
import { Pressable, StyleSheet, View } from 'react-native';

import { useChannels } from '../../live/react';
import type { DoneRow, InboxRow } from '../../live/activity-model';
import { fontSize, minTarget, radius, space, useOmniTheme, weight } from '../../theme';
import { Icon, type IconName } from '../../ui/Icon';
import { Text } from '../../ui/Text';
import { ChannelAvatar } from '../ChannelAvatar';
import { StatusDot } from '../StatusDot';

export interface RowAction {
  icon: IconName;
  label: string;
  run: () => void;
}

const AVATAR = 36;
const ACTION = 36;
const ACTION_GAP = space.s2;
/** What a row's text leaves free at its end for the actions, so the title truncates before them. */
const actionsWidth = (n: number) => (n ? n * ACTION + (n - 1) * ACTION_GAP : 0);

/** Quiet round buttons over the row's right end. Each is 36pt drawn and 44pt to the touch. */
function RowActions({ actions }: { actions: RowAction[] }) {
  const { colors } = useOmniTheme();
  if (!actions.length) return null;
  return (
    <View style={styles.actions} pointerEvents="box-none">
      {actions.map((a) => (
        <Pressable
          key={a.icon}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          hitSlop={(minTarget - ACTION) / 2}
          onPress={a.run}
          style={({ pressed }) => [styles.action, { backgroundColor: pressed ? colors.wash : 'transparent' }]}
        >
          <Icon name={a.icon} size={17} color={colors.fg3} />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * A thread as phone web's MoInboxRow draws it: the channel's avatar with the status on its corner, the title with the
 * status (or the time) on its right, then the channel, branch and delegate count.
 */
export function InboxRowView({ row, last, actions, onPress }: { row: InboxRow; last: boolean; actions: RowAction[]; onPress: () => void }) {
  const { colors } = useOmniTheme();
  const { channels } = useChannels();
  const home = channels?.find((c) => c.id === row.channelId);
  const where = [`#${row.channel}`, row.branch].filter(Boolean).join(' · ');
  const right = row.status ? row.status.label : row.time;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[row.title, row.pinned ? 'pinned' : null, where, right, row.delegates ? delegateLabel(row.delegates) : null].filter(Boolean).join(', ')}
        onPress={onPress}
        style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.wash : colors.bg }]}
      >
        <ChannelAvatar name={home?.name ?? row.channel} icon={home?.icon} avatarBg={home?.avatar_bg} conductor={row.channelId === 'conductor'} glyph={row.glyph} size={AVATAR} />
        <View style={[styles.body, { paddingRight: actionsWidth(actions.length) }, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }]}>
          <View style={styles.line}>
            <Text numberOfLines={1} style={[styles.title, { color: row.receded ? colors.fg3 : colors.fg }]}>
              {row.title}
            </Text>
            <Text style={[styles.right, { color: colors.fg3 }]}>{right}</Text>
          </View>
          <View style={styles.line}>
            {row.pinned ? <Icon name="pin" size={11} color={colors.fg3} /> : null}
            <Text numberOfLines={1} style={[styles.meta, { color: colors.fg3 }]}>
              {where}
            </Text>
            {row.delegates ? <DelegateCount summary={row.delegates} /> : null}
          </View>
        </View>
      </Pressable>
      <RowActions actions={actions} />
    </View>
  );
}

/** The Conductor thread's delegated threads as one count: the diamond while one waits on Ben or failed (web: DelegateCount). */
function DelegateCount({ summary }: { summary: DelegateSummary }) {
  const { colors } = useOmniTheme();
  const flagged = summary.state === 'needs' || summary.state === 'failed';
  const tone = { needs: colors.fg, failed: colors.fg3, working: colors.live, settled: colors.fg4 }[summary.state];
  return (
    <View style={styles.delegates}>
      {flagged ? <StatusDot glyph="needs" size={7} /> : null}
      <Icon name="delegate" size={12} color={tone} />
      <Text style={[styles.count, { color: tone }]}>{summary.total}</Text>
    </View>
  );
}

/** A Done row: the check, the title and when it was marked done, with an undo. */
export function DoneRowView({ row, last, undo, onPress }: { row: DoneRow; last: boolean; undo: RowAction; onPress: () => void }) {
  const { colors } = useOmniTheme();
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.title}, marked done, ${row.time}`}
        onPress={onPress}
        style={({ pressed }) => [styles.row, styles.doneRow, { backgroundColor: pressed ? colors.wash : colors.bg }]}
      >
        <View style={styles.gutter}>
          <Icon name="check" size={13} color={colors.fg4} />
        </View>
        <View style={[styles.body, styles.doneBody, { paddingRight: actionsWidth(1) }, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }]}>
          <Text numberOfLines={1} style={[styles.doneTitle, { color: colors.fg3 }]}>
            {row.title}
          </Text>
          <Text style={[styles.right, { color: colors.fg3 }]}>{row.time}</Text>
        </View>
      </Pressable>
      <RowActions actions={[undo]} />
    </View>
  );
}

/** A shelf's header: its name, how many it holds, and a chevron that turns as it folds. */
export function ShelfHeader({ label, count, open, onToggle }: { label: string; count: number; open: boolean; onToggle: () => void }) {
  const { colors } = useOmniTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${count}`}
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={({ pressed }) => [styles.shelf, { backgroundColor: pressed ? colors.wash : colors.bg }]}
    >
      <Text style={[styles.shelfLabel, { color: colors.fg3 }]}>{label}</Text>
      <Text style={[styles.shelfCount, { color: colors.fg4 }]}>{count}</Text>
      <View style={[styles.chevron, { transform: [{ rotate: open ? '0deg' : '-90deg' }] }]}>
        <Icon name="chevronDown" size={12} color={colors.fg4} />
      </View>
    </Pressable>
  );
}

/** Under an open Done shelf that holds more than it lists. */
export function ShowMore({ count, onPress }: { count: number; onPress: () => void }) {
  const { colors } = useOmniTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, styles.doneRow, { backgroundColor: pressed ? colors.wash : colors.bg }]}>
      <View style={styles.gutter}>
        <Icon name="chevronDown" size={12} color={colors.fg3} />
      </View>
      <Text style={[styles.more, { color: colors.fg3 }]}>{`Show ${count} more`}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
    paddingHorizontal: space.s2,
    borderRadius: radius.xs,
  },
  body: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
    gap: space.s1,
    paddingVertical: space.s5,
    minHeight: minTarget + space.s6,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
  },
  title: {
    flex: 1,
    fontSize: fontSize.subhead,
    lineHeight: Math.round(fontSize.subhead * 1.3),
  },
  right: {
    fontSize: fontSize.caption,
    fontVariant: ['tabular-nums'],
  },
  meta: {
    flex: 1,
    fontSize: fontSize.small,
    lineHeight: Math.round(fontSize.small * 1.35),
  },
  delegates: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  count: {
    fontSize: fontSize.small,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: ACTION_GAP,
  },
  action: {
    width: ACTION,
    height: ACTION,
    borderRadius: ACTION / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneRow: {
    minHeight: minTarget,
  },
  gutter: {
    width: AVATAR,
    alignItems: 'center',
  },
  doneBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
    minHeight: minTarget,
    paddingVertical: space.s3,
  },
  doneTitle: {
    flex: 1,
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * 1.3),
  },
  shelf: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    paddingHorizontal: space.s2,
    borderRadius: radius.xs,
  },
  shelfLabel: {
    fontSize: fontSize.caption,
    fontWeight: weight.medium,
  },
  shelfCount: {
    fontSize: fontSize.caption,
    fontVariant: ['tabular-nums'],
  },
  chevron: {
    marginLeft: 'auto',
  },
  more: {
    fontSize: fontSize.ui,
  },
});
