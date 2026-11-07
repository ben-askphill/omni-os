import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';

import { fontSize, space, useOmniTheme, weight } from '../theme';
import { Button } from '../ui/Button';

/** A full-screen message with an optional action, for a screen that has nothing else to show yet. */
export function Notice({ title, body, action }: { title: string; body?: string; action?: { label: string; onPress: () => void } }) {
  const { colors } = useOmniTheme();
  return (
    <View style={[styles.notice, { backgroundColor: colors.bg }]}>
      <Text style={[styles.title, { color: colors.fg }]}>{title}</Text>
      {body ? <Text style={[styles.body, { color: colors.fg3 }]}>{body}</Text> : null}
      {action ? (
        <View style={styles.action}>
          <Button label={action.label} variant="secondary" onPress={action.onPress} />
        </View>
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
    fontWeight: weight.semibold,
  },
  body: {
    fontSize: fontSize.body,
  },
  action: {
    alignSelf: 'flex-start',
    marginTop: space.s4,
  },
});
