import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { fontSize, lineHeight, space, useOmniTheme, weight } from '../theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

/** A screen with nothing to list yet, as phone web draws it: an icon in a soft circle, a title, a line, and a way out. */
export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: { label: string; onPress: () => void } }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.disc, { backgroundColor: colors.surface2 }]}>
        <Icon name={icon} size={24} color={colors.fg3} />
      </View>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.fg }]}>
        {title}
      </Text>
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
  empty: {
    alignItems: 'center',
    paddingHorizontal: space.s11,
    paddingTop: space.s12 + space.s8,
    gap: space.s4,
  },
  disc: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.s4,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: weight.semibold,
    textAlign: 'center',
  },
  body: {
    fontSize: fontSize.body,
    lineHeight: Math.round(fontSize.body * lineHeight.body),
    textAlign: 'center',
  },
  action: {
    marginTop: space.s4,
  },
});
