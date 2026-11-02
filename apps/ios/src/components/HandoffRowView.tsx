import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { HandoffChild, ThreadRow } from '../live/channel-model';
import { fontSize, minTarget, space, useOmniTheme } from '../theme';
import { type DotTone, StatusDot } from './StatusDot';
import { ThreadSwipeRow } from './ThreadSwipeRow';

export interface HandoffRowViewProps {
  row: ThreadRow & { handoff: NonNullable<ThreadRow['handoff']> };
  open: boolean;
  onToggle: () => void;
  onOpenThread: (threadId: string) => void;
  /** Long press on the parent: the whole thread menu. */
  onMenu: () => void;
}

const toneOf = (child: HandoffChild): DotTone => (child.status === 'failed' ? 'warn' : child.busy ? 'ok' : 'muted');

/**
 * A Conductor thread and the threads it delegated. A button under the row opens and closes the children, which sit
 * indented along a rule, each with its state dot, title and the channel it runs in.
 */
export function HandoffRowView({ row, open, onToggle, onOpenThread, onMenu }: HandoffRowViewProps) {
  const { colors } = useOmniTheme();
  const { children, running } = row.handoff;
  const summary = running > 0 ? `${children.length} delegated · ${running} running` : `${children.length} delegated`;
  return (
    <View>
      <ThreadSwipeRow row={row} onPress={() => onOpenThread(row.id)} onMenu={onMenu} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${open ? 'Hide' : 'Show'} ${children.length} delegated ${children.length === 1 ? 'thread' : 'threads'} for ${row.title}${running > 0 ? `, ${running} running` : ''}`}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        hitSlop={4}
        style={({ pressed }) => [styles.toggle, { backgroundColor: pressed ? colors.surface2 : colors.bg }]}
      >
        <Text style={[styles.chevron, { color: colors.fg4, transform: [{ rotate: open ? '90deg' : '0deg' }] }]}>›</Text>
        <Text style={[styles.summary, { color: colors.fg3 }]}>{summary}</Text>
      </Pressable>
      {open ? (
        <View accessibilityRole="list" accessibilityLabel={`Threads delegated from ${row.title}`} style={[styles.children, { borderColor: colors.lineStrong }]}>
          {children.map((child) => (
            <Pressable
              key={child.id}
              accessibilityRole="button"
              accessibilityLabel={`${child.title}, #${child.channel}, ${child.status}`}
              onPress={() => onOpenThread(child.id)}
              style={({ pressed }) => [styles.child, { backgroundColor: pressed ? colors.surface2 : colors.bg }]}
            >
              <StatusDot tone={toneOf(child)} />
              <Text numberOfLines={1} style={[styles.childTitle, { color: colors.fg2 }]}>
                {child.title}
              </Text>
              <Text numberOfLines={1} style={[styles.chip, { color: colors.fg3, backgroundColor: colors.surface2 }]}>
                {`#${child.channel}`}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
    marginLeft: space.s9 + 8 - 3,
    paddingHorizontal: space.s4,
    alignSelf: 'flex-start',
    borderRadius: 18,
  },
  chevron: {
    width: 12,
    fontSize: fontSize.body + 4,
    lineHeight: 20,
    textAlign: 'center',
  },
  summary: {
    fontSize: fontSize.meta,
  },
  children: {
    marginLeft: space.s9 + 8 - 3,
    paddingLeft: space.s6,
    borderLeftWidth: 1,
    marginBottom: space.s2,
  },
  child: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
    paddingRight: space.s9,
    borderRadius: 12,
  },
  childTitle: {
    flex: 1,
    fontSize: fontSize.body,
  },
  chip: {
    maxWidth: '38%',
    overflow: 'hidden',
    paddingHorizontal: space.s4,
    paddingVertical: 3,
    borderRadius: 10,
    fontSize: fontSize.meta - 1,
  },
});
