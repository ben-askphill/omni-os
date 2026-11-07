import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import type { ThreadRow } from '../live/channel-model';
import { fontSize, space, useOmniTheme, weight } from '../theme';
import type { ThreadAction } from '../thread/actions';
import { useThreadActions } from '../thread/hooks';
import { canMarkDone } from '../thread/target';
import { tap } from '../ui/haptics';
import { Icon, type IconName } from '../ui/Icon';
import { ThreadRowView } from './ThreadRowView';

const ACTION_WIDTH = 76;

interface ThreadSwipeRowProps {
  row: ThreadRow;
  onPress: () => void;
  /** Long press: the whole thread menu, for rename and move. */
  onMenu: () => void;
}

/**
 * A thread row that swipes open to Pin, Done and Archive. These run straight from the list; the channel list refetches on
 * the feed, so the row moves or leaves by itself. A refusal from the server shows as an alert and leaves the row alone.
 */
export function ThreadSwipeRow({ row, onPress, onMenu }: ThreadSwipeRowProps) {
  const { colors } = useOmniTheme();
  const run = useThreadActions();
  const { target } = row;

  // Done wears the done colour; Archive is the ink action. Both fills carry their own text colour.
  const actions: { key: string; label: string; icon: IconName; fill: string; ink: string; action: ThreadAction }[] = [
    { key: 'pin', label: target.pinned ? 'Unpin' : 'Pin', icon: 'pin', fill: colors.surface3, ink: colors.fg, action: { kind: 'pin' } },
    ...(target.done || canMarkDone(target.status)
      ? [{ key: 'done', label: target.done ? 'Not done' : 'Done', icon: target.done ? 'undo' : 'check', fill: colors.done, ink: colors.onDone, action: { kind: 'done' } } as const]
      : []),
    { key: 'archive', label: 'Archive', icon: 'archive', fill: colors.fg, ink: colors.onInk, action: { kind: 'archive' } },
  ];

  async function perform(action: ThreadAction, methods: SwipeableMethods) {
    tap();
    methods.close();
    const outcome = await run(target, action);
    if (outcome.kind === 'failed') Alert.alert('Could not change this thread', outcome.error);
  }

  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={24}
      overshootRight={false}
      renderRightActions={(_progress, _translation, methods) => (
        <View style={[styles.actions, { width: ACTION_WIDTH * actions.length }]}>
          {actions.map((a) => (
            <Pressable
              key={a.key}
              accessibilityRole="button"
              accessibilityLabel={`${a.label} ${row.title}`}
              onPress={() => void perform(a.action, methods)}
              style={({ pressed }) => [styles.action, { width: ACTION_WIDTH, backgroundColor: a.fill, opacity: pressed ? 0.85 : 1 }]}
            >
              <Icon name={a.icon} size={18} color={a.ink} />
              <Text style={[styles.label, { color: a.ink }]}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    >
      <ThreadRowView row={row} onPress={onPress} onLongPress={onMenu} />
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
  },
  action: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s2,
    paddingHorizontal: space.s2,
  },
  label: {
    fontSize: fontSize.caption,
    fontWeight: weight.semibold,
  },
});
