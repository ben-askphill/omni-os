import { StyleSheet } from 'react-native';
import { Text } from '../ui/Text';

import { fontSize, space, useOmniTheme, weight } from '../theme';

/** A section label in a list, such as "Active" or a folder name, in sentence case with how many rows it holds when given (web: MoSection). */
/** `inset`: the list already sits in a padded column, such as Settings, so the label only nudges in from the card's edge. */
export function ListHeading({ children, count, inset }: { children: string; count?: number; inset?: boolean }) {
  const { colors } = useOmniTheme();
  return (
    <Text
      accessibilityRole="header"
      accessibilityLabel={count === undefined ? undefined : `${children}, ${count}`}
      style={[styles.heading, inset && styles.inset, { color: colors.fg3 }]}
    >
      {children}
      {count === undefined ? null : <Text style={{ color: colors.fg4 }}>{`  ${count}`}</Text>}
    </Text>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: fontSize.caption,
    fontWeight: weight.medium,
    paddingHorizontal: space.s9,
    paddingTop: space.s10,
    paddingBottom: space.s4,
  },
  inset: {
    paddingHorizontal: space.s2,
    paddingTop: space.s4,
  },
});
