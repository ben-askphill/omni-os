import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontSize, minTarget, space, useOmniTheme } from '../theme';

/** A full-screen message with an optional action, for a screen that has nothing else to show yet. */
export function Notice({ title, body, action }: { title: string; body?: string; action?: { label: string; onPress: () => void } }) {
  const { colors } = useOmniTheme();
  return (
    <View style={[styles.notice, { backgroundColor: colors.bg }]}>
      <Text style={[styles.title, { color: colors.fg }]}>{title}</Text>
      {body ? <Text style={[styles.body, { color: colors.fg3 }]}>{body}</Text> : null}
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.onPress} style={styles.action}>
          <Text style={[styles.actionLabel, { color: colors.fg }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flex: 1,
    paddingHorizontal: space.s9,
    paddingTop: space.s11,
    gap: space.s4,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: '600',
  },
  body: {
    fontSize: fontSize.body,
  },
  action: {
    minHeight: minTarget,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  actionLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
