// Phone web's Inbox rows (apps/web/src/mobile/InboxRows.tsx) on the Activity tab: a thread with its status, a Done row,
// a shelf's header and Show more. A row's actions sit over its right end as siblings of the row, so tapping one never
// opens the thread. A job's tree hangs under its row (ThreadTree.tsx).
import { Pressable, StyleSheet, View } from 'react-native';

import { useAgents } from '../../live/react';
import type { DoneRow, InboxRow } from '../../live/activity-model';
import { tallyLabel } from '../../live/thread-tree';
import { fontSize, minTarget, radius, space, useOmniTheme, weight } from '../../theme';
import { Icon, type IconName } from '../../ui/Icon';
import { Text } from '../../ui/Text';
import { crewRoleName } from '@omni/shared/crew-role.ts';
import { MarkLine } from '../MarkLine';
import { StatusDot } from '../StatusDot';
import { ROW_AVATAR, ThreadAvatar } from '../ThreadAvatar';
import { AgentsRow, TreeRows, TreeToggle, TreeToggleSpace } from './ThreadTree';

export interface RowAction {
  icon: IconName;
  label: string;
  run: () => void;
}

/** The row's own inset, its second line (where the tree toggle sits) and the padding under that line. */
const ROW_PAD = space.s2;
const META_LINE = Math.round(fontSize.small * 1.35);
const BODY_PAD = space.s5;
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

/** What a job's row needs for its tree: whether it shows open, its toggle, and what its rows read. */
export interface RowTree {
  open: boolean;
  onToggle: () => void;
  channelName: (id: string) => string;
  now: number;
  onOpenThread: (threadId: string) => void;
}

/**
 * A thread as phone web's MoInboxRow draws it: its agent's avatar (else its channel's), the title with the status (or
 * the time) and the status dot at its far end, then the channel and branch. A job has its tally at the end of that
 * line, a button laid over the row, and its tree under it. A row on the Working shelf lists its running sub-agents
 * there too.
 */
export function InboxRowView({ row, last, actions, onPress, tree }: { row: InboxRow; last: boolean; actions: RowAction[]; onPress: () => void; tree: RowTree }) {
  const { colors } = useOmniTheme();
  const agents = useAgents();
  const where = [`#${row.channel}`, row.owner && `for ${row.owner}`, row.branch].filter(Boolean).join(' · ');
  const right = row.status ? row.status.label : row.time;
  const reserve = actionsWidth(actions.length);
  const own = row.agents?.get(row.id) ?? 0;
  const under = !!row.tree || own > 0;
  const rule = { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line };
  return (
    <View>
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[row.title, row.agent && crewRoleName(row.agent, agents), row.pinned ? 'pinned' : null, row.markLine, row.step, where, right, row.tree ? tallyLabel(row.tree.tally) : null].filter(Boolean).join(', ')}
          onPress={onPress}
          style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.wash : colors.bg }]}
        >
          <ThreadAvatar agent={row.agent} eyes={row.eyes} channelId={row.channelId} channel={row.channel} />
          <View style={[styles.body, { paddingRight: reserve }, !last && !under && rule]}>
            <View style={styles.line}>
              <Text numberOfLines={1} style={[styles.title, { color: row.receded ? colors.fg3 : colors.fg }]}>
                {row.title}
              </Text>
              <Text style={[styles.right, { color: colors.fg3 }]}>{right}</Text>
              <StatusDot glyph={row.glyph} size={8} />
            </View>
            {/* A group thread at work says who: "Builder asks you · Designer working" (ADR 0019). */}
            {row.markLine ? <MarkLine faces={row.faces} text={row.markLine} /> : null}
            {row.step ? (
              <Text numberOfLines={1} style={[styles.meta, { color: colors.fg2 }]}>
                {row.step}
              </Text>
            ) : null}
            <View style={styles.line}>
              {row.pinned ? <Icon name="pin" size={11} color={colors.fg3} /> : null}
              <Text numberOfLines={1} style={[styles.meta, { color: colors.fg3 }]}>
                {where}
              </Text>
              {row.tree ? <TreeToggleSpace tree={row.tree} open={tree.open} line={META_LINE} /> : null}
            </View>
          </View>
        </Pressable>
        {row.tree ? (
          // Over its spacer: the row's own padding, then the actions' room. Its band starts under the title line.
          <View style={[styles.toggle, { right: ROW_PAD + reserve }]} pointerEvents="box-none">
            <TreeToggle tree={row.tree} open={tree.open} title={row.title} onToggle={tree.onToggle} line={META_LINE} below={BODY_PAD} />
          </View>
        ) : null}
        <RowActions actions={actions} />
      </View>
      {under ? (
        <View style={[styles.tree, !last && rule]}>
          {own > 0 ? <AgentsRow count={own} onPress={onPress} /> : null}
          {row.tree ? (
            <TreeRows
              tree={row.tree}
              open={tree.open}
              onToggle={tree.onToggle}
              agents={row.agents}
              channelName={tree.channelName}
              now={tree.now}
              onOpen={tree.onOpenThread}
            />
          ) : null}
        </View>
      ) : null}
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
    paddingHorizontal: ROW_PAD,
    borderRadius: radius.xs,
  },
  body: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
    gap: space.s1,
    paddingVertical: BODY_PAD,
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
    lineHeight: META_LINE,
  },
  toggle: {
    position: 'absolute',
    bottom: 0,
    flexDirection: 'row',
  },
  tree: {
    marginLeft: ROW_PAD + ROW_AVATAR / 2,
    paddingBottom: space.s3,
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
    width: ROW_AVATAR,
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
