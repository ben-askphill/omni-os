import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';
import { Icon } from '../ui/Icon';

import { fontSize, minTarget, space, useOmniTheme, weight } from '../theme';

export interface FolderHeaderProps {
  name: string;
  collapsed: boolean;
  count: number;
  running: number;
  onToggle: () => void;
}

/** A folder in a channel's list: a chevron, its name, how many threads it holds and how many run. Tap to open or close it. */
export function FolderHeader({ name, collapsed, count, running, onToggle }: FolderHeaderProps) {
  const { colors } = useOmniTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${count} ${count === 1 ? 'thread' : 'threads'}${running > 0 ? `, ${running} running` : ''}`}
      accessibilityState={{ expanded: !collapsed }}
      accessibilityHint={collapsed ? 'Shows the threads' : 'Hides the threads'}
      onPress={onToggle}
      style={({ pressed }) => [styles.header, { backgroundColor: pressed ? colors.surface2 : colors.bg }]}
    >
      <View style={{ width: 12, alignItems: 'center', transform: [{ rotate: collapsed ? '0deg' : '90deg' }] }}>
        <Icon name="chevronRight" size={11} weight="semibold" color={colors.fg4} />
      </View>
      <Text numberOfLines={1} style={[styles.name, { color: colors.fg2 }]}>
        {name}
      </Text>
      <View style={styles.counts}>
        {running > 0 ? <Text style={[styles.count, { color: colors.fg3 }]}>{`${running} running`}</Text> : null}
        <Text style={[styles.count, { color: colors.fg4 }]}>{count}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
    paddingHorizontal: space.s9,
  },
  name: {
    flex: 1,
    fontSize: fontSize.body + 1,
    fontWeight: weight.semibold,
  },
  counts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s4,
  },
  count: {
    fontSize: fontSize.meta,
    fontVariant: ['tabular-nums'],
  },
});
