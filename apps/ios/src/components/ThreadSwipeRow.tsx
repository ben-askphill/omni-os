import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import type { ThreadRow } from '../live/channel-model';
import { fontSize, space, useOmniTheme, weight } from '../theme';
import type { ThreadAction } from '../thread/actions';
import { useThreadActions } from '../thread/hooks';
import { canMarkDone } from '../thread/target';
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

  const actions: { key: string; label: string; action: ThreadAction }[] = [
    { key: 'pin', label: target.pinned ? 'Unpin' : 'Pin', action: { kind: 'pin' } },
    ...(target.done || canMarkDone(target.status) ? [{ key: 'done', label: target.done ? 'Not done' : 'Done', action: { kind: 'done' } as const }] : []),
    { key: 'archive', label: 'Archive', action: { kind: 'archive' } },
  ];

  async function perform(action: ThreadAction, methods: SwipeableMethods) {
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
        <View style={[styles.actions, { width: ACTION_WIDTH * actions.length, backgroundColor: colors.surface3 }]}>
          {actions.map((a) => (
            <Pressable
              key={a.key}
              accessibilityRole="button"
              accessibilityLabel={`${a.label} ${row.title}`}
              onPress={() => void perform(a.action, methods)}
              style={({ pressed }) => [styles.action, { width: ACTION_WIDTH, backgroundColor: pressed ? colors.surface2 : 'transparent' }]}
            >
              <Text style={[styles.label, { color: colors.fg }]}>{a.label}</Text>
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
    paddingHorizontal: space.s2,
  },
  label: {
    fontSize: fontSize.body,
    fontWeight: weight.semibold,
  },
});
