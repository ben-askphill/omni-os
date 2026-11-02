import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ActivityRow, ThreadGroup } from '../../live/activity-model';
import { fontSize, minTarget, radius, space, useOmniTheme } from '../../theme';
import { ThreadRowView } from '../ThreadRowView';

/** A thread row, and the Conductor's delegated threads indented under it behind a collapse toggle. */
export function ThreadGroupView({ group, onOpen }: { group: ThreadGroup; onOpen: (row: ActivityRow) => void }) {
  const { colors } = useOmniTheme();
  const [expanded, setExpanded] = useState(true);
  const parent = <ThreadRowView row={group.row} onPress={() => onOpen(group.row)} />;
  if (!group.children.length) return parent;
  return (
    <View>
      <View style={styles.parent}>
        <View style={styles.grow}>{parent}</View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} delegated threads for ${group.row.title}`}
          accessibilityState={{ expanded }}
          hitSlop={4}
          onPress={() => setExpanded((open) => !open)}
          style={({ pressed }) => [styles.toggle, { backgroundColor: pressed ? colors.surface3 : colors.surface }]}
        >
          <Text style={[styles.chevron, { color: colors.fg3, transform: [{ rotate: expanded ? '90deg' : '0deg' }] }]}>›</Text>
        </Pressable>
      </View>
      {expanded ? (
        <View
          accessibilityLabel={`Threads delegated from ${group.row.title}`}
          style={[styles.children, { borderColor: colors.lineStrong }]}
        >
          {group.children.map((child) => (
            <ThreadRowView key={child.id} row={child} onPress={() => onOpen(child)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  parent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: space.s6,
  },
  grow: {
    flex: 1,
  },
  toggle: {
    width: minTarget - space.s4,
    height: minTarget - space.s4,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    fontSize: fontSize.heading + 4,
    lineHeight: 22,
  },
  children: {
    marginLeft: space.s9 + space.s2,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
});
